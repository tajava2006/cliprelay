package com.hoppe.cliprelay.foreground

import android.os.Handler
import android.os.Looper
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.Collections
import java.util.concurrent.TimeUnit

/**
 * 네이티브 OkHttp WebSocket 기반 Nostr 릴레이 클라이언트.
 *
 * WebView의 JS WebSocket과 달리 Android 백그라운드에서도
 * Foreground Service + WakeLock 아래에서 무한정 살아있다.
 *
 * kind:9372 클립보드 이벤트만 구독하고, client 태그가 "cliprelay"인 것만 처리한다.
 */
class NativeRelayClient(
    private val relayUrls: List<String>,
    private val userPubkey: String,
    private val since: Long,
    private val onEvent: (NostrEvent) -> Unit,
) {
    companion object {
        private const val TAG = "NativeRelayClient"
        private const val CLIPBOARD_KIND = 9372
        private const val CLIENT_TAG_VALUE = "cliprelay"
        private const val RECONNECT_DELAY_MS = 5000L
    }

    data class NostrEvent(
        val id: String,
        val createdAt: Long,
        val content: String,
    )

    private val client = OkHttpClient.Builder()
        .pingInterval(30, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    private val connections = mutableMapOf<String, WebSocket>()
    private val processedIds: MutableSet<String> = Collections.synchronizedSet(HashSet())
    private val handler = Handler(Looper.getMainLooper())
    @Volatile private var stopped = false

    fun start() {
        stopped = false
        for (url in relayUrls) {
            connectToRelay(url)
        }
        Log.d(TAG, "Started: ${relayUrls.size} relay(s), since=$since")
    }

    fun stop() {
        stopped = true
        handler.removeCallbacksAndMessages(null)
        synchronized(connections) {
            connections.values.forEach {
                try { it.close(1000, "shutdown") } catch (_: Exception) {}
            }
            connections.clear()
        }
        processedIds.clear()
        Log.d(TAG, "Stopped")
    }

    private fun connectToRelay(url: String) {
        if (stopped) return

        val request = Request.Builder().url(url).build()
        val ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d(TAG, "Connected: $url")
                val subId = "nc-${url.hashCode().toString(16).takeLast(8)}"
                val req = JSONArray().apply {
                    put("REQ")
                    put(subId)
                    put(JSONObject().apply {
                        put("kinds", JSONArray().put(CLIPBOARD_KIND))
                        put("authors", JSONArray().put(userPubkey))
                        put("since", since)
                    })
                }.toString()
                webSocket.send(req)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val msg = JSONArray(text)
                    when (msg.getString(0)) {
                        "EVENT" -> {
                            if (msg.length() >= 3) handleEvent(msg.getJSONObject(2))
                        }
                        "EOSE" -> Log.d(TAG, "EOSE: $url")
                        "CLOSED" -> {
                            Log.w(TAG, "CLOSED by $url")
                            scheduleReconnect(url)
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Parse error ($url): ${e.javaClass.simpleName}")
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "Closed: $url ($code)")
                synchronized(connections) { connections.remove(url) }
                scheduleReconnect(url)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.w(TAG, "Failed: $url (${t.javaClass.simpleName})")
                synchronized(connections) { connections.remove(url) }
                scheduleReconnect(url)
            }
        })
        synchronized(connections) { connections[url] = ws }
    }

    private fun handleEvent(eventObj: JSONObject) {
        val id = eventObj.getString("id")
        if (!processedIds.add(id)) return

        val tags = eventObj.getJSONArray("tags")
        var clientTag: String? = null
        for (i in 0 until tags.length()) {
            val tag = tags.getJSONArray(i)
            if (tag.length() >= 2 && tag.getString(0) == "client") {
                clientTag = tag.getString(1)
                break
            }
        }
        if (clientTag != CLIENT_TAG_VALUE) return

        Log.d(TAG, "Event: ${id.take(8)}")
        onEvent(NostrEvent(id, eventObj.getLong("created_at"), eventObj.getString("content")))
    }

    private fun scheduleReconnect(url: String) {
        if (stopped) return
        handler.postDelayed({ connectToRelay(url) }, RECONNECT_DELAY_MS)
    }
}
