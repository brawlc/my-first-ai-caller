declare const google: any;

const BUILD_CLIENT_ID = String(import.meta.env.VITE_CLIENT_ID || '').trim();
let runtimeClientId: string | null = null;
let runtimeClientIdLoaded = false;

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly'
].join(' ');

let accessTokenCache: string | null = null;
let tokenExpiresAt: number = 0;
let persistedTokenLoaded = false;
let accountHintCache: string | null = null;

const TOKEN_KEY = 'dpvision_google_access_token_v1';
const TOKEN_EXPIRY_KEY = 'dpvision_google_access_token_expiry_v1';
const ACCOUNT_HINT_KEY = 'dpvision_google_account_hint_v1';

async function resolveClientId(): Promise<string> {
  if (runtimeClientIdLoaded) {
    return runtimeClientId || BUILD_CLIENT_ID;
  }

  runtimeClientIdLoaded = true;
  try {
    const response = await fetch('/api/runtime-config', { cache: 'no-store' });
    if (response.ok) {
      const payload = (await response.json()) as { clientId?: string };
      runtimeClientId = String(payload?.clientId || '').trim() || null;
    }
  } catch (_error) {
    runtimeClientId = null;
  }

  return runtimeClientId || BUILD_CLIENT_ID;
}

export async function isCalendarConfigured(): Promise<boolean> {
  const clientId = await resolveClientId();
  return Boolean(clientId);
}

export async function getConfiguredClientId(): Promise<string> {
  return resolveClientId();
}

function loadPersistedAccessToken() {
  if (persistedTokenLoaded) return;
  persistedTokenLoaded = true;

  if (typeof window === 'undefined') return;
  try {
    const token = window.localStorage.getItem(TOKEN_KEY);
    const expiry = Number(window.localStorage.getItem(TOKEN_EXPIRY_KEY) || '0');
    const accountHint = window.localStorage.getItem(ACCOUNT_HINT_KEY);
    accountHintCache = accountHint && accountHint.includes('@') ? accountHint : null;
    if (token && expiry && Date.now() < expiry) {
      accessTokenCache = token;
      tokenExpiresAt = expiry;
      return;
    }
  } catch (_error) {
    // Ignore storage failures and continue with in-memory auth.
  }

  accessTokenCache = null;
  tokenExpiresAt = 0;
}

function persistAccessToken(token: string, expiry: number) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(TOKEN_EXPIRY_KEY, String(expiry));
  } catch (_error) {
    // Ignore storage failures.
  }
}

export function setGoogleAccountHint(email: string | null | undefined) {
  const normalized = String(email || '').trim();
  accountHintCache = normalized.includes('@') ? normalized : null;
  if (typeof window === 'undefined') return;
  try {
    if (accountHintCache) {
      window.localStorage.setItem(ACCOUNT_HINT_KEY, accountHintCache);
    } else {
      window.localStorage.removeItem(ACCOUNT_HINT_KEY);
    }
  } catch (_error) {
    // Ignore storage failures.
  }
}

export function clearCachedAccessToken() {
  accessTokenCache = null;
  tokenExpiresAt = 0;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(TOKEN_EXPIRY_KEY);
  } catch (_error) {
    // Ignore storage failures.
  }
}

export function getCachedAccessToken(): string | null {
  loadPersistedAccessToken();
  if (accessTokenCache && Date.now() < tokenExpiresAt) {
    return accessTokenCache;
  }
  clearCachedAccessToken();
  return null;
}

async function calendarGet<T = any>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Calendar API error: ${payload || response.statusText}`);
  }
  return (await response.json()) as T;
}

export async function getConnectedCalendarInfo(token?: string): Promise<{ id: string; summary: string; timeZone?: string }> {
  const accessToken = token || (await getAccessToken());
  const payload = await calendarGet<{ id?: string; summary?: string; timeZone?: string }>('/users/me/calendarList/primary', accessToken);
  return {
    id: String(payload?.id || 'primary'),
    summary: String(payload?.summary || 'Primary Calendar'),
    timeZone: payload?.timeZone,
  };
}

export async function getAccessToken(options?: { interactive?: boolean }): Promise<string> {
  loadPersistedAccessToken();
  if (accessTokenCache && Date.now() < tokenExpiresAt) {
    return accessTokenCache;
  }

  const clientId = await resolveClientId();

  if (!clientId) {
    throw new Error('VITE_CLIENT_ID is missing. Please add it to the Settings menu.');
  }

  if (typeof google === 'undefined') {
    throw new Error('Google Identity Services script is still loading. Please wait a moment and try again.');
  }

  const interactive = options?.interactive !== false;

  return new Promise((resolve, reject) => {
    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        login_hint: accountHintCache || undefined,
        error_callback: (error: any) => {
          const reason = error?.type || error?.message || error?.error || 'OAuth popup failed';
          if (String(reason).toLowerCase().includes('invalid_client')) {
            reject(
              new Error(
                `Google OAuth invalid_client: this client ID is not recognized by Google. Update VITE_CLIENT_ID with an active OAuth Web Client ID.`
              )
            );
            return;
          }
          reject(new Error(`Google OAuth error: ${reason}`));
        },
        callback: (response: any) => {
          if (response.access_token) {
            accessTokenCache = response.access_token;
            // Access tokens typically expire in 3600 seconds. 
            // We'll set the cache to 55 minutes to be safe.
            tokenExpiresAt = Date.now() + 55 * 60 * 1000;
            persistAccessToken(accessTokenCache, tokenExpiresAt);
            resolve(response.access_token);
          } else if (response.error) {
            if (response.error === 'invalid_client') {
              reject(
                new Error(
                  'Google OAuth invalid_client: this client ID is deleted/wrong project. Create or use an active OAuth Web Client ID and place it in VITE_CLIENT_ID.'
                )
              );
              return;
            }
            if (response.error === 'invalid_grant' || response.error === 'access_denied') {
              clearCachedAccessToken();
            }
            reject(new Error(`Google OAuth denied: ${response.error}`));
          } else {
            reject(new Error('Failed to get access token: ' + (response.error || 'Unknown error')));
          }
        },
      });
      client.requestAccessToken({ prompt: interactive ? (accessTokenCache ? '' : 'consent') : '' });
    } catch (error) {
      reject(error);
    }
  });
}

export async function createCalendarEvent(event: {
  summary: string;
  description: string;
  start: { dateTime: string; timeZone?: string };
  end: { dateTime: string; timeZone?: string };
  attendees?: Array<{ email: string }>;
}) {
  const token = await getAccessToken();
  const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Calendar API error: ${payload || response.statusText}`);
  }

  return (await response.json()) as any;
}
