import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { endOfDay, format, startOfDay, subDays } from "date-fns";
import type { DateRange } from "react-day-picker";
import { Calendar as CalendarIcon, CheckCircle2, Clock, ExternalLink, MessageSquareText, RefreshCw, Send, Users, X, XCircle } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { apiFetch, poll } from "@/lib/api";
import { toast } from "sonner";
import { requireApproved, useCurrentUser } from "@/lib/auth";
import { permissionsFor } from "@/lib/roles";
import lineQrImage from "@/assets/line-qr.png";

const LINE_ADD_FRIEND_URL = "https://line.me/R/ti/p/%40886efqgu";

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

interface LogDay {
  day: string;
  total: number;
  failed: number;
}

type DatePreset = "all" | "today" | "7d" | "30d" | "custom";

const datePresets: [Exclude<DatePreset, "custom">, string][] = [
  ["all", "All dates"],
  ["today", "Today"],
  ["7d", "7D"],
  ["30d", "30D"],
];

function presetRange(preset: DatePreset): DateRange | undefined {
  const today = new Date();
  if (preset === "today") return { from: today, to: today };
  if (preset === "7d") return { from: subDays(today, 6), to: today };
  if (preset === "30d") return { from: subDays(today, 29), to: today };
  return undefined;
}

function rangeLabel(range: DateRange | undefined): string {
  if (!range?.from) return "All dates";
  const from = format(range.from, "d MMM yyyy");
  if (!range.to || format(range.to, "yyyy-MM-dd") === format(range.from, "yyyy-MM-dd")) return from;
  return `${format(range.from, "d MMM")} – ${format(range.to, "d MMM yyyy")}`;
}

function formatTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function LineLogPage() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [status, setStatus] = useState<LineStatus | null>(null);
  const [filter, setFilter] = useState<"all" | DeliveryStatus>("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [range, setRange] = useState<DateRange | undefined>();
  const [days, setDays] = useState<LogDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const { canSendLineTest } = permissionsFor(useCurrentUser());

  // Local midnight to end of day, so a picked date means that whole day here.
  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: "500" });
    if (range?.from) {
      params.set("from", startOfDay(range.from).toISOString());
      params.set("to", endOfDay(range.to ?? range.from).toISOString());
    }
    return params.toString();
  }, [range]);

  const load = useCallback(async () => {
    try {
      const offset = -new Date().getTimezoneOffset() * 60;
      const [logResponse, statusResponse, daysResponse] = await Promise.all([
        apiFetch(`/api/notifications?${query}`),
        apiFetch(`/api/line/status`),
        apiFetch(`/api/notifications/days?offset=${offset}`),
      ]);
      if (logResponse.ok) setDeliveries(((await logResponse.json()) as { data: Delivery[] }).data);
      if (statusResponse.ok) setStatus(((await statusResponse.json()) as { data: LineStatus }).data);
      if (daysResponse.ok) setDays(((await daysResponse.json()) as { data: LogDay[] }).data);
    } catch {
      // Keep the last loaded log during a temporary network failure.
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => poll(load, 15_000), [load]);

  const choosePreset = (preset: DatePreset) => {
    setDatePreset(preset);
    setRange(presetRange(preset));
  };

  const dayInfo = useMemo(() => new Map(days.map(item => [item.day, item])), [days]);
  const dayKey = (date: Date) => format(date, "yyyy-MM-dd");

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

        <Card className="flex flex-col items-center gap-4 p-4 sm:flex-row">
          <img src={lineQrImage} alt="QR code to add the alert bot on LINE" className="h-32 w-32 shrink-0 rounded-md border" />
          <div className="space-y-2 text-center sm:text-left">
            <p className="font-semibold text-slate-800">Get these alerts in LINE</p>
            <p className="text-sm text-slate-500">
              Scan this QR code with the LINE app and add the bot as a friend. You will receive every alert listed below on
              your phone.
            </p>
            <a
              href={LINE_ADD_FRIEND_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-[#06C755] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#05b34c]"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Add friend on LINE
            </a>
          </div>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
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
            <span className="mx-1 hidden h-5 w-px bg-slate-300 sm:block" />
            {datePresets.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => choosePreset(key)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                  datePreset === key ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-200",
                )}
              >
                {label}
              </button>
            ))}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                    datePreset === "custom" ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-200",
                  )}
                >
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {datePreset === "custom" ? rangeLabel(range) : "Pick dates"}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="range"
                  selected={range}
                  onSelect={next => {
                    setRange(next);
                    setDatePreset(next?.from ? "custom" : "all");
                  }}
                  numberOfMonths={2}
                  defaultMonth={range?.from ?? subDays(new Date(), 30)}
                  disabled={{ after: new Date() }}
                  modifiers={{
                    logged: date => {
                      const info = dayInfo.get(dayKey(date));
                      return !!info && info.failed === 0;
                    },
                    loggedFailed: date => (dayInfo.get(dayKey(date))?.failed ?? 0) > 0,
                    empty: date => !dayInfo.has(dayKey(date)),
                  }}
                  modifiersClassNames={{
                    logged: "relative font-semibold after:absolute after:bottom-1 after:left-1/2 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-emerald-500",
                    loggedFailed: "relative font-semibold after:absolute after:bottom-1 after:left-1/2 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-red-500",
                    empty: "text-slate-400",
                  }}
                  initialFocus
                  className="pointer-events-auto p-3"
                />
                <div className="flex items-center gap-4 border-t px-4 py-2 text-xs text-slate-500">
                  <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Has messages</span>
                  <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-red-500" />Has failed messages</span>
                </div>
              </PopoverContent>
            </Popover>
            {datePreset !== "all" && (
              <button
                type="button"
                onClick={() => choosePreset("all")}
                className="rounded-full p-1.5 text-slate-500 hover:bg-slate-200"
                aria-label="Clear date filter"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
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

        <p className="text-xs text-slate-500">
          {visible.length} message{visible.length === 1 ? "" : "s"} · {rangeLabel(range)}
        </p>

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
                      {loading ? "Loading..." : range?.from ? "No LINE messages on these dates" : "No LINE messages recorded yet"}
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
