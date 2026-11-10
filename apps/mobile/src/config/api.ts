export const CANDIDATE_API_URLS = [
  process.env.EXPO_PUBLIC_BACKEND_URL || 'https://cool-blair-show-brisbane.trycloudflare.com',
  'http://192.168.29.185:3000',
  'https://runwars-v2.onrender.com',
  'http://10.0.2.2:3000'
].filter(Boolean);

let activeBaseUrl = CANDIDATE_API_URLS[0];

export function getActiveBaseUrl(): string {
  return activeBaseUrl;
}

export function setActiveBaseUrl(url: string) {
  activeBaseUrl = url;
}

export async function apiFetch(endpoint: string, init?: RequestInit): Promise<Response> {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const urlsToTry = [activeBaseUrl, ...CANDIDATE_API_URLS.filter(u => u !== activeBaseUrl)];
  let lastErr: any = null;

  for (const base of urlsToTry) {
    try {
      const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
      const fullUrl = `${cleanBase}${cleanEndpoint}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(fullUrl, {
        ...init,
        signal: controller.signal,
        headers: {
          'Bypass-Tunnel-Reminder': 'true',
          ...(init?.headers || {})
        }
      });
      clearTimeout(timeoutId);
      activeBaseUrl = base;
      return res;
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error('Network request failed. Please check internet connection.');
}

export const API_URL = CANDIDATE_API_URLS[0];
export const SOCKET_URL = CANDIDATE_API_URLS[0];
