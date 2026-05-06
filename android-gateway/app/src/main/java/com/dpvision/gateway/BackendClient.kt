package com.dpvision.gateway

import com.google.gson.Gson
import com.google.gson.JsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

data class StartSessionResponse(
  val ok: Boolean = false,
  val sessionId: String = "",
  val openingLine: String = "",
  val replyText: String = "",
  val resumed: Boolean = false
)

data class TurnSessionResponse(
  val ok: Boolean = false,
  val replyText: String = "",
  val shouldEnd: Boolean = false
)

object BackendClient {
  private val gson = Gson()
  private val http = OkHttpClient.Builder()
    .connectTimeout(8, TimeUnit.SECONDS)
    .readTimeout(20, TimeUnit.SECONDS)
    .writeTimeout(20, TimeUnit.SECONDS)
    .build()

  private val jsonContentType = "application/json; charset=utf-8".toMediaType()

  private fun normalizeBaseUrl(baseUrl: String): String {
    return baseUrl.trim().trimEnd('/')
  }

  fun health(baseUrl: String): Result<String> {
    return runCatching {
      val url = "${normalizeBaseUrl(baseUrl)}/api/health"
      val request = Request.Builder().url(url).get().build()
      http.newCall(request).execute().use { response ->
        if (!response.isSuccessful) {
          throw IllegalStateException("Health check failed: ${response.code}")
        }
        response.body?.string().orEmpty()
      }
    }
  }

  fun startSession(baseUrl: String, callerNumber: String, calendarToken: String): Result<StartSessionResponse> {
    return runCatching {
      val url = "${normalizeBaseUrl(baseUrl)}/api/android/session/start"
      val payload = JsonObject().apply {
        addProperty("callerNumber", callerNumber)
        addProperty("timeZone", "Asia/Calcutta")
        if (calendarToken.isNotBlank()) {
          addProperty("calendarToken", calendarToken)
        }
      }

      val request = Request.Builder()
        .url(url)
        .post(gson.toJson(payload).toRequestBody(jsonContentType))
        .build()

      http.newCall(request).execute().use { response ->
        val raw = response.body?.string().orEmpty()
        if (!response.isSuccessful) {
          throw IllegalStateException("Session start failed (${response.code}): $raw")
        }
        gson.fromJson(raw, StartSessionResponse::class.java)
      }
    }
  }

  fun sendTurn(
    baseUrl: String,
    sessionId: String,
    userText: String,
    calendarToken: String
  ): Result<TurnSessionResponse> {
    return runCatching {
      val url = "${normalizeBaseUrl(baseUrl)}/api/android/session/turn"
      val payload = JsonObject().apply {
        addProperty("sessionId", sessionId)
        addProperty("userText", userText)
        addProperty("timeZone", "Asia/Calcutta")
        if (calendarToken.isNotBlank()) {
          addProperty("calendarToken", calendarToken)
        }
      }

      val request = Request.Builder()
        .url(url)
        .post(gson.toJson(payload).toRequestBody(jsonContentType))
        .build()

      http.newCall(request).execute().use { response ->
        val raw = response.body?.string().orEmpty()
        if (!response.isSuccessful) {
          throw IllegalStateException("Turn failed (${response.code}): $raw")
        }
        gson.fromJson(raw, TurnSessionResponse::class.java)
      }
    }
  }

  fun endSession(baseUrl: String, sessionId: String): Result<Unit> {
    return runCatching {
      val url = "${normalizeBaseUrl(baseUrl)}/api/android/session/end"
      val payload = JsonObject().apply {
        addProperty("sessionId", sessionId)
      }

      val request = Request.Builder()
        .url(url)
        .post(gson.toJson(payload).toRequestBody(jsonContentType))
        .build()

      http.newCall(request).execute().use { response ->
        val raw = response.body?.string().orEmpty()
        if (!response.isSuccessful) {
          throw IllegalStateException("End session failed (${response.code}): $raw")
        }
      }
    }
  }
}
