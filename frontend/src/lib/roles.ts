import type { User } from "@/lib/auth";

// Mirrors the backend: admins manage sensors and people; everyone approved can
// see the dashboard and the LINE log. The backend enforces this either way.
export function permissionsFor(user: User | null) {
  const admin = user?.role === "admin" && user.status === "active";
  return {
    canManageSensors: admin,
    canManageMembers: admin,
    canSendLineTest: admin,
  };
}
