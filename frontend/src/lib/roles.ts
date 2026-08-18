export type UserRole = "admin" | "member" | "viewer";

const configuredRole = import.meta.env.VITE_MOCK_ROLE;

// TODO: Replace mockRole with the authenticated user's role from the backend.
// For local testing, run with VITE_MOCK_ROLE=admin, member, or viewer.
export const mockRole: UserRole =
  configuredRole === "member" || configuredRole === "viewer" || configuredRole === "admin"
    ? configuredRole
    : "admin";

export const permissions = {
  canManageSensors: mockRole === "admin",
  canViewMembers: mockRole === "admin" || mockRole === "member",
  canInviteUsers: mockRole === "admin" || mockRole === "member",
  canRemoveMembers: mockRole === "admin",
  canAccessSettings: true,
} as const;

export type ProtectedPath = "/dashboard" | "/sensors" | "/members" | "/settings";
export function canAccessRoute(path: ProtectedPath): boolean {
  if (path === "/sensors") return permissions.canManageSensors;
  if (path === "/members") return permissions.canViewMembers;
  return true;
}
