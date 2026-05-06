package com.dpvision.gateway

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.telephony.PhoneStateListener
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import androidx.core.app.NotificationCompat
import java.util.concurrent.Executors

class CallBridgeService : Service() {
  private val executor = Executors.newSingleThreadExecutor()
  private var telephonyManager: TelephonyManager? = null
  private var phoneStateListener: PhoneStateListener? = null
  private var telephonyCallback: TelephonyCallback? = null
  private var lastCallState = TelephonyManager.CALL_STATE_IDLE
  private var lastIncomingNumber = ""

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
    startForeground(NOTIFICATION_ID, buildNotification("Listening for calls"))
    registerCallListener()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        updateStatus("Bridge stopped")
        stopSelf()
      }
      ACTION_START, null -> updateStatus("Bridge running")
    }
    return START_STICKY
  }

  override fun onDestroy() {
    unregisterCallListener()
    executor.shutdownNow()
    super.onDestroy()
  }

  private fun registerCallListener() {
    val tm = getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager ?: return
    telephonyManager = tm

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val callback = object : TelephonyCallback(), TelephonyCallback.CallStateListener {
        override fun onCallStateChanged(state: Int) {
          handleCallState(state, null)
        }
      }
      telephonyCallback = callback
      tm.registerTelephonyCallback(mainExecutor, callback)
    } else {
      val listener = object : PhoneStateListener() {
        override fun onCallStateChanged(state: Int, phoneNumber: String?) {
          handleCallState(state, phoneNumber)
        }
      }
      phoneStateListener = listener
      @Suppress("DEPRECATION")
      tm.listen(listener, PhoneStateListener.LISTEN_CALL_STATE)
    }
  }

  private fun unregisterCallListener() {
    val tm = telephonyManager ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val callback = telephonyCallback ?: return
      tm.unregisterTelephonyCallback(callback)
      telephonyCallback = null
    } else {
      val listener = phoneStateListener ?: return
      @Suppress("DEPRECATION")
      tm.listen(listener, PhoneStateListener.LISTEN_NONE)
      phoneStateListener = null
    }
  }

  private fun handleCallState(state: Int, incomingNumber: String?) {
    if (state == lastCallState && incomingNumber.isNullOrBlank()) return

    if (state == TelephonyManager.CALL_STATE_RINGING && !incomingNumber.isNullOrBlank()) {
      lastIncomingNumber = incomingNumber
      updateStatus("Incoming call: $incomingNumber")
    }

    if (lastCallState == TelephonyManager.CALL_STATE_RINGING && state == TelephonyManager.CALL_STATE_OFFHOOK) {
      onCallAnswered(lastIncomingNumber.ifBlank { "unknown" })
    }

    if (state == TelephonyManager.CALL_STATE_IDLE && lastCallState != TelephonyManager.CALL_STATE_IDLE) {
      onCallEnded()
      lastIncomingNumber = ""
    }

    lastCallState = state
  }

  private fun onCallAnswered(callerNumber: String) {
    val baseUrl = Prefs.getBaseUrl(this)
    val calendarToken = Prefs.getCalendarToken(this)
    if (baseUrl.isBlank()) {
      updateStatus("Set backend URL in app first.")
      return
    }

    executor.execute {
      val result = BackendClient.startSession(baseUrl, callerNumber, calendarToken)
      result.fold(
        onSuccess = { response ->
          Prefs.setActiveSessionId(this, response.sessionId)
          val opening = response.replyText.ifBlank { response.openingLine }
          updateStatus("Call linked. Session: ${response.sessionId}\nAgent: $opening")
        },
        onFailure = { error ->
          updateStatus("Session start failed: ${error.message}")
        }
      )
    }
  }

  private fun onCallEnded() {
    val baseUrl = Prefs.getBaseUrl(this)
    val sessionId = Prefs.getActiveSessionId(this)
    if (baseUrl.isBlank() || sessionId.isBlank()) {
      Prefs.clearActiveSessionId(this)
      return
    }

    executor.execute {
      BackendClient.endSession(baseUrl, sessionId)
      Prefs.clearActiveSessionId(this)
      updateStatus("Call ended. Session closed.")
    }
  }

  private fun updateStatus(text: String) {
    val broadcast = Intent(ACTION_STATUS)
      .setPackage(packageName)
      .putExtra(EXTRA_STATUS_TEXT, text)
    sendBroadcast(broadcast)

    val manager = getSystemService(NotificationManager::class.java)
    manager.notify(NOTIFICATION_ID, buildNotification(text))
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    val channel = NotificationChannel(
      CHANNEL_ID,
      "DPvision Call Bridge",
      NotificationManager.IMPORTANCE_LOW
    )
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(status: String): Notification {
    val launchIntent = Intent(this, MainActivity::class.java)
    val pendingIntent = PendingIntent.getActivity(
      this,
      101,
      launchIntent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("DPvision Android Gateway")
      .setContentText(status)
      .setSmallIcon(android.R.drawable.stat_sys_phone_call)
      .setContentIntent(pendingIntent)
      .setOngoing(true)
      .build()
  }

  companion object {
    const val ACTION_START = "com.dpvision.gateway.action.START"
    const val ACTION_STOP = "com.dpvision.gateway.action.STOP"
    const val ACTION_STATUS = "com.dpvision.gateway.action.STATUS"
    const val EXTRA_STATUS_TEXT = "extra_status_text"
    private const val CHANNEL_ID = "dpvision_bridge_channel"
    private const val NOTIFICATION_ID = 3011
  }
}
