package com.hoppe.cliprelay.keychain

import android.app.Activity
import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class SetSecretArgs {
    lateinit var key: String
    lateinit var value: String
}

@InvokeArg
class KeyArgs {
    lateinit var key: String
}

/**
 * Android Keystore 기반 암호화 저장소.
 *
 * EncryptedSharedPreferences를 사용하여 MasterKey(AES-256-GCM)로
 * 키-값 쌍을 투명하게 암호화/복호화한다.
 * 앱 서명 키에 바인딩되므로 다른 앱에서 접근 불가.
 */
@TauriPlugin
class KeychainPlugin(private val activity: Activity) : Plugin(activity) {

    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(activity)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        EncryptedSharedPreferences.create(
            activity,
            "cliprelay_secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    @Command
    fun setSecret(invoke: Invoke) {
        val args = invoke.parseArgs(SetSecretArgs::class.java)
        try {
            prefs.edit().putString(args.key, args.value).apply()
            invoke.resolve(JSObject())
        } catch (e: Exception) {
            invoke.reject("keychain set failed: ${e.message}")
        }
    }

    @Command
    fun getSecret(invoke: Invoke) {
        val args = invoke.parseArgs(KeyArgs::class.java)
        try {
            val value = prefs.getString(args.key, null)
            val result = JSObject()
            result.put("value", value)
            invoke.resolve(result)
        } catch (e: Exception) {
            invoke.reject("keychain get failed: ${e.message}")
        }
    }

    @Command
    fun deleteSecret(invoke: Invoke) {
        val args = invoke.parseArgs(KeyArgs::class.java)
        try {
            prefs.edit().remove(args.key).apply()
            invoke.resolve(JSObject())
        } catch (e: Exception) {
            invoke.reject("keychain delete failed: ${e.message}")
        }
    }
}
