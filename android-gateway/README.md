# DPvision Android Gateway App

This Android app bridges SIM call lifecycle to your backend session APIs:

- `POST /api/android/session/start`
- `POST /api/android/session/turn`
- `POST /api/android/session/end`

## Open in Android Studio

1. Open Android Studio.
2. Choose **Open**.
3. Select folder: `android-gateway`.
4. Let Gradle sync.
5. Run on a real Android device (SIM device), not emulator.

## Device prep

1. Keep backend running on your PC:
   - `start-app.bat`
2. Find your PC local IP (example: `192.168.1.20`).
3. In Android app, set backend URL:
   - `http://<PC_LOCAL_IP>:3001`
4. Grant permissions:
   - Phone state
   - Microphone

## Current behavior

- Foreground service listens for call state changes.
- When incoming call gets answered, app starts backend session.
- On call end, app closes backend session.
- Manual turn textbox lets you send a caller utterance and hear TTS reply.

## Notes

- This is phase-1 bridge scaffolding.
- Full unattended conversational automation on cellular calls typically needs default dialer/in-call integration on Android.
