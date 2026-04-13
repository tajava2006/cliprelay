package com.hoppe.cliprelay

import android.app.Activity
import android.app.NotificationManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.core.content.FileProvider
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * 투명 Activity — 알림 탭 시 포그라운드를 획득하여 클립보드를 조작한다.
 * 앱(MainActivity)은 켜지지 않는다.
 *
 * Android 10+ 에서 클립보드 접근은 포그라운드 Activity에서만 가능하다.
 * 이 Activity는 투명(Theme.Translucent.NoTitleBar)이라 사용자에게 보이지 않고,
 * 작업 완료 후 즉시 finish()한다.
 *
 * 액션 종류 (Intent extra "action"):
 *   - "copy"  : 수신 알림 탭 → Amber로 직접 복호화 → 클립보드 쓰기
 */
class ClipboardActionActivity : Activity() {

    companion object {
        private const val AMBER_REQUEST_CODE = 1001
        private const val PREFS_NAME = "clipboard_action_history"
        private const val GCM_TAG_LENGTH_BITS = 128
    }

    private var pendingNotificationId: Int = -1

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        when (intent.getStringExtra("action")) {
            "copy" -> handleCopy()
            else -> finish()
        }
    }

    /**
     * 수신 알림 탭 처리.
     *
     * 암호화된 content + userPubkey가 Intent에 들어있다.
     * Amber에 직접 nip44_decrypt Intent를 발사하여 복호화한다.
     */
    private fun handleCopy() {
        val encryptedContent = intent.getStringExtra("encrypted_content")
        val userPubkey = intent.getStringExtra("user_pubkey")
        pendingNotificationId = intent.getIntExtra("notification_id", -1)

        if (encryptedContent.isNullOrEmpty() || userPubkey.isNullOrEmpty()) {
            Toast.makeText(this, "Missing data", Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        // Amber에 직접 nip44_decrypt Intent 발사
        val decryptIntent = Intent(Intent.ACTION_VIEW, Uri.parse("nostrsigner:$encryptedContent"))
        decryptIntent.putExtra("type", "nip44_decrypt")
        decryptIntent.putExtra("current_user", userPubkey)
        decryptIntent.putExtra("pubkey", userPubkey)  // 자기암호화: pubkey == current_user
        decryptIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)

        // Amber 패키지 검색
        val signerInfos = packageManager.queryIntentActivities(
            Intent(Intent.ACTION_VIEW, Uri.parse("nostrsigner:")), 0
        )
        if (signerInfos.isNotEmpty()) {
            decryptIntent.`package` = signerInfos[0].activityInfo.packageName
        }

        @Suppress("DEPRECATION")
        startActivityForResult(decryptIntent, AMBER_REQUEST_CODE)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)

        if (requestCode != AMBER_REQUEST_CODE) {
            finish()
            return
        }

        if (resultCode != RESULT_OK) {
            Toast.makeText(this, "Decrypt rejected", Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        val decrypted = data?.getStringExtra("result")
        if (decrypted.isNullOrEmpty()) {
            Toast.makeText(this, "Decrypt failed", Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        // 복호화된 JSON 파싱 → 클립보드 쓰기
        try {
            val json = org.json.JSONObject(decrypted)
            val type = json.getString("type")

            when (type) {
                "text" -> {
                    handleTextPayload(json, decrypted)
                    dismissAndFinish()
                }
                "file" -> {
                    // handleFilePayload는 비동기 — 내부에서 dismissAndFinish() 호출
                    handleFilePayload(json, decrypted)
                    return
                }
                else -> {
                    Toast.makeText(this, "Unknown type: $type", Toast.LENGTH_SHORT).show()
                    dismissAndFinish()
                }
            }
        } catch (e: Exception) {
            Toast.makeText(this, "Parse failed", Toast.LENGTH_SHORT).show()
            dismissAndFinish()
        }
    }

    /** 알림 제거 후 Activity 종료 */
    private fun dismissAndFinish() {
        if (pendingNotificationId >= 0) {
            val manager = getSystemService(NotificationManager::class.java)
            manager.cancel(pendingNotificationId)
        }
        finish()
    }

    /**
     * 텍스트 페이로드: 클립보드에 텍스트 쓰기.
     */
    private fun handleTextPayload(json: org.json.JSONObject, rawJson: String) {
        val content = json.getString("content")
        val clipboard = getSystemService(ClipboardManager::class.java)
        clipboard.setPrimaryClip(ClipData.newPlainText("ClipRelay", content))
        Toast.makeText(this, "Copied", Toast.LENGTH_SHORT).show()
        saveToTempHistory(rawJson)
    }

    /**
     * 파일 페이로드: Blossom 다운로드 → AES-GCM 복호화 → 클립보드에 이미지 쓰기.
     *
     * 네트워크 + 암호화 작업이므로 백그라운드 스레드에서 실행한다.
     * finish()는 작업 완료 후 호출.
     */
    private fun handleFilePayload(json: org.json.JSONObject, rawJson: String) {
        val url = json.getString("url")
        val keyHex = json.getString("key")
        val ivHex = json.getString("iv")
        val mimeType = json.optString("mimeType", "image/png")
        val filename = json.optString("filename", "clipboard.png")

        // finish()를 여기서 하면 안 됨 — 비동기 작업 완료 후 호출해야 함
        // onActivityResult 마지막의 finish()가 먼저 호출되지 않도록 별도 처리
        Toast.makeText(this, "Downloading…", Toast.LENGTH_SHORT).show()

        Thread {
            try {
                // 1. Blossom에서 암호화된 바이너리 다운로드
                val encryptedBytes = downloadFromBlossom(url)

                // 2. AES-GCM 복호화
                val plainBytes = decryptAesGcm(encryptedBytes, keyHex, ivHex)

                // 3. 캐시 디렉토리에 파일 저장
                val cacheFile = File(cacheDir, "clipboard_image_${System.currentTimeMillis()}.png")
                cacheFile.writeBytes(plainBytes)

                // 4. FileProvider URI 생성 → 클립보드에 이미지 쓰기
                val contentUri = FileProvider.getUriForFile(
                    this,
                    "${packageName}.fileprovider",
                    cacheFile
                )

                runOnUiThread {
                    try {
                        val clipboard = getSystemService(ClipboardManager::class.java)
                        val imageClip = ClipData("ClipRelay", arrayOf(mimeType), ClipData.Item(contentUri))
                        clipboard.setPrimaryClip(imageClip)
                        Toast.makeText(this, "Image copied", Toast.LENGTH_SHORT).show()
                        saveToTempHistory(rawJson)
                    } catch (e: Exception) {
                        Toast.makeText(this, "Clipboard write failed", Toast.LENGTH_SHORT).show()
                    }

                    // 오래된 캐시 파일 정리 (최근 5개만 유지)
                    cleanupCacheFiles()

                    dismissAndFinish()
                }
            } catch (e: Exception) {
                runOnUiThread {
                    Toast.makeText(this, "Image download failed", Toast.LENGTH_SHORT).show()
                    dismissAndFinish()
                }
            }
        }.start()
    }

    /**
     * Blossom URL에서 암호화된 바이너리를 다운로드한다.
     */
    private fun downloadFromBlossom(url: String): ByteArray {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 15_000
        connection.readTimeout = 30_000
        try {
            if (connection.responseCode != 200) {
                throw Exception("HTTP ${connection.responseCode}")
            }
            return connection.inputStream.readBytes()
        } finally {
            connection.disconnect()
        }
    }

    /**
     * AES-GCM으로 암호화된 바이너리를 복호화한다.
     * desktop/src/blossom/download.ts의 decryptFile()과 동일한 로직.
     */
    private fun decryptAesGcm(encrypted: ByteArray, keyHex: String, ivHex: String): ByteArray {
        val keyBytes = hexToBytes(keyHex)
        val ivBytes = hexToBytes(ivHex)
        val secretKey = SecretKeySpec(keyBytes, "AES")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(GCM_TAG_LENGTH_BITS, ivBytes))
        return cipher.doFinal(encrypted)
    }

    private fun hexToBytes(hex: String): ByteArray {
        val bytes = ByteArray(hex.length / 2)
        for (i in bytes.indices) {
            bytes[i] = hex.substring(i * 2, i * 2 + 2).toInt(16).toByte()
        }
        return bytes
    }

    /**
     * 복호화된 payload를 SharedPreferences에 임시 저장.
     * 앱이 열릴 때 TS가 이걸 읽어서 history-store에 저장한다.
     */
    private fun saveToTempHistory(payloadJson: String) {
        val prefs: SharedPreferences = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val timestamp = System.currentTimeMillis()
        prefs.edit().putString("pending_$timestamp", payloadJson).apply()
    }

    /**
     * clipboard_image_*.png 캐시 파일을 최근 5개만 유지한다.
     */
    private fun cleanupCacheFiles() {
        val files = cacheDir.listFiles { file ->
            file.name.startsWith("clipboard_image_") && file.name.endsWith(".png")
        } ?: return
        if (files.size <= 5) return
        files.sortBy { it.lastModified() }
        for (i in 0 until files.size - 5) {
            files[i].delete()
        }
    }
}
