import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock, MessageSquareText, RefreshCw, Send, Users, XCircle } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";
import { requireApproved, useCurrentUser } from "@/lib/auth";
import { permissionsFor } from "@/lib/roles";

export const Route = createFileRoute("/line-log")({
  beforeLoad: requireApproved,
  component: LineLogPage,
});


type DeliveryStatus = "pending" | "sent" | "failed" | "skipped";

interface Delivery {
  id: number;
  alert_id: number;
  event_state: "opened" | "closed";
  message: string;
  status: DeliveryStatus;
  attempts: number;
  recipient_count: number | null;
  last_error: string | null;
  created_at: string;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  delivered_at: string | null;
}

interface LineStatus {
  configured: boolean;
  recipients: { line_user_id: string; display_name: string | null; added_at: string; active: boolean }[];
  active_alerts: number;
  deliveries: Partial<Record<DeliveryStatus, number>>;
}

const statusStyle: Record<DeliveryStatus, string> = {
  sent: "bg-emerald-50 text-emerald-700",
  pending: "bg-amber-50 text-amber-700",
  failed: "bg-red-50 text-red-700",
  skipped: "bg-slate-100 text-slate-600",
};

const filters: ("all" | DeliveryStatus)[] = ["all", "sent", "pending", "failed", "skipped"];

function formatTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function LineLogPage() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [status, setStatus] = useState<LineStatus | null>(null);
  const [filter, setFilter] = useState<"all" | DeliveryStatus>("all");
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const { canSendLineTest } = permissionsFor(useCurrentUser());

  const load = useCallback(async () => {
    try {
      const [logResponse, statusResponse] = await Promise.all([
        apiFetch(`/api/notifications?limit=200`),
        apiFetch(`/api/line/status`),
      ]);
      if (logResponse.ok) setDeliveries(((await logResponse.json()) as { data: Delivery[] }).data);
      if (statusResponse.ok) setStatus(((await statusResponse.json()) as { data: LineStatus }).data);
    } catch {
      // Keep the last loaded log during a temporary network failure.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const sendTest = async () => {
    setTesting(true);
    try {
      const response = await apiFetch(`/api/line/test`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Test message failed");
      toast.success(`Test message sent to ${body.data.sent} recipient(s)`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Test message failed");
    } finally {
      setTesting(false);
    }
  };

  const visible = filter === "all" ? deliveries : deliveries.filter(item => item.status === filter);
  const counts = status?.deliveries ?? {};
  const activeRecipients = status?.recipients.filter(item => item.active) ?? [];

  return (
    <AppShell title="LINE Log" subtitle="Alert messages sent to the LINE application">
      <div className="mx-auto max-w-[1200px] space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            icon={MessageSquareText}
            label="LINE channel"
            value={status ? (status.configured ? "Connected" : "Not configured") : "—"}
            tone={status?.configured ? "text-emerald-700" : "text-red-700"}
          />
          <SummaryCard
            icon={Users}
            label="Recipients"
            value={String(activeRecipients.length)}
            hint={activeRecipients.map(item => item.display_name ?? item.line_user_id).join(", ") || "Nobody has added the bot yet"}
          />
          <SummaryCard icon={CheckCircle2} label="Delivered" value={String(counts.sent ?? 0)} tone="text-emerald-700" />
          <SummaryCard
            icon={XCircle}
            label="Failed / pending"
            value={`${counts.failed ?? 0} / ${counts.pending ?? 0}`}
            tone={(counts.failed ?? 0) > 0 ? "text-red-700" : undefined}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {filters.map(item => (
              <button
                key={item}
                type="button"
                onClick={() => setFilter(item)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition-colors",
                  filter === item ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-200",
                )}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
            {canSendLineTest && (
              <Button size="sm" onClick={sendTest} disabled={testing} className="gap-1.5 bg-blue-600 hover:bg-blue-700">
                <Send className="h-3.5 w-3.5" />
                {testing ? "Sending..." : "Send test"}
              </Button>
            )}
          </div>
        </div>

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Created</th>
                  <th className="px-5 py-3">Message</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Attempts</th>
                  <th className="px-5 py-3">Recipients</th>
                  <th className="px-5 py-3">Delivered</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map(item => (
                  <tr key={item.id} className="align-top hover:bg-slate-50/70">
                    <td className="whitespace-nowrap px-5 py-4 text-slate-600">{formatTime(item.created_at)}</td>
                    <td className="px-5 py-4">
                      <p className="whitespace-pre-line text-slate-800">{item.message}</p>
                      {item.last_error && <p className="mt-1.5 text-xs text-red-600">{item.last_error}</p>}
                      {item.status === "pending" && item.next_attempt_at && (
                        <p className="mt-1.5 flex items-center gap-1 text-xs text-amber-700">
                          <Clock className="h-3 w-3" />
                          Next attempt {formatTime(item.next_attempt_at)}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold capitalize", statusStyle[item.status])}>
                        {item.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-slate-600">{item.attempts}</td>
                    <td className="px-5 py-4 text-slate-600">{item.recipient_count ?? "—"}</td>
                    <td className="whitespace-nowrap px-5 py-4 text-slate-600">{formatTime(item.delivered_at)}</td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-slate-500">
                      {loading ? "Loading..." : "No LINE messages recorded yet"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <p className={cn("mt-2 text-2xl font-bold", tone)}>{value}</p>
      {hint && <p className="mt-1 truncate text-xs text-slate-500" title={hint}>{hint}</p>}
    </Card>
  );
}
