package com.hoppe.cliprelay.clipaction

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.util.Base64
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class WriteImageArgs {
    lateinit var base64: String       // PNG bytes를 base64 인코딩한 문자열
    var mimeType: String = "image/png"
}

/**
 * 클립보드 액션 브릿지.
 *
 * - readClipboardText() / readClipboardImage(): 현재 OS 클립보드 읽기
 * - writeImageToClipboard(): PNG bytes → 캐시 저장 → FileProvider URI → 클립보드 쓰기
 */
@TauriPlugin
class ClipboardActionPlugin(private val activity: Activity) : Plugin(activity) {

    @Command
    fun readClipboardImage(invoke: Invoke) {
        val result = JSObject()
        try {
            val clipboard = activity.getSystemService(ClipboardManager::class.java)
            val clip = clipboard.primaryClip
            if (clip == null || clip.itemCount == 0) {
                result.put("hasImage", false)
                invoke.resolve(result)
                return
            }

            val description = clip.description
            var hasImageMime = false
            for (i in 0 until description.mimeTypeCount) {
                if (description.getMimeType(i).startsWith("image/")) {
                    hasImageMime = true
                    break
                }
            }

            if (!hasImageMime) {
                result.put("hasImage", false)
                invoke.resolve(result)
                return
            }

            val uri = clip.getItemAt(0).uri
            if (uri == null) {
                result.put("hasImage", false)
                invoke.resolve(result)
                return
            }

            val inputStream = activity.contentResolver.openInputStream(uri)
            if (inputStream == null) {
                result.put("hasImage", false)
                invoke.resolve(result)
                return
            }

            val rawBytes = inputStream.use { it.readBytes() }

            // JPEG 등 → PNG 변환 (수신 측이 PNG만 지원)
            val bitmap = android.graphics.BitmapFactory.decodeByteArray(rawBytes, 0, rawBytes.size)
            if (bitmap == null) {
                result.put("hasImage", false)
                invoke.resolve(result)
                return
            }
            val pngStream = java.io.ByteArrayOutputStream()
            bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, pngStream)
            bitmap.recycle()
            val base64 = Base64.encodeToString(pngStream.toByteArray(), Base64.NO_WRAP)

            result.put("hasImage", true)
            result.put("base64", base64)
            invoke.resolve(result)
        } catch (e: Exception) {
            result.put("hasImage", false)
            invoke.resolve(result)
        }
    }

    @Command
    fun readClipboardText(invoke: Invoke) {
        val result = JSObject()
        try {
            val clipboard = activity.getSystemService(android.content.ClipboardManager::class.java)
            val clip = clipboard.primaryClip
            val text = if (clip != null && clip.itemCount > 0) clip.getItemAt(0).text?.toString() else null
            result.put("text", text ?: "")
        } catch (e: Exception) {
            result.put("text", "")
        }
        invoke.resolve(result)
    }

    /**
     * PNG bytes(base64)를 클립보드에 이미지로 쓴다.
     * Android에서 Tauri clipboard-manager의 writeImage가 동작하지 않으므로
     * FileProvider URI 방식으로 직접 쓴다.
     */
    @Command
    fun writeImageToClipboard(invoke: Invoke) {
        val args = invoke.parseArgs(WriteImageArgs::class.java)
        try {
            val bytes = Base64.decode(args.base64, Base64.DEFAULT)
            val cacheFile = File(activity.cacheDir, "clipboard_image_${System.currentTimeMillis()}.png")
            cacheFile.writeBytes(bytes)

            val contentUri = FileProvider.getUriForFile(
                activity,
                "${activity.packageName}.fileprovider",
                cacheFile
            )

            val clipboard = activity.getSystemService(ClipboardManager::class.java)
            val clip = ClipData("ClipRelay", arrayOf(args.mimeType), ClipData.Item(contentUri))
            clipboard.setPrimaryClip(clip)

            // 캐시 파일 정리 (최근 5개만)
            val files = activity.cacheDir.listFiles { file ->
                file.name.startsWith("clipboard_image_") && file.name.endsWith(".png")
            }
            if (files != null && files.size > 5) {
                files.sortBy { it.lastModified() }
                for (i in 0 until files.size - 5) files[i].delete()
            }

            val result = JSObject()
            result.put("success", true)
            invoke.resolve(result)
        } catch (e: Exception) {
            invoke.reject("writeImageToClipboard failed: ${e.message}")
        }
    }

}
