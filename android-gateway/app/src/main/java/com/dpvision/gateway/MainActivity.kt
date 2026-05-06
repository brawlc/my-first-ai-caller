package com.dpvision.gateway

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.util.Locale
import java.util.concurrent.Executors

class MainActivity : ComponentActivity() {
  private lateinit var backendUrlInput: EditText
  private lateinit var calendarTokenInput: EditText
  private lateinit var userTurnInput: EditText
  private lateinit var statusText: TextView
  private lateinit var replyText: TextView
  private val executor = Executors.newSingleThreadExecutor()
  private var tts: TextToSpeech? = null

  private val statusReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (intent?.action != CallBridgeService.ACTION_STATUS) return
      val status = intent.getStringExtra(CallBridgeService.EXTRA_STATUS_TEXT).orEmpty()
      if (status.isNotBlank()) {
        statusText.text = "Status: $status"
      }
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.activity_main)

    backendUrlInput = findViewById(R.id.backendUrlInput)
    calendarTokenInput = findViewById(R.id.calendarTokenInput)
    userTurnInput = findViewById(R.id.userTurnInput)
    statusText = findViewById(R.id.statusText)
    replyText = findViewById(R.id.replyText)

    val saveConfigButton: Button = findViewById(R.id.saveConfigButton)
    val startBridgeButton: Button = findViewById(R.id.startBridgeButton)
    val stopBridgeButton: Button = findViewById(R.id.stopBridgeButton)
    val sendTurnButton: Button = findViewById(R.id.sendTurnButton)

    backendUrlInput.setText(Prefs.getBaseUrl(this))
    calendarTokenInput.setText(Prefs.getCalendarToken(this))
    statusText.text = "Status: ready"

    saveConfigButton.setOnClickListener {
      Prefs.setBaseUrl(this, backendUrlInput.text.toString())
      Prefs.setCalendarToken(this, calendarTokenInput.text.toString())
      statusText.text = "Status: config saved"
    }

    startBridgeButton.setOnClickListener {
      requestRuntimePermissionsIfNeeded()
      Prefs.setBaseUrl(this, backendUrlInput.text.toString())
      Prefs.setCalendarToken(this, calendarTokenInput.text.toString())
      val intent = Intent(this, CallBridgeService::class.java).apply { action = CallBridgeService.ACTION_START }
      ContextCompat.startForegroundService(this, intent)
      statusText.text = "Status: bridge starting..."
    }

    stopBridgeButton.setOnClickListener {
      val intent = Intent(this, CallBridgeService::class.java).apply { action = CallBridgeService.ACTION_STOP }
      startService(intent)
      statusText.text = "Status: bridge stopping..."
    }

    sendTurnButton.setOnClickListener {
      val baseUrl = backendUrlInput.text.toString().trim()
      val sessionId = Prefs.getActiveSessionId(this)
      val text = userTurnInput.text.toString().trim()
      val calendarToken = calendarTokenInput.text.toString().trim()

      if (baseUrl.isBlank()) {
        statusText.text = "Status: set backend URL first."
        return@setOnClickListener
      }
      if (sessionId.isBlank()) {
        statusText.text = "Status: no active session. Start/answer a call first."
        return@setOnClickListener
      }
      if (text.isBlank()) {
        statusText.text = "Status: type text first."
        return@setOnClickListener
      }

      statusText.text = "Status: sending turn..."
      executor.execute {
        val result = BackendClient.sendTurn(baseUrl, sessionId, text, calendarToken)
        runOnUiThread {
          result.fold(
            onSuccess = { response ->
              replyText.text = response.replyText
              statusText.text = if (response.shouldEnd) "Status: session ended by agent." else "Status: turn complete."
              speak(response.replyText)
              if (response.shouldEnd) {
                Prefs.clearActiveSessionId(this)
              }
            },
            onFailure = { error ->
              statusText.text = "Status: turn failed - ${error.message}"
            }
          )
        }
      }
    }

    tts = TextToSpeech(this) { status ->
      if (status == TextToSpeech.SUCCESS) {
        tts?.language = Locale("en", "IN")
      }
    }

    requestRuntimePermissionsIfNeeded()
  }

  override fun onStart() {
    super.onStart()
    val filter = IntentFilter(CallBridgeService.ACTION_STATUS)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(statusReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("DEPRECATION")
      registerReceiver(statusReceiver, filter)
    }
  }

  override fun onStop() {
    unregisterReceiver(statusReceiver)
    super.onStop()
  }

  override fun onDestroy() {
    tts?.shutdown()
    executor.shutdownNow()
    super.onDestroy()
  }

  private fun requestRuntimePermissionsIfNeeded() {
    val permissions = mutableListOf<String>()
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
      permissions.add(Manifest.permission.READ_PHONE_STATE)
    }
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      permissions.add(Manifest.permission.RECORD_AUDIO)
    }
    if (permissions.isNotEmpty()) {
      ActivityCompat.requestPermissions(this, permissions.toTypedArray(), 1001)
    }
  }

  private fun speak(text: String) {
    val spokenText = text
      .replace(Regex("\\bDPvision\\b", RegexOption.IGNORE_CASE), "D P vision")
      .replace(Regex("\\bDP\\s*vision\\b", RegexOption.IGNORE_CASE), "D P vision")
    tts?.speak(spokenText, TextToSpeech.QUEUE_FLUSH, null, "dpvision-reply")
  }
}
