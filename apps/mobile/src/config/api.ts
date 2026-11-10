/**
 * API client — single remote backend, bearer-token auth, session-expiry hook.
 *
 * Production builds always talk to the Render backend over HTTPS. A custom
 * EXPO_PUBLIC_BACKEND_URL is honoured only if it is HTTPS (or in __DEV__), so a
 * stale LAN/tunnel URL can never be baked into a release APK.
 */
const PRODUCTION_API = 'https://runwars-v2.onrender.com';

function resolveBaseUrl(): string {
  const fromEnv = (process.env.EXPO_PUBLIC_BACKEND_URL || '').trim().replace(/\/+$/, '');
  if (!fromEnv) return PRODUCTION_API;
  if (__DEV__) return fromEnv;
  // Explicit opt-in for QA builds pointed at an isolated test backend. Never set for distribution builds.
  if (process.env.EXPO_PUBLIC_API_TEST_MODE === '1' && /^https:\/\//i.test(fromEnv)) return fromEnv;
  // Release: only trust a stable HTTPS host; ephemeral tunnels are never used.
  if (/^https:\/\//i.test(fromEnv) && !/trycloudflare\.com|loca\.lt|ngrok/i.test(fromEnv)) return fromEnv;
  return PRODUCTION_API;
}

export const API_BASE_URL = resolveBaseUrl();
export const SOCKET_URL = API_BASE_URL;
/** Kept for backwards compatibility with older imports. */
export const API_URL = API_BASE_URL;
export const CANDIDATE_API_URLS = [API_BASE_URL];

export function getActiveBaseUrl(): string {
  return API_BASE_URL;
}

// ─── Auth token plumbing ──────────────────────────────────────────────────────

let authToken: string | null = null;
let onUnauthorized: ((code: string) => void) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

/** Called once by AuthContext; fired when the server says the session is no longer valid. */
export function setUnauthorizedHandler(handler: ((code: string) => void) | null) {
  onUnauthorized = handler;
}

const TIMEOUT_MS = 25000; // Render free tier can take ~30 s to wake; one retry covers the rest.

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export class NetworkError extends Error {
  constructor(message = 'Could not reach the StrideClash server. Check your internet connection and try again.') {
    super(message);
    this.name = 'NetworkError';
  }
}

export async function apiFetch(endpoint: string, init?: RequestInit): Promise<Response> {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = `${API_BASE_URL}${cleanEndpoint}`;
  const sentToken = authToken;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...((init?.headers as Record<string, string>) || {}),
  };
  if (sentToken && !headers.Authorization) headers.Authorization = `Bearer ${sentToken}`;

  const method = (init?.method || 'GET').toUpperCase();
  const attempts = method === 'GET' ? 2 : 1; // never auto-retry writes (avoid duplicates)
  let lastErr: unknown = null;

  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetchWithTimeout(url, { ...init, headers });
      if (res.status === 401 && sentToken && onUnauthorized && !cleanEndpoint.startsWith('/api/auth/login')) {
        // Peek at the error code without consuming the caller's body.
        res.clone().json().then(
          (b: any) => {
            if (b?.code === 'TOKEN_EXPIRED' || b?.code === 'TOKEN_INVALID') onUnauthorized?.(b.code);
          },
          () => {}
        );
      }
      return res;
    } catch (e) {
      lastErr = e;
    }
  }
  console.warn('[api] network failure', method, cleanEndpoint, lastErr);
  throw new NetworkError();
}

/** Parses an error body into a user-facing message. */
export async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const b = await res.json();
    if (b?.error) return String(b.error);
  } catch {}
  return fallback;
}
