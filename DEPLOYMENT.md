# Deployment

Use a hosted web service when you want the app to work from a normal link without opening local files, batch scripts, or tunnels.

## Recommended Setup

Deploy this repo as a Node web service. The included `render.yaml` is ready for Render Blueprint deploys.

Build command:

```bash
npm ci && npm run build
```

Start command:

```bash
npm start
```

Health check:

```text
/api/health
```

## Required Environment Variables

Set these in the hosting dashboard:

```env
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash
VITE_CLIENT_ID=...apps.googleusercontent.com
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

`PUBLIC_BASE_URL` is optional on a real hosted HTTPS domain. The backend will infer the host from the incoming request. Set `PUBLIC_BASE_URL` only if the host sends unusual proxy headers or if you use a custom domain and want to force that exact URL.

## Twilio URLs

After deployment, use your hosted domain:

```text
https://your-app-domain.example/twilio/voice
https://your-app-domain.example/twilio/respond
```

The in-app SIP Dialer calls `/api/dialer/call`, and the backend passes `/twilio/voice` to Twilio automatically.

## Local Tunnel Note

The temporary localhost tunnel is only for testing. A hosted deployment is the correct path for a normal website link that works even when your PC is not running the app.
