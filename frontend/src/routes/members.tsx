import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Ban, Check, RotateCcw, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/modal";
import { apiJson } from "@/lib/api";
import { requireAdmin, useCurrentUser, type User, type UserRole, type UserStatus } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/members")({ beforeLoad: requireAdmin, component: MembersPage });

const STATUS_STYLE: Record<UserStatus, { label: string; text: string; dot: string }> = {
  pending: { label: "Waiting for approval", text: "text-amber-700", dot: "bg-amber-500" },
  active: { label: "Active", text: "text-emerald-700", dot: "bg-emerald-500" },
  disabled: { label: "Disabled", text: "text-slate-500", dot: "bg-slate-400" },
};

function MembersPage() {
  const me = useCurrentUser();
  const [users, setUsers] = useState<User[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [removing, setRemoving] = useState<User | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers((await apiJson<{ data: User[] }>("/api/users")).data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load members");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const update = async (user: User, change: { role?: UserRole; status?: "active" | "disabled" }, message: string) => {
    setBusyId(user.id);
    try {
      const { data } = await apiJson<{ data: User }>(`/api/users/${user.id}`, { method: "PUT", json: change });
      setUsers((items) => items.map((item) => (item.id === data.id ? data : item)));
      toast.success(message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update member");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusyId(removing.id);
    try {
      await apiJson(`/api/users/${removing.id}`, { method: "DELETE" });
      setUsers((items) => items.filter((item) => item.id !== removing.id));
      toast.success("Member removed");
      setRemoving(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove member");
    } finally {
      setBusyId(null);
    }
  };

  const pending = users.filter((user) => user.status === "pending").length;

  return (
    <AppShell title="Members" subtitle="Approve sign-ups and manage who can access the monitor">
      <div className="mx-auto max-w-[1200px]">
        <div className="mb-4">
          <h2 className="font-semibold">Team Members</h2>
          <p className="text-sm text-slate-500">
            {users.length} account(s){pending > 0 && <span className="font-semibold text-amber-700"> · {pending} waiting for approval</span>}
          </p>
        </div>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Member</th>
                  <th className="px-5 py-3">Email</th>
                  <th className="px-5 py-3">Role</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {users.map((user) => {
                  const self = user.id === me?.id;
                  const busy = busyId === user.id;
                  const style = STATUS_STYLE[user.status];
                  return (
                    <tr key={user.id} className={cn("hover:bg-slate-50/70", user.status === "pending" && "bg-amber-50/40")}>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="grid h-9 w-9 place-items-center rounded-full bg-blue-100 font-bold text-blue-700">{user.name.charAt(0).toUpperCase()}</div>
                          <div>
                            <p className="font-semibold">{user.name}{self && <span className="ml-1.5 text-xs font-normal text-slate-500">(you)</span>}</p>
                            <p className="text-xs text-slate-500">@{user.username}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-slate-600">{user.email}</td>
                      <td className="px-5 py-4">
                        <select
                          aria-label={`Role for ${user.name}`}
                          value={user.role}
                          disabled={self || busy}
                          onChange={(event) => update(user, { role: event.target.value as UserRole }, "Role updated")}
                          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold capitalize disabled:opacity-60"
                        >
                          <option value="member">member</option>
                          <option value="admin">admin</option>
                        </select>
                      </td>
                      <td className="px-5 py-4">
                        <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", style.text)}>
                          <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
                          {style.label}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        {!self && (
                          <div className="flex justify-end gap-1">
                            {user.status === "pending" && (
                              <Button size="sm" disabled={busy} onClick={() => update(user, { status: "active" }, `${user.name} approved`)} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                                <Check className="h-3.5 w-3.5" />Approve
                              </Button>
                            )}
                            {user.status === "active" && (
                              <Button variant="ghost" size="sm" disabled={busy} onClick={() => update(user, { status: "disabled" }, `${user.name} disabled`)} className="gap-1.5">
                                <Ban className="h-3.5 w-3.5" />Disable
                              </Button>
                            )}
                            {user.status === "disabled" && (
                              <Button variant="ghost" size="sm" disabled={busy} onClick={() => update(user, { status: "active" }, `${user.name} re-enabled`)} className="gap-1.5">
                                <RotateCcw className="h-3.5 w-3.5" />Enable
                              </Button>
                            )}
                            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRemoving(user)} className="gap-1.5 text-red-600 hover:bg-red-50 hover:text-red-700">
                              <Trash2 className="h-3.5 w-3.5" />{user.status === "pending" ? "Reject" : "Remove"}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
          <Users className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Anyone can sign up. New accounts see nothing until approved here. Admins manage sensors and members; members see the dashboard and the LINE log.</p>
        </div>
      </div>
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        title={removing?.status === "pending" ? "Reject Sign-up" : "Remove Member"}
        description={`Delete the account of ${removing?.name ?? "this user"}? They will be signed out and can sign up again later.`}
        confirmLabel={removing?.status === "pending" ? "Reject" : "Remove"}
        loading={busyId === removing?.id}
      />
    </AppShell>
  );
}
