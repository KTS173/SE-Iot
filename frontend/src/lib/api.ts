// Production uses nginx's same-origin /api proxy, so the Pi's IP/hostname does
// not need to be baked into the frontend image.
export const API_URL = import.meta.env.VITE_API_URL || "";

const unauthorizedListeners = new Set<() => void>();

/** Called whenever the backend says the session is gone (expired, revoked). */
export function onUnauthorized(listener: () => void): void {
  unauthorizedListeners.add(listener);
}

/**
 * fetch() for the backend: sends the session cookie, and reports a 401 so the
 * app can return to the sign-in page instead of showing empty data.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${API_URL}${path}`, { credentials: "include", ...init });
  if (response.status === 401 && !path.startsWith("/api/auth/")) {
    for (const listener of unauthorizedListeners) listener();
  }
  return response;
}

/** JSON request that throws an Error carrying the backend's message. */
export async function apiJson<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const response = await apiFetch(path, json === undefined ? rest : {
    ...rest,
    headers: { "Content-Type": "application/json", ...rest.headers },
    body: JSON.stringify(json),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (HTTP ${response.status})`);
  return body as T;
}

/**
 * Runs `load` now and every `ms` while the tab is visible. A hidden tab makes
 * no requests; coming back refreshes at once instead of waiting a full period.
 */
export function poll(load: () => void, ms: number): () => void {
  load();
  const timer = setInterval(() => {
    if (!document.hidden) load();
  }, ms);
  const onVisible = () => {
    if (!document.hidden) load();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
