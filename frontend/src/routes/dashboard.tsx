import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  LogOut, Thermometer, Droplets, Server, BatteryCharging,
  Video, MapPin, Activity, Circle, Calendar as CalendarIcon, Clock, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { clearUser, getUser, type User } from "@/lib/auth";
import { generateRangeComparison, useLiveSensors, type Sensor,} from "@/lib/sensors";
import { BrandMark, APP_NAME } from "@/components/brand";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — LabEnvironment" },
      { name: "description", content: "Live temperature, humidity and camera monitoring for your laboratory room." },
      { property: "og:title", content: "Dashboard — LabEnvironment" },
      { property: "og:description", content: "Real-time data from six sensor points in one laboratory room." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

const SENSOR_COLORS = ["#4f46e5", "#0ea5e9", "#8b5cf6", "#f59e0b", "#10b981", "#ec4899"];
type Metric = "temperature" | "humidity";
type Preset = "today" | "yesterday" | "7d" | "30d" | "custom";
type Health = "normal" | "warning" | "offline";

function health(s: Sensor): Health {
  if (s.status === "Offline") return "offline";
  if (s.humidity > 60 || s.temperature > 35) return "warning";
  return "normal";
}

const HEALTH_DOT: Record<Health, string> = {
  normal: "text-emerald-500",
  warning: "text-amber-500",
  offline: "text-red-500",
};

function rangeFor(preset: Preset, custom: DateRange | undefined): { from: Date; to: Date } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = (offset: number) => new Date(today.getTime() + offset * 86400000);
  switch (preset) {
    case "today": return { from: today, to: today };
    case "yesterday": return { from: d(-1), to: d(-1) };
    case "7d": return { from: d(-6), to: today };
    case "30d": return { from: d(-29), to: today };
    case "custom": return { from: custom?.from ?? d(-6), to: custom?.to ?? custom?.from ?? today };
  }
}

function Dashboard() {
  const navigate = useNavigate();
  const sensors = useLiveSensors();
  const [user, setUserState] = useState<User | null>(null);
  const [activeId, setActiveId] = useState(1);
  const [metric, setMetric] = useState<Metric>("temperature");
  const [preset, setPreset] = useState<Preset>("7d");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const u = getUser();
    if (!u) {
      navigate({ to: "/signin" });
      return;
    }
    setUserState(u);
  }, [navigate]);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const active = useMemo(
  () => sensors.find((s) => s.id === activeId) ?? sensors[0], [sensors, activeId],);
  const { from, to } = useMemo(() => rangeFor(preset, customRange), [preset, customRange]);
  const history = useMemo(() => generateRangeComparison(sensors, from, to, metric), [sensors, from, to, metric]);
  const online = sensors.filter((s) => s.status === "Online");
  const warnings = sensors.filter((s) => health(s) === "warning").length;
  const avgTemp = online.reduce((a, s) => a + s.temperature, 0) / Math.max(1, online.length);
  const avgHum = online.reduce((a, s) => a + s.humidity, 0) / Math.max(1, online.length);
  const overall: Health = online.length < sensors.length ? "offline" : warnings > 0 ? "warning" : "normal";
  const clock = now ? now.toLocaleTimeString([], { hour12: false }) : "--:--:--";

  const logout = () => {
    clearUser();
    toast.success("Signed out");
    navigate({ to: "/signin" });
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 lg:h-screen lg:overflow-hidden flex flex-col">
      {/* Header */}
      <header className="shrink-0 bg-gradient-to-r from-[#0d1440] via-[#16205e] to-[#2b1258] text-white">
        <div className="px-3 sm:px-4 py-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <BrandMark className="w-8 h-8 shrink-0" iconClassName="w-4 h-4" />
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold tracking-tight">{APP_NAME}</h1>
              <p className="hidden sm:block text-[11px] text-blue-200/70 leading-tight truncate">
                Laboratory Temperature &amp; Humidity Monitoring
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill icon={<Server className="w-3 h-3" />} label="Host PC" tone="ok" />
            <StatusPill icon={<BatteryCharging className="w-3 h-3" />} label="UPS 92%" tone="ok" />
            <div className="hidden lg:flex items-center gap-1.5 text-[11px] font-mono text-blue-100/80 px-2 py-1 rounded-full bg-white/10">
              <Clock className="w-3 h-3" />
              {now ? format(now, "dd MMM yyyy") : "--"} · {clock}
            </div>
            <div className="hidden md:flex items-center gap-2 pl-2.5 ml-1 border-l border-white/15">
              <div className="w-7 h-7 rounded-full bg-white/15 grid place-items-center text-xs font-semibold">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div className="text-xs leading-tight">
                <div className="font-medium">{user.name}</div>
                <div className="text-[10px] text-blue-200/70">Operator</div>
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={logout} className="h-8 gap-1.5 text-white hover:bg-white/15 hover:text-white">
              <LogOut className="w-4 h-4" /> <span className="hidden sm:inline text-xs">Logout</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 min-h-0 p-2.5 sm:p-3 grid grid-cols-12 gap-2.5 sm:gap-3 lg:overflow-hidden">
        {/* LEFT: sensor list + floor plan */}
        <aside className="col-span-12 lg:col-span-3 xl:col-span-2 flex flex-col gap-2.5 sm:gap-3 min-h-0">
          <Card className="p-2 shrink-0">
            <div className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              sensors · 1 Room
            </div>
            <div className="flex lg:flex-col gap-1.5 overflow-x-auto lg:overflow-visible">
              {sensors.map((s) => {
                const on = s.id === activeId;
                const h = health(s);
                return (
                  <button
                    key={s.id}
                    onClick={() => setActiveId(s.id)}
                    className={cn(
                      "shrink-0 lg:w-full text-left px-2.5 py-2.5 rounded-lg flex items-center gap-2.5 transition-all border",
                      on
                        ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white border-transparent shadow-md shadow-indigo-600/20"
                        : "border-transparent hover:bg-slate-50 text-slate-700",
                    )}
                  >
                    <span className={cn(
                      "w-7 h-7 shrink-0 rounded-md grid place-items-center text-xs font-bold",
                      on ? "bg-white/20" : "bg-indigo-50 text-indigo-600",
                    )}>
                      {s.id}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium leading-tight">{s.name}</span>
                      <span className={cn("block text-[11px] leading-tight tabular-nums", on ? "text-indigo-100" : "text-muted-foreground")}>
                        {s.temperature.toFixed(1)}°C · {s.humidity}%
                      </span>
                    </span>
                    <Circle className={cn("w-2.5 h-2.5 shrink-0 fill-current", on ? "text-white" : HEALTH_DOT[h])} />
                  </button>
                );
              })}
            </div>
          </Card>

          <Card className="p-2 flex-1 min-h-0 flex flex-col">
            <div className="px-1 pb-1.5 flex items-center justify-between shrink-0">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <MapPin className="w-3 h-3 text-indigo-600" /> Floor Plan
              </span>
              <span className="text-[10px] text-muted-foreground">6 points</span>
            </div>
            <div className="relative flex-1 min-h-0 w-full rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
              <svg viewBox="0 0 800 450" className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
                <defs>
                  <pattern id="floor" width="20" height="20" patternUnits="userSpaceOnUse">
                    <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e2e8f0" strokeWidth="1" />
                  </pattern>
                </defs>
                <rect x="0" y="0" width="800" height="450" fill="url(#floor)" />
                <rect x="40" y="30" width="720" height="390" fill="#f8fafc" fillOpacity="0.7" />
                <rect x="40" y="30" width="720" height="390" fill="none" stroke="#1e293b" strokeWidth="4" />
                <line x1="380" y1="420" x2="440" y2="420" stroke="#f8fafc" strokeWidth="6" />
                <rect x="70" y="60" width="180" height="34" fill="none" stroke="#cbd5e1" strokeWidth="2" strokeDasharray="6 6" />
                <rect x="560" y="60" width="170" height="34" fill="none" stroke="#cbd5e1" strokeWidth="2" strokeDasharray="6 6" />
                <rect x="70" y="350" width="180" height="34" fill="none" stroke="#cbd5e1" strokeWidth="2" strokeDasharray="6 6" />
                <rect x="560" y="350" width="170" height="34" fill="none" stroke="#cbd5e1" strokeWidth="2" strokeDasharray="6 6" />
                <text x="400" y="235" textAnchor="middle" fill="#94a3b8" fontSize="20" fontWeight="700" letterSpacing="3">
                  LABORATORY ROOM
                </text>
              </svg>
              {sensors.map((s) => {
                const on = s.id === activeId;
                const h = health(s);
                return (
                  <button
                    key={s.id}
                    onClick={() => setActiveId(s.id)}
                    style={{ left: `${s.x}%`, top: `${s.y}%` }}
                    title={s.name}
                    className={cn(
                      "absolute -translate-x-1/2 -translate-y-1/2 transition-all",
                      on ? "z-20 scale-110" : "z-10 hover:scale-110",
                    )}
                  >
                    <span className={cn(
                      "block w-5 h-5 rounded-full grid place-items-center text-white text-[10px] font-bold shadow",
                      on
                        ? "bg-indigo-600 ring-4 ring-indigo-200"
                        : h === "normal" ? "bg-emerald-500" : h === "warning" ? "bg-amber-500" : "bg-red-500",
                    )}>
                      {s.id}
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>
        </aside>

        {/* CENTER: selected sensor + graph */}
        <main className="col-span-12 lg:col-span-6 xl:col-span-7 flex flex-col gap-2.5 sm:gap-3 min-h-0">
          <Card className="p-4 shrink-0">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-base font-semibold">{active.name}</h2>
                  <Badge className={cn(
                    "h-5 px-1.5 text-[10px] border-0",
                    health(active) === "normal" ? "bg-emerald-500 hover:bg-emerald-500"
                      : health(active) === "warning" ? "bg-amber-500 hover:bg-amber-500"
                      : "bg-red-500 hover:bg-red-500",
                  )}>
                    {active.status === "Offline" ? "Offline" : health(active) === "warning" ? "Warning" : "Online"}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground truncate">
                  {active.location} · Last updated {clock}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Reading icon={<Thermometer className="w-5 h-5" />} value={active.temperature.toFixed(1)} unit="°C" accent="from-orange-400 to-red-500" />
                <Reading icon={<Droplets className="w-5 h-5" />} value={active.humidity.toFixed(0)} unit="%RH" accent="from-sky-400 to-indigo-600" />
              </div>
            </div>
          </Card>

          <Card className="p-3 flex-1 min-h-0 flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-indigo-600" /> Sensor Comparison
                </h3>
                <p className="text-[11px] text-muted-foreground truncate">
                  {metric === "temperature" ? "Temperature (°C)" : "Humidity (%RH)"} · all 6 sensors ·{" "}
                  {format(from, "d MMM")} – {format(to, "d MMM yyyy")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Tabs value={metric} onValueChange={(v) => setMetric(v as Metric)}>
                  <TabsList className="h-8">
                    <TabsTrigger value="temperature" className="text-xs px-2.5">Temp</TabsTrigger>
                    <TabsTrigger value="humidity" className="text-xs px-2.5">Humidity</TabsTrigger>
                  </TabsList>
                </Tabs>
                <div className="flex items-center rounded-lg border border-slate-200 p-0.5">
                  {([["today", "Today"], ["yesterday", "Yesterday"], ["7d", "7D"], ["30d", "30D"]] as const).map(([k, label]) => (
                    <button
                      key={k}
                      onClick={() => setPreset(k)}
                      className={cn(
                        "px-2 py-1 text-[11px] rounded-md transition-colors",
                        preset === k ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        className={cn(
                          "px-2 py-1 text-[11px] rounded-md flex items-center gap-1 transition-colors",
                          preset === "custom" ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100",
                        )}
                      >
                        <CalendarIcon className="w-3 h-3" /> Custom
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end">
                      <Calendar
                        mode="range"
                        selected={customRange}
                        onSelect={(r) => { setCustomRange(r); setPreset("custom"); }}
                        numberOfMonths={2}
                        initialFocus
                        className="p-3 pointer-events-auto"
                      />
                      <div className="border-t px-3 py-2 text-[11px] text-muted-foreground">
                        Readings are shown hourly for a single day and daily averages for longer ranges.
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>
            <div className="flex-1 min-h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="time" stroke="#94a3b8" fontSize={11} tickMargin={4} minTickGap={16} />
                  <YAxis stroke="#94a3b8" fontSize={11} unit={metric === "temperature" ? "°" : "%"} width={46} />
                  <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
                  {sensors.map((s, idx) => (
                    <Line
                      key={s.id}
                      type="monotone"
                      dataKey={`s${s.id}`}
                      stroke={SENSOR_COLORS[idx % SENSOR_COLORS.length]}
                      strokeWidth={s.id === activeId ? 3 : 1.5}
                      strokeOpacity={s.id === activeId ? 1 : 0.6}
                      dot={false}
                      name={s.name}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </main>

        {/* RIGHT: cameras + environment summary */}
        <aside className="col-span-12 lg:col-span-3 flex flex-col gap-2.5 sm:gap-3 min-h-0">
          <Card className="p-2 shrink-0 flex flex-col">
            <div className="px-1 pb-1.5 flex items-center justify-between shrink-0">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <Video className="w-3 h-3 text-indigo-600" /> Live Cameras
              </span>
              <Badge className="h-4 px-1.5 bg-red-500 hover:bg-red-500 text-[9px] border-0">LIVE</Badge>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-1 gap-2">
              {[1, 2].map((n) => (
                <div key={n} className="relative h-20 rounded-lg bg-slate-900 overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-slate-800 via-slate-900 to-black" />
                  <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_50%_50%,white_1px,transparent_1px)] [background-size:8px_8px]" />
                  <div className="absolute inset-0 grid place-items-center text-slate-400">
                    <div className="text-center">
                      <Video className="w-5 h-5 mx-auto opacity-60" />
                      <div className="text-[10px] mt-1">Camera {n} · Lab Room</div>
                    </div>
                  </div>
                  <div className="absolute top-1.5 left-1.5 flex items-center gap-1 bg-black/60 backdrop-blur px-1.5 py-0.5 rounded text-white text-[9px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> CAM {n}
                  </div>
                  <div className="absolute bottom-1.5 right-1.5 text-[9px] text-white/70 font-mono">{clock}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-3 flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between mb-2 shrink-0">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-indigo-600" /> Environment Summary
              </span>
              <Badge className={cn(
                "h-5 px-1.5 text-[10px] border-0 capitalize",
                overall === "normal" ? "bg-emerald-500 hover:bg-emerald-500"
                  : overall === "warning" ? "bg-amber-500 hover:bg-amber-500"
                  : "bg-red-500 hover:bg-red-500",
              )}>
                {overall === "offline" ? "Critical" : overall}
              </Badge>
            </div>
            <div className="grid grid-cols-3 gap-2 flex-1">
              <Stat label="Online" value={`${online.length}/${sensors.length}`} tone={online.length === sensors.length ? "text-emerald-600" : "text-red-600"} />
              <Stat label="Avg Temp" value={`${avgTemp.toFixed(1)}°C`} tone="text-indigo-600" />
              <Stat label="Avg Hum" value={`${avgHum.toFixed(0)}%`} tone="text-sky-600" />
            </div>
            <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground shrink-0">
              <span>{warnings} warning{warnings === 1 ? "" : "s"}</span>
              <span className="font-mono">Last updated {clock}</span>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function StatusPill({ icon, label, tone }: { icon: React.ReactNode; label: string; tone: "ok" | "warn" | "bad" }) {
  return (
    <div className={cn(
      "hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium bg-white/10",
      tone === "ok" ? "text-emerald-300" : tone === "warn" ? "text-amber-300" : "text-red-300",
    )}>
      {icon}
      <span>{label}</span>
      <span className={cn("w-1.5 h-1.5 rounded-full animate-pulse", tone === "ok" ? "bg-emerald-400" : tone === "warn" ? "bg-amber-400" : "bg-red-400")} />
    </div>
  );
}

function Reading({ icon, value, unit, accent }: { icon: React.ReactNode; value: string; unit: string; accent: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 px-3.5 py-2.5">
      <div className={cn("w-10 h-10 rounded-lg bg-gradient-to-br text-white grid place-items-center shadow", accent)}>
        {icon}
      </div>
      <div className="leading-none">
        <span className="text-3xl font-bold tracking-tight tabular-nums">{value}</span>
        <span className="ml-1 text-sm text-muted-foreground font-medium">{unit}</span>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="text-center py-2 rounded-lg bg-slate-50 flex-1 flex flex-col justify-center">
      <div className={cn("text-base font-bold tabular-nums", tone)}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
