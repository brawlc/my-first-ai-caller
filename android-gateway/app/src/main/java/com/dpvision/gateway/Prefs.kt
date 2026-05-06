package com.dpvision.gateway

import android.content.Context

private const val PREFS_NAME = "dpvision_gateway_prefs"
private const val KEY_BASE_URL = "base_url"
private const val KEY_CALENDAR_TOKEN = "calendar_token"
private const val KEY_ACTIVE_SESSION_ID = "active_session_id"

object Prefs {
  fun getBaseUrl(context: Context): String {
    val value = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(KEY_BASE_URL, null)
    return value?.trim().orEmpty()
  }

  fun setBaseUrl(context: Context, value: String) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_BASE_URL, value.trim())
      .apply()
  }

  fun getCalendarToken(context: Context): String {
    val value = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(KEY_CALENDAR_TOKEN, null)
    return value?.trim().orEmpty()
  }

  fun setCalendarToken(context: Context, value: String) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_CALENDAR_TOKEN, value.trim())
      .apply()
  }

  fun getActiveSessionId(context: Context): String {
    val value = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(KEY_ACTIVE_SESSION_ID, null)
    return value?.trim().orEmpty()
  }

  fun setActiveSessionId(context: Context, value: String) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_ACTIVE_SESSION_ID, value.trim())
      .apply()
  }

  fun clearActiveSessionId(context: Context) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .remove(KEY_ACTIVE_SESSION_ID)
      .apply()
  }
}
