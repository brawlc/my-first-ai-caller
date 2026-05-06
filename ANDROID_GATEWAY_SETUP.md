# Android SIM Gateway Setup (DPvision AI)

This guide connects your Android SIM call flow to the backend you already have.

## What is already done

Your backend now supports Android call sessions:

- `POST /api/android/session/start`
- `POST /api/android/session/turn`
- `GET /api/android/session/:sessionId`
- `POST /api/android/session/end`

These use the same Gemini + scheduling logic as `/live`.

## Important Android reality

For full unattended behavior on cellular calls, Android typically needs the app to act as the **default dialer** (`InCallService` flow).  
Without that, automation is partial only.

Reference:
- https://developer.android.com/develop/connectivity/telecom/dialer-app
- https://developer.android.com/reference/android/telecom/InCallService

## Phase 1 (today): backend + manual bridge test

1. Start backend:

```bat
start-app.bat
```

2. Verify health:

`http://localhost:3001/api/health`

3. Start Android session (from Postman / curl):

```bash
curl -X POST http://localhost:3001/api/android/session/start \
  -H "Content-Type: application/json" \
  -d '{"callerNumber":"+91XXXXXXXXXX","timeZone":"Asia/Calcutta"}'
```

4. Send caller turn:

```bash
curl -X POST http://localhost:3001/api/android/session/turn \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"android-...","userText":"hi"}'
```

5. End session:

```bash
curl -X POST http://localhost:3001/api/android/session/end \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"android-..."}'
```

## Phase 2: Android app bridge

Build a small Android app with:

- Incoming call detection / call-state handling
- Speech-to-text for caller input
- Calls `/api/android/session/turn` for agent response
- Text-to-speech playback for response
- End call/session handling

## Phase 3: True SIM automation

Set app as default dialer + in-call UI so call controls and flow are reliable for real cellular calls.

## Notes

- Keep backend reachable by Android (same Wi-Fi + local IP, or deployed HTTPS API).
- Keep one SIM dedicated to this automation device for stability.
- Use a headset/earpiece test first to tune voice latency.
