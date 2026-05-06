# DPvision Analytics - Pooja AI

## Run locally

1. Install dependencies:
   `npm install`
2. Add your Gemini key to `.env.local`:
   `GEMINI_API_KEY=...`
3. Add Google OAuth client id to `.env.local` (for Calendar booking):
   `VITE_CLIENT_ID=...apps.googleusercontent.com`
4. Start the app:
   `start-app.bat`

Open `http://localhost:3001/live`

## Normal Website Link

For a link that works like a regular website without opening local files or keeping a tunnel running, deploy the app as a hosted Node web service. This repo includes `render.yaml` for Render Blueprint deployment.

See `DEPLOYMENT.md`.

## Prompt control

Use `agent-prompt.txt` to edit the single Gemini prompt.
The first line is the opening line. Everything after that is the system prompt.
It saves exactly what you type.

Health check: `http://localhost:3001/api/health`
Gemini debug status: `http://localhost:3001/api/agent-status` (check `lastGeminiError`).

## Outbound SIP/Twilio Dialer

The Live Agent page includes a dialer that starts an outbound AI call and routes the call into `/twilio/voice`.

Add these to `.env.local`:

```env
PUBLIC_BASE_URL=https://your-public-url.example
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+1XXXXXXXXXX
DIALER_MODE=twilio
```

For SIP URI mode:

```env
DIALER_MODE=sip
SIP_TRUNK_DOMAIN=your-sip-trunk-domain.example
SIP_AUTH_USERNAME=optional
SIP_AUTH_PASSWORD=optional
```

For local testing, `PUBLIC_BASE_URL` must be a public HTTPS tunnel URL that reaches this app. On a real hosted HTTPS deployment, it is optional because the backend can infer the hosted domain.

## Google Calendar

Use **Lead Management** -> **Connect Calendar** and then **Book Demo** on any lead.
This creates a 30-minute event in your Google primary calendar and can add the lead email as attendee.

In **Live Agent** chat, Pooja can also automate scheduling:
- asks for preferred date/time + email
- checks if the slot is available
- if busy, suggests an alternate slot on the same day
- books automatically after the lead confirms

## Android Gateway

An Android bridge app scaffold is available in:

- `android-gateway/`

Open that folder in Android Studio and follow:

- `android-gateway/README.md`

## Android SIM Gateway Mode

This repo now includes Android-first call session APIs so you can keep one backend brain and connect an Android SIM gateway app to it.

### 1) Start a call session

`POST /api/android/session/start`

```json
{
  "callerNumber": "+91XXXXXXXXXX",
  "timeZone": "Asia/Calcutta",
  "calendarToken": "optional-google-access-token"
}
```

Response includes `sessionId` and `openingLine`.

### 2) Send each caller turn

`POST /api/android/session/turn`

```json
{
  "sessionId": "android-...",
  "userText": "Can you book a demo for 30 April at 4 pm?",
  "calendarToken": "optional-google-access-token",
  "timeZone": "Asia/Calcutta"
}
```

Response includes `replyText`, `sentiment`, `shouldEnd`.

### 3) End call

`POST /api/android/session/end`

```json
{
  "sessionId": "android-..."
}
```

### 4) Session status

`GET /api/android/session/:sessionId`

Use this from your Android bridge logic to keep the call state synced with the same Gemini + Calendar pipeline used by the web app.
