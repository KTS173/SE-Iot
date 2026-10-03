import { useSyncExternalStore } from "react";
import { redirect } from "@tanstack/react-router";
import { apiFetch, apiJson, onUnauthorized } from "@/lib/api";

export type UserRole = "admin" | "member";
export type UserStatus = "pending" | "active" | "disabled";

export interface User {
  id: number;
  name: string;
  username: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
  approved_at: string | null;
}

// The signed-in user lives on the server (an HttpOnly cookie the page cannot
// read); this is only the copy last returned by /api/auth/me.
let current: User | null = null;
let loading: Promise<User | null> | null = null;
const listeners = new Set<() => void>();

function setCurrent(user: User | null): void {
  current = user;
  loading = Promise.resolve(user);
  for (const listener of listeners) listener();
}

/** The signed-in user, asking the backend once per page load. */
export function loadUser(): Promise<User | null> {
  loading ??= apiFetch("/api/auth/me")
    .then(async (response) => (response.ok ? ((await response.json()) as { data: User }).data : null))
    .catch(() => null)
    .then((user) => {
      current = user;
      return user;
    });
  return loading;
}

/** Ask the backend again, e.g. to see whether an admin has approved us yet. */
export async function refreshUser(): Promise<User | null> {
  loading = null;
  const user = await loadUser();
  setCurrent(user);
  return user;
}

export function useCurrentUser(): User | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

export async function signIn(identifier: string, password: string, remember: boolean): Promise<User> {
  const { data } = await apiJson<{ data: User }>("/api/auth/login", {
    method: "POST",
    json: { identifier, password, remember },
  });
  setCurrent(data);
  return data;
}

export async function signUp(form: { name: string; username: string; email: string; password: string }): Promise<User> {
  const { data } = await apiJson<{ data: User }>("/api/auth/signup", { method: "POST", json: form });
  setCurrent(data);
  return data;
}

export async function signOut(): Promise<void> {
  await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  setCurrent(null);
}

export async function updateProfile(profile: { name: string; username: string; email: string }): Promise<User> {
  const { data } = await apiJson<{ data: User }>("/api/auth/me", { method: "PUT", json: profile });
  setCurrent(data);
  return data;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiJson("/api/auth/password", {
    method: "POST",
    json: { current_password: currentPassword, new_password: newPassword },
  });
}

/** Where a user should land: sign-in, the approval wait screen, or the dashboard. */
export function homeFor(user: User | null): "/signin" | "/pending" | "/dashboard" {
  if (!user) return "/signin";
  return user.status === "active" ? "/dashboard" : "/pending";
}

// --- route guards (use in a route's beforeLoad) ---------------------------------

export async function requireApproved(): Promise<User> {
  const user = await loadUser();
  if (!user || user.status !== "active") throw redirect({ to: homeFor(user) });
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireApproved();
  if (user.role !== "admin") throw redirect({ to: "/dashboard" });
  return user;
}

/** For /pending: only signed-in accounts that are not approved yet. */
export async function requirePending(): Promise<User> {
  const user = await loadUser();
  if (!user || user.status === "active") throw redirect({ to: homeFor(user) });
  return user;
}

/** For /signin and /signup: someone already signed in goes straight on. */
export async function redirectIfSignedIn(): Promise<void> {
  const user = await loadUser();
  if (user) throw redirect({ to: homeFor(user) });
}

onUnauthorized(() => {
  if (current === null) return;
  setCurrent(null);
  window.location.assign("/signin");
});
