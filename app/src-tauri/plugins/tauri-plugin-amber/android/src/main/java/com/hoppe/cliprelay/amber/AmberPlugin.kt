package com.hoppe.cliprelay.amber

import android.app.Activity
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.util.Log
import android.webkit.WebView
import com.hoppe.cliprelay.amber.BuildConfig
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class SignEventArgs {
    lateinit var eventJson: String
    lateinit var currentUser: String
    var packageName: String = ""
}

@InvokeArg
class Nip44Args {
    lateinit var pubkey: String
    lateinit var content: String
    lateinit var currentUser: String
    var packageName: String = ""
}

@TauriPlugin
class AmberPlugin(private val activity: Activity) : Plugin(activity) {
    private var signerPackage: String? = null

    companion object {
        private const val TAG = "AmberPlugin"
    }

    @Command
    fun isInstalled(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("nostrsigner:"))
        val infos = activity.packageManager.queryIntentActivities(intent, 0)
        val result = JSObject()
        result.put("installed", infos.size > 0)
        invoke.resolve(result)
    }

    @Command
    fun getPublicKey(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("nostrsigner:"))
        intent.putExtra("type", "get_public_key")

        // 기본 권한 요청: sign_event, nip44_encrypt, nip44_decrypt 자동 승인
        val permissions = """[
            {"type":"sign_event","kind":9372},
            {"type":"sign_event","kind":24242},
            {"type":"nip44_encrypt"},
            {"type":"nip44_decrypt"}
        ]""".trimIndent()
        intent.putExtra("permissions", permissions)

        startActivityForResult(invoke, intent, "onGetPublicKeyResult")
    }

    @ActivityCallback
    fun onGetPublicKeyResult(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) {
            invoke.reject("User rejected get_public_key request")
            return
        }
        val data = result.data
        val pubkey = data?.getStringExtra("result")
        val packageName = data?.getStringExtra("package")

        if (pubkey.isNullOrEmpty()) {
            invoke.reject("No pubkey returned from Amber")
            return
        }

        signerPackage = packageName

        val obj = JSObject()
        obj.put("pubkey", pubkey)
        obj.put("packageName", packageName ?: "")
        invoke.resolve(obj)
    }

    /**
     * NIP-55 Content Provider 경유 호출 (Amber SignerProvider.query() 사용).
     *
     * Amber의 API (SignerProvider.kt 소스 기준):
     *   - contentResolver.query(uri, projection, null, null, null)
     *   - projection[0] = eventJson / content
     *   - projection[1] = pubkey (nip44용, sign_event는 "" 사용)
     *   - projection[2] = currentUser (hex 또는 npub)
     *   - packageName은 Android Binder가 callingPackage로 자동 제공
     *
     * 결과 Cursor 컬럼: "signature", "event", "result"
     * 권한 없음 시 Cursor 컬럼: "rejected" = "true"
     *
     * 실패(예외, null 커서, rejected)하면 onFallback을 메인 스레드에서 호출한다.
     */
    private fun queryAmberProvider(
        authority: String,
        projection: Array<String>,
        invoke: Invoke,
        extractResult: (Cursor) -> String?,
        onFallback: () -> Unit,
    ) {
        Thread {
            try {
                val uri = Uri.parse("content://$authority")
                if (BuildConfig.DEBUG) Log.d(TAG, "ContentProvider query: uri=$uri")
                val cursor = activity.contentResolver.query(uri, projection, null, null, null)
                if (cursor == null) {
                    Log.w(TAG, "ContentProvider null cursor — falling back")
                    activity.runOnUiThread { onFallback() }
                    return@Thread
                }
                cursor.use {
                    // 권한 없음: "rejected" 컬럼이 있으면 Activity intent로 권한 요청
                    if (it.columnNames.contains("rejected")) {
                        Log.w(TAG, "ContentProvider rejected — falling back to Activity intent for permission")
                        activity.runOnUiThread { onFallback() }
                        return@Thread
                    }
                    if (!it.moveToFirst()) {
                        Log.w(TAG, "ContentProvider empty cursor — falling back")
                        activity.runOnUiThread { onFallback() }
                        return@Thread
                    }
                    val value = extractResult(it)
                    if (BuildConfig.DEBUG) Log.d(TAG, "ContentProvider extracted: ${value?.take(80)}")
                    if (!value.isNullOrEmpty()) {
                        val obj = JSObject()
                        obj.put("result", value)
                        invoke.resolve(obj)
                    } else {
                        Log.w(TAG, "ContentProvider null/empty result — falling back")
                        activity.runOnUiThread { onFallback() }
                    }
                }
            } catch (e: Exception) {
                if (BuildConfig.DEBUG) {
                    Log.e(TAG, "ContentProvider exception: ${e.javaClass.simpleName}: ${e.message} — falling back")
                } else {
                    Log.e(TAG, "ContentProvider exception: ${e.javaClass.simpleName} — falling back")
                }
                activity.runOnUiThread { onFallback() }
            }
        }.start()
    }

    /** 애니메이션 없이 Amber Intent를 시작한다 (Content Provider 폴백용). */
    @Suppress("DEPRECATION")
    private fun startAmberActivity(invoke: Invoke, intent: Intent, callbackName: String) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NO_ANIMATION)
        startActivityForResult(invoke, intent, callbackName)
        activity.overridePendingTransition(0, 0)
    }

    /** Amber에서 돌아올 때 복귀 애니메이션을 제거한다. */
    @Suppress("DEPRECATION")
    private fun suppressReturnAnimation() {
        activity.overridePendingTransition(0, 0)
    }

    @Command
    fun signEvent(invoke: Invoke) {
        val args = invoke.parseArgs(SignEventArgs::class.java)
        val pkg = args.packageName.ifEmpty { null } ?: signerPackage

        if (pkg != null) {
            // projection: [eventJson, "", currentUser]  — Amber SignerProvider.query() 규격
            val projection = arrayOf(args.eventJson, "", args.currentUser)
            queryAmberProvider("$pkg.SIGN_EVENT", projection, invoke, { cursor ->
                val col = cursor.getColumnIndex("event")
                    .takeIf { it >= 0 } ?: cursor.getColumnIndex("result").takeIf { it >= 0 }
                col?.let { cursor.getString(it) }
            }) { startSignEventActivity(invoke, args, pkg) }
            return
        }

        startSignEventActivity(invoke, args, null)
    }

    private fun startSignEventActivity(invoke: Invoke, args: SignEventArgs, pkg: String?) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("nostrsigner:${args.eventJson}"))
        intent.putExtra("type", "sign_event")
        intent.putExtra("current_user", args.currentUser)
        pkg?.let { intent.`package` = it }
        startAmberActivity(invoke, intent, "onSignEventResult")
    }

    @ActivityCallback
    fun onSignEventResult(invoke: Invoke, result: ActivityResult) {
        suppressReturnAnimation()
        if (result.resultCode != Activity.RESULT_OK) {
            invoke.reject("User rejected sign_event request")
            return
        }
        val data = result.data
        val signedEvent = data?.getStringExtra("event")
            ?: data?.getStringExtra("result")

        if (signedEvent.isNullOrEmpty()) {
            invoke.reject("No signed event returned from Amber")
            return
        }

        val obj = JSObject()
        obj.put("result", signedEvent)
        invoke.resolve(obj)
    }

    @Command
    fun nip44Encrypt(invoke: Invoke) {
        val args = invoke.parseArgs(Nip44Args::class.java)
        val pkg = args.packageName.ifEmpty { null } ?: signerPackage

        if (pkg != null) {
            // projection: [content, pubkey, currentUser]  — Amber SignerProvider.query() 규격
            val projection = arrayOf(args.content, args.pubkey, args.currentUser)
            queryAmberProvider("$pkg.NIP44_ENCRYPT", projection, invoke, { cursor ->
                val col = cursor.getColumnIndex("result")
                    .takeIf { it >= 0 } ?: cursor.getColumnIndex("event").takeIf { it >= 0 }
                col?.let { cursor.getString(it) }
            }) { startNip44EncryptActivity(invoke, args, pkg) }
            return
        }

        startNip44EncryptActivity(invoke, args, null)
    }

    private fun startNip44EncryptActivity(invoke: Invoke, args: Nip44Args, pkg: String?) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("nostrsigner:${args.content}"))
        intent.putExtra("type", "nip44_encrypt")
        intent.putExtra("current_user", args.currentUser)
        intent.putExtra("pubkey", args.pubkey)
        pkg?.let { intent.`package` = it }
        startAmberActivity(invoke, intent, "onNip44EncryptResult")
    }

    @ActivityCallback
    fun onNip44EncryptResult(invoke: Invoke, result: ActivityResult) {
        suppressReturnAnimation()
        if (result.resultCode != Activity.RESULT_OK) {
            invoke.reject("User rejected nip44_encrypt request")
            return
        }
        val encrypted = result.data?.getStringExtra("result")
        if (encrypted.isNullOrEmpty()) {
            invoke.reject("No encrypted result returned from Amber")
            return
        }
        val obj = JSObject()
        obj.put("result", encrypted)
        invoke.resolve(obj)
    }

    @Command
    fun nip44Decrypt(invoke: Invoke) {
        val args = invoke.parseArgs(Nip44Args::class.java)
        val pkg = args.packageName.ifEmpty { null } ?: signerPackage

        if (pkg != null) {
            // projection: [content, pubkey, currentUser]  — Amber SignerProvider.query() 규격
            val projection = arrayOf(args.content, args.pubkey, args.currentUser)
            queryAmberProvider("$pkg.NIP44_DECRYPT", projection, invoke, { cursor ->
                val col = cursor.getColumnIndex("result")
                    .takeIf { it >= 0 } ?: cursor.getColumnIndex("event").takeIf { it >= 0 }
                col?.let { cursor.getString(it) }
            }) { startNip44DecryptActivity(invoke, args, pkg) }
            return
        }

        startNip44DecryptActivity(invoke, args, null)
    }

    private fun startNip44DecryptActivity(invoke: Invoke, args: Nip44Args, pkg: String?) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("nostrsigner:${args.content}"))
        intent.putExtra("type", "nip44_decrypt")
        intent.putExtra("current_user", args.currentUser)
        intent.putExtra("pubkey", args.pubkey)
        pkg?.let { intent.`package` = it }
        startAmberActivity(invoke, intent, "onNip44DecryptResult")
    }

    @ActivityCallback
    fun onNip44DecryptResult(invoke: Invoke, result: ActivityResult) {
        suppressReturnAnimation()
        if (result.resultCode != Activity.RESULT_OK) {
            invoke.reject("User rejected nip44_decrypt request")
            return
        }
        val decrypted = result.data?.getStringExtra("result")
        if (decrypted.isNullOrEmpty()) {
            invoke.reject("No decrypted result returned from Amber")
            return
        }
        val obj = JSObject()
        obj.put("result", decrypted)
        invoke.resolve(obj)
    }
}
