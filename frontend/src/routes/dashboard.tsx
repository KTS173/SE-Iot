import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  LogOut, Thermometer, Droplets, Server, BatteryCharging, MessageSquareText,
  MapPin, Activity, Calendar as CalendarIcon, LayoutDashboard, Radio, Users, Settings, Wifi,
  Eye, EyeOff, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";
import { useMediaQuery } from "@/lib/use-media-query";
import type { AxisDomain } from "recharts/types/util/types";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import { requireApproved, useCurrentUser } from "@/lib/auth";
import { useLiveSensors, useRangeHistory, type Sensor } from "@/lib/sensors";
import { BrandMark, APP_NAME } from "@/components/brand";
import { MobileNavigation, useLogout } from "@/components/app-shell";
import { toast } from "sonner";
import { permissionsFor } from "@/lib/roles";

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
  beforeLoad: requireApproved,
  component: Dashboard,
});

const SENSOR_COLORS = ["#2563eb", "#16a34a", "#9333ea", "#f97316", "#ef4444", "#0d9488"];
type Preset = "1h" | "6h" | "today" | "7d" | "30d" | "custom";
type Health = "normal" | "warning" | "offline";
/** Chart zoom: a per-browser view setting, not an alert threshold. */
type ChartScale = { axisMin: string; axisMax: string };
type Metric = "temperature" | "humidity";
/** The alert range to draw, or "mixed" when the shown sensors differ. */
type AlertRange = { min: number; max: number } | "mixed" | null;

const EMPTY_SCALE: ChartScale = { axisMin: "", axisMax: "" };
const ALERT_LINES_KEY = "dashboard-show-alert-lines";

function alertRangeOf(sensors: Sensor[], metric: Metric): AlertRange {
  if (sensors.length === 0) return null;
  const ranges = sensors.map((s) => metric === "temperature" ? [s.minTemp, s.maxTemp] : [s.minHumidity, s.maxHumidity]);
  const [min, max] = ranges[0];
  return ranges.every(([low, high]) => low === min && high === max) ? { min, max } : "mixed";
}



function health(s: Sensor): Health {
  if (s.status === "Offline") return "offline";
  if (s.temperature != null && (s.temperature < s.minTemp || s.temperature > s.maxTemp)) return "warning";
  if (s.humidity != null && (s.humidity < s.minHumidity || s.humidity > s.maxHumidity)) return "warning";
  return "normal";
}

const HEALTH_DOT: Record<Health, string> = {
  normal: "text-emerald-500",
  warning: "text-amber-500",
  offline: "text-red-500",
};

const HOUR = 3_600_000;

/** Short text inside a floor-plan marker: the device ID, trimmed to fit. */
function markerLabel(deviceId: string): string {
  return deviceId.length > 4 ? `${deviceId.slice(0, 3)}…` : deviceId;
}

/**
 * `to` is the current instant, not midnight: ending a preset at the start of
 * today excluded every reading taken today, which left the 1D chart empty.
 */
function rangeFor(preset: Preset, custom: DateRange | undefined): { from: Date; to: Date } {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const d = (offset: number) => new Date(today.getTime() + offset * 86400000);
  const endOfDay = (date: Date) => {
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    return end;
  };
  switch (preset) {
    case "1h": return { from: new Date(now.getTime() - HOUR), to: now };
    case "6h": return { from: new Date(now.getTime() - 6 * HOUR), to: now };
    case "today": return { from: today, to: now };
    case "7d": return { from: d(-6), to: now };
    case "30d": return { from: d(-29), to: now };
    case "custom": return {
      from: custom?.from ?? d(-6),
      to: endOfDay(custom?.to ?? custom?.from ?? now),
    };
  }
}

/** A pair of number fields: both empty (unset) or both numbers with low < high. */
function pairError(low: string, high: string): string | null {
  if (low.trim() === "" && high.trim() === "") return null;
  const [a, b] = [Number(low), Number(high)];
  if (low.trim() === "" || high.trim() === "" || !Number.isFinite(a) || !Number.isFinite(b)) return "Fill in both values";
  return a < b ? null : "Min must be lower than max";
}

function scaleIsValid(scale: ChartScale): boolean {
  return scale.axisMin.trim() !== "" && pairError(scale.axisMin, scale.axisMax) === null;
}

/**
 * Manual zoom wins. Otherwise fit the data but always include the alert range,
 * so the dashed limit lines stay on the chart even when readings sit far inside.
 */
function yDomain(scale: ChartScale | null, alert: AlertRange): AxisDomain {
  if (scale) return [Number(scale.axisMin), Number(scale.axisMax)];
  if (!alert || alert === "mixed") return ["auto", "auto"];
  const { min, max } = alert;
  const pad = Math.max(1, (max - min) * 0.1);
  return ([dataMin, dataMax]: [number, number]) => [
    Math.floor(Math.min(Number.isFinite(dataMin) ? dataMin : min, min) - pad),
    Math.ceil(Math.max(Number.isFinite(dataMax) ? dataMax : max, max) + pad),
  ];
}

function chartTicks(scale: ChartScale | null): number[] | undefined {
  if (!scale) return undefined;
  const max = Number(scale.axisMax);
  const midpoint = (Number(scale.axisMin) + max) / 2;
  return [...new Set([midpoint, max])].sort((a, b) => a - b);
}

function ChartYAxisTick({
  x = 0,
  y = 0,
  payload,
  unit,
}: {
  x?: number;
  y?: number;
  payload?: { value: number | string };
  unit: string;
}) {
  return <text x={x} y={y} dy={4} textAnchor="end" fill="#64748b" fontSize={10}>{`${payload?.value ?? ""}${unit}`}</text>;
}

function Dashboard() {
  const sensors = useLiveSensors();
  const user = useCurrentUser();
  const permissions = permissionsFor(user);
  const logout = useLogout();
  // null = all sensors; otherwise the charts and details focus on one sensor.
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showAlertLines, setShowAlertLines] = useState(true);
  const [temperatureScale, setTemperatureScale] = useState<ChartScale | null>(null);
  const [humidityScale, setHumidityScale] = useState<ChartScale | null>(null);
  const [temperatureDraft, setTemperatureDraft] = useState<ChartScale>(EMPTY_SCALE);
  const [humidityDraft, setHumidityDraft] = useState<ChartScale>(EMPTY_SCALE);
  const [editingScale, setEditingScale] = useState<Metric | null>(null);
  const [preset, setPreset] = useState<Preset>("7d");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const wide = useMediaQuery("(min-width: 640px)");
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    for (const metric of ["temperature", "humidity"] as const) {
      try {
        const saved = localStorage.getItem(`dashboard-chart-range-${metric}`);
        if (!saved) continue;
        const { axisMin, axisMax } = JSON.parse(saved) as ChartScale;
        const parsed = { axisMin: String(axisMin), axisMax: String(axisMax) };
        if (!scaleIsValid(parsed)) continue;
        if (metric === "temperature") setTemperatureScale(parsed);
        else setHumidityScale(parsed);
      } catch {
        // Ignore invalid or unavailable local settings.
      }
    }
    try {
      setShowAlertLines(localStorage.getItem(ALERT_LINES_KEY) !== "off");
    } catch {
      // Default: shown.
    }
  }, []);

  const toggleAlertLines = () => {
    const next = !showAlertLines;
    setShowAlertLines(next);
    try {
      localStorage.setItem(ALERT_LINES_KEY, next ? "on" : "off");
    } catch {
      // Applies until reload.
    }
  };
  const toggleSensor = (id: number) => setSelectedId((current) => (current === id ? null : id));

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const [rangeTick, setRangeTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setRangeTick((v) => v + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const { from, to } = useMemo(
    () => rangeFor(preset, customRange),
    [preset, customRange, rangeTick],
  );
  const sameDay = from.toDateString() === to.toDateString();
  const rangeLabel = sameDay
    ? `${format(from, "d MMM")} · ${format(from, "HH:mm")} – ${format(to, "HH:mm")}`
    : `${format(from, "d MMM")} – ${format(to, "d MMM yyyy")}`;
  const { temperature: temperatureHistory, humidity: humidityHistory } = useRangeHistory(sensors, from, to);
  const selected = sensors.find((sensor) => sensor.id === selectedId) ?? null;
  const shownSensors = selected ? [selected] : sensors;
  const temperatureAlert = showAlertLines ? alertRangeOf(shownSensors, "temperature") : null;
  const humidityAlert = showAlertLines ? alertRangeOf(shownSensors, "humidity") : null;
  const saveChartScale = (metric: Metric) => {
    const draft = metric === "temperature" ? temperatureDraft : humidityDraft;
    if (pairError(draft.axisMin, draft.axisMax)) return;
    // Chart zoom: this browser only. Both empty = automatic.
    const scale = draft.axisMin.trim() === "" ? null : { axisMin: draft.axisMin, axisMax: draft.axisMax };
    try {
      if (scale) localStorage.setItem(`dashboard-chart-range-${metric}`, JSON.stringify(scale));
      else localStorage.removeItem(`dashboard-chart-range-${metric}`);
    } catch {
      // Zoom still applies until reload.
    }
    if (metric === "temperature") setTemperatureScale(scale);
    else setHumidityScale(scale);
    setEditingScale(null);
    toast.success(`${metric === "temperature" ? "Temperature" : "Humidity"} chart scale saved`);
  };
  const online = sensors.filter((sensor) => sensor.status === "Online");
  const withTemp = online.filter((sensor) => sensor.temperature != null);
  const withHum = online.filter((sensor) => sensor.humidity != null);
  const avgTemp = withTemp.reduce((sum, sensor) => sum + sensor.temperature!, 0) / Math.max(1, withTemp.length);
  const avgHum = withHum.reduce((sum, sensor) => sum + sensor.humidity!, 0) / Math.max(1, withHum.length);

  if (!user) return null;
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 xl:h-screen xl:overflow-hidden">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-[#0b1739] text-white xl:flex">
        <div className="flex h-20 items-center gap-3 border-b border-white/10 px-5"><BrandMark className="h-10 w-10 rounded-lg shadow-none" iconClassName="h-5 w-5" /><div><p className="text-sm font-bold">Lab Environment</p><p className="text-xs text-blue-200/70">Monitor</p></div></div>
        <nav className="flex-1 space-y-1.5 px-3 py-6" aria-label="Main navigation"><Link to="/dashboard" className="flex items-center gap-3 rounded-lg bg-blue-600 px-3 py-2.5 text-sm font-medium text-white"><LayoutDashboard className="h-[18px] w-[18px]"/>Dashboard</Link>{permissions.canManageSensors && <Link to="/sensors" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white"><Radio className="h-[18px] w-[18px]"/>Sensors</Link>}{permissions.canManageMembers && <Link to="/members" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white"><Users className="h-[18px] w-[18px]"/>Members</Link>}<Link to="/line-log" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white"><MessageSquareText className="h-[18px] w-[18px]"/>LINE Log</Link></nav>
        <div className="border-t border-white/10 px-3 py-4"><Link to="/settings" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white"><Settings className="h-[18px] w-[18px]"/>Settings</Link></div>
      </aside>
      <div className="flex min-h-screen min-w-0 flex-col xl:ml-60 xl:h-screen">
        <header className="flex h-16 shrink-0 items-center justify-between border-b bg-white px-4 sm:px-6"><div><h1 className="text-xl font-bold">Dashboard</h1><p className="hidden text-xs text-slate-500 sm:block">Real-time laboratory environment overview</p></div><div className="flex items-center gap-3"><div className="hidden text-right sm:block"><p className="text-sm font-semibold">{user.name}</p><p className="text-[11px] capitalize text-slate-500">{user.role}</p></div><div className="grid h-9 w-9 place-items-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">{user.name.charAt(0).toUpperCase()}</div><Button variant="ghost" size="sm" onClick={logout} aria-label="Log out" title="Log out"><LogOut className="h-4 w-4" /></Button></div></header>
        <main className="min-h-0 flex-1 overflow-y-auto p-3 pb-20 sm:p-4 sm:pb-20 xl:p-5 xl:pb-5"><div className="mx-auto grid max-w-[1600px] gap-4 xl:h-full xl:grid-cols-[280px_minmax(0,1fr)] xl:grid-rows-[minmax(340px,1.35fr)_minmax(240px,1fr)]">
          <Card className="flex min-h-[430px] flex-col overflow-hidden xl:row-span-2 xl:min-h-0"><div className="flex items-center justify-between border-b px-4 py-4"><div><h2 className="font-semibold">Sensors</h2><p className="text-xs text-slate-500">{sensors.length} devices connected</p></div></div><div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 dashboard-scrollbar">{sensors.map((sensor,index)=>{const isOffline=sensor.status==="Offline";const outOfRange=health(sensor)==="warning";return <button key={sensor.id} onClick={()=>toggleSensor(sensor.id)} aria-pressed={sensor.id===selectedId} title={sensor.id===selectedId?"Show all sensors":"Show only this sensor"} className={cn("w-full rounded-xl border p-3 text-left",sensor.id===selectedId?"border-blue-400 bg-blue-50 ring-2 ring-blue-200":isOffline?"border-dashed border-slate-400 bg-slate-100 text-slate-700 hover:bg-slate-200":outOfRange?"border-amber-400 bg-amber-50 hover:bg-amber-100":"hover:bg-slate-50")}><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><span className={cn("h-2.5 w-2.5 rounded-full",isOffline&&"bg-slate-500")} style={isOffline?undefined:{backgroundColor:SENSOR_COLORS[index%6]}}/><span className={cn("text-sm font-semibold",isOffline&&"text-slate-800")}>{sensor.name}</span></div><span className={cn("text-[10px] font-semibold",outOfRange?"text-amber-600":sensor.status==="Online"?"text-emerald-600":"text-slate-500")}>{outOfRange?"Out of range":sensor.status}</span></div><div className={cn("grid grid-cols-2 gap-2 text-slate-600",isOffline&&"text-slate-600")}><span className="flex items-center gap-1 text-sm font-semibold"><Thermometer className={cn("h-4 w-4",isOffline?"text-slate-500":"text-orange-500")}/>{sensor.temperature?.toFixed(1) ?? "--"}°C</span><span className="flex items-center gap-1 text-sm font-semibold"><Droplets className={cn("h-4 w-4",isOffline?"text-slate-500":"text-sky-500")}/>{sensor.humidity?.toFixed(0) ?? "--"} %RH</span></div></button>})}</div></Card>
          <Card className="flex min-h-[400px] min-w-0 flex-col p-4 xl:min-h-0">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 font-semibold"><Activity className="h-4 w-4 text-blue-600"/>Sensor Trends</h2>
                <p className="text-xs text-slate-500">{selected ? selected.name : "All sensors"} · {rangeLabel}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {selected && <button type="button" onClick={() => setSelectedId(null)} className="flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] hover:bg-slate-50"><X className="h-3 w-3"/>Show all</button>}
                <button type="button" onClick={toggleAlertLines} aria-pressed={showAlertLines} className={cn("flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px]", showAlertLines ? "border-red-200 text-red-600 hover:bg-red-50" : "text-slate-500 hover:bg-slate-50")}>{showAlertLines ? <Eye className="h-3 w-3"/> : <EyeOff className="h-3 w-3"/>}Alert lines</button>
                <div className="flex rounded-lg border p-0.5">{([["1h","1H"],["6h","6H"],["today","1D"],["7d","7D"],["30d","30D"]] as const).map(([k,l])=><button key={k} onClick={()=>setPreset(k)} className={cn("rounded-md px-2 py-1 text-[11px]",preset===k?"bg-blue-600 text-white":"hover:bg-slate-100")}>{l}</button>)}<Popover><PopoverTrigger asChild><button className={cn("flex items-center gap-1 rounded-md px-2 py-1 text-[11px]",preset==="custom"&&"bg-blue-600 text-white")}><CalendarIcon className="h-3 w-3"/>Custom</button></PopoverTrigger><PopoverContent className="w-auto p-0" align="end"><Calendar mode="range" disabled={{after:new Date()}} selected={customRange} onSelect={r=>{setCustomRange(r);setPreset("custom")}} numberOfMonths={wide?2:1} initialFocus className="p-3 pointer-events-auto"/></PopoverContent></Popover></div>
              </div>
            </div>
            {selected && <SensorDetails sensor={selected} color={SENSOR_COLORS[sensors.indexOf(selected)%6]}/>}
            <div className="grid min-h-0 flex-1 grid-rows-2 gap-2">
              {([
                { metric: "temperature", title: "Temperature", unit: "°C", data: temperatureHistory, scale: temperatureScale, alert: temperatureAlert, draft: temperatureDraft, setDraft: setTemperatureDraft, step: "0.1", Icon: Thermometer, iconTone: "bg-orange-50 text-orange-600" },
                { metric: "humidity", title: "Humidity", unit: "%RH", data: humidityHistory, scale: humidityScale, alert: humidityAlert, draft: humidityDraft, setDraft: setHumidityDraft, step: "1", Icon: Droplets, iconTone: "bg-sky-50 text-sky-600" },
              ] as const).map(({ metric, title, unit, data, scale, alert, draft, setDraft, step, Icon, iconTone }) => {
                const axisError = pairError(draft.axisMin, draft.axisMax);
                return (
                <section key={title} className="flex min-h-[120px] min-w-0 flex-col border-t pt-2 first:border-t-0 first:pt-0">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg", iconTone)}><Icon className="h-4 w-4" aria-hidden="true"/></span>
                      <h3 className="text-sm font-bold tracking-tight text-slate-800">{title}</h3>
                      <span className="text-[10px] font-medium text-slate-500">{unit}</span>
                      {alert && alert !== "mixed" && <span className="text-[10px] text-red-600">- - - Alert below {alert.min}{unit} / above {alert.max}{unit}</span>}
                      {alert === "mixed" && <span className="text-[10px] text-amber-600">Alert range differs per sensor · click a sensor to see its limits</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button type="button" onClick={() => {
                        if (editingScale === metric) setEditingScale(null);
                        else {
                          setDraft(scale ?? EMPTY_SCALE);
                          setEditingScale(metric);
                        }
                      }} className="rounded-md border border-slate-200 px-2.5 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50">Scale</button>
                    </div>
                  </div>
                  {editingScale === metric && <div className="mb-1 flex flex-wrap items-end gap-x-3 gap-y-1 rounded-lg bg-slate-50 px-2 py-1.5">
                    <span className="text-[10px] font-semibold text-slate-600">Chart scale</span>
                    <label className="flex items-center gap-1 text-[10px] text-slate-500">Min<Input aria-label={`${title} axis minimum`} type="number" step={step} value={draft.axisMin} onChange={(event) => setDraft((current) => ({ ...current, axisMin: event.target.value }))} className="h-7 w-[4.25rem] px-1.5 text-xs"/></label>
                    <label className="flex items-center gap-1 text-[10px] text-slate-500">Max<Input aria-label={`${title} axis maximum`} type="number" step={step} value={draft.axisMax} onChange={(event) => setDraft((current) => ({ ...current, axisMax: event.target.value }))} className="h-7 w-[4.25rem] px-1.5 text-xs"/></label>
                    <Button type="button" size="sm" disabled={Boolean(axisError)} onClick={() => saveChartScale(metric)} className="h-7 px-3 text-[10px]">Save</Button>
                    {axisError ? <span className="text-[10px] text-slate-500">{axisError}</span> : <span className="text-[10px] text-slate-400">Leave empty for automatic</span>}
                  </div>}
                  <div className="min-h-[180px] flex-1 xl:min-h-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={data} syncId="sensor-trends" margin={{top:4,right:12,left:-10,bottom:0}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false}/>
                        {alert && alert !== "mixed" && <ReferenceLine y={alert.max} stroke="#f87171" strokeDasharray="4 4" strokeWidth={1.25}/>}
                        {alert && alert !== "mixed" && <ReferenceLine y={alert.min} stroke="#f87171" strokeDasharray="4 4" strokeWidth={1.25}/>}
                        {scale && <ReferenceLine y={Number(scale.axisMin)} stroke="transparent" strokeWidth={0} ifOverflow="visible" label={{ value: `${scale.axisMin}${unit}`, position: "left", dy: -8, fill: "#64748b", fontSize: 10 }}/>}
                        <XAxis dataKey="time" fontSize={10} tickLine={false} axisLine={false} minTickGap={40} hide={title === "Temperature"}/>
                        <YAxis domain={yDomain(scale, alert)} ticks={chartTicks(scale)} interval={0} minTickGap={0} allowDataOverflow={Boolean(scale)} tick={<ChartYAxisTick unit={unit}/>} tickLine={false} axisLine={false}/>
                        <Tooltip labelStyle={{fontWeight:600}} formatter={(value) => [`${value} ${unit}`, ""]}/>
                        <Legend wrapperStyle={{fontSize:10}} iconType="circle" iconSize={6}/>
                        {sensors.map((sensor,index)=>(selectedId===null||sensor.id===selectedId)&&<Line key={sensor.id} type="monotone" dataKey={`s${sensor.id}`} stroke={SENSOR_COLORS[index%6]} strokeWidth={selectedId===null?1.75:2.75} dot={false} activeDot={{r:4}} name={sensor.name}/>) }
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </section>
                );
              })}
            </div>
          </Card>
          <div className="grid min-h-0 gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(300px,1fr)]">
            <Card className="flex min-h-[260px] flex-col p-4">
              <div className="mb-3 flex justify-between"><h2 className="flex items-center gap-2 font-semibold"><MapPin className="h-4 w-4 text-blue-600"/>Floor Plan</h2><span className="text-xs text-slate-500">{sensors.length} points</span></div>
              <div className="relative min-h-[190px] flex-1 overflow-hidden rounded-xl border bg-slate-50"><svg viewBox="0 0 800 450" className="absolute inset-0 h-full w-full" preserveAspectRatio="none"><rect x="40" y="30" width="650" height="390" fill="#fff" stroke="#334155" strokeWidth="4"/><path d="M 229 30 V 240 H 40" fill="none" stroke="#334155" strokeWidth="4"/><path d="M 229 240 H 590 V 30" fill="none" stroke="#334155" strokeWidth="4" strokeDasharray="8 8"/><rect x="63" y="416" width="81" height="8" fill="#fff"/><path d="M 67 340 V 420 M 67 340 A 72 72 0 0 1 139 420" fill="none" stroke="#334155" strokeWidth="4"/><rect x="67" y="60" width="163" height="34" fill="none" stroke="#cbd5e1" strokeDasharray="6 6"/><rect x="509" y="350" width="154" height="34" fill="none" stroke="#cbd5e1" strokeDasharray="6 6"/><text x="365" y="235" textAnchor="middle" fill="#94a3b8" fontSize="19" fontWeight="700">LABORATORY ROOM</text></svg>{sensors.map((sensor,index)=><button key={sensor.id} onClick={()=>toggleSensor(sensor.id)} style={{left:`${sensor.x}%`,top:`${sensor.y}%`,backgroundColor:SENSOR_COLORS[index%6]}} aria-label={`Floor plan: ${sensor.name}`} title={sensor.name} className={cn("absolute grid h-7 min-w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full px-1 text-xs font-bold text-white shadow",sensor.id===selectedId&&"ring-4 ring-white",selectedId!==null&&sensor.id!==selectedId&&"opacity-40")}>{markerLabel(sensor.deviceId)}</button>)}</div>
            </Card>
            <Card className="flex min-h-[260px] flex-col p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-semibold"><Activity className="h-4 w-4 text-blue-600"/>Summary</h2>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500"/>Live</span>
              </div>
              <div className="grid flex-1 gap-2.5 sm:grid-cols-3 md:grid-cols-1 xl:grid-cols-3">
                <div className="flex flex-col justify-between rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-3">
                  <div className="flex items-start justify-between"><span className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-100 text-emerald-700"><Wifi className="h-4 w-4"/></span><span className="rounded-full bg-white/80 px-2 py-1 text-[10px] font-semibold text-emerald-700">{Math.round(online.length / Math.max(1, sensors.length) * 100)}% online</span></div>
                  <div className="mt-3"><p className="text-[11px] font-medium text-slate-500">Sensors Online</p><p className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">{online.length}<span className="ml-1 text-sm font-medium text-slate-400">/ {sensors.length}</span></p></div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-emerald-100"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.round(online.length / Math.max(1, sensors.length) * 100)}%` }}/></div>
                </div>
                <div className="flex flex-col justify-between rounded-xl border border-orange-100 bg-gradient-to-br from-orange-50 to-white p-3">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-orange-100 text-orange-700"><Thermometer className="h-4 w-4"/></span>
                  <div className="mt-3"><p className="text-[11px] font-medium text-slate-500">Average Temperature</p><p className="mt-0.5 whitespace-nowrap text-2xl font-bold tracking-tight text-slate-900">{withTemp.length ? avgTemp.toFixed(1) : "--"}<span className="ml-1 text-sm font-semibold text-orange-700">°C</span></p></div>
                  <p className="mt-3 text-[10px] text-slate-400">Across online sensors</p>
                </div>
                <div className="flex flex-col justify-between rounded-xl border border-sky-100 bg-gradient-to-br from-sky-50 to-white p-3">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-sky-100 text-sky-700"><Droplets className="h-4 w-4"/></span>
                  <div className="mt-3"><p className="text-[11px] font-medium text-slate-500">Average Humidity</p><p className="mt-0.5 whitespace-nowrap text-2xl font-bold tracking-tight text-slate-900">{withHum.length ? avgHum.toFixed(0) : "--"}<span className="ml-1 text-sm font-semibold text-sky-700">%RH</span></p></div>
                  <p className="mt-3 text-[10px] text-slate-400">Across online sensors</p>
                </div>
              </div>
            </Card>
          </div>
        </div></main>
      </div>
      <MobileNavigation />
    </div>
  );
}

/** One-sensor view: current values and that sensor's own alert range. */
function SensorDetails({ sensor, color }: { sensor: Sensor; color: string }) {
  const out = (value: number | null, low: number, high: number) => value != null && (value < low || value > high);
  const item = "flex flex-col gap-0.5 rounded-lg bg-slate-50 px-3 py-2";
  return (
    <div className="mb-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
      <div className={item}>
        <span className="flex items-center gap-1.5 font-semibold text-slate-800"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }}/>{sensor.name}</span>
        <span className="flex items-center gap-1 text-slate-500"><MapPin className="h-3 w-3"/>{sensor.location} · ID {sensor.deviceId}</span>
      </div>
      <div className={item}>
        <span className="text-slate-500">Status</span>
        <span className={cn("font-semibold", sensor.status === "Online" ? "text-emerald-600" : "text-slate-500")}>{sensor.status}</span>
      </div>
      <div className={item}>
        <span className="flex items-center gap-1 text-slate-500"><Thermometer className="h-3 w-3 text-orange-500"/>Temperature</span>
        <span className={cn("font-semibold", out(sensor.temperature, sensor.minTemp, sensor.maxTemp) && "text-red-600")}>{sensor.temperature?.toFixed(1) ?? "--"}°C <span className="font-normal text-slate-500">alert &lt;{sensor.minTemp} / &gt;{sensor.maxTemp}°C</span></span>
      </div>
      <div className={item}>
        <span className="flex items-center gap-1 text-slate-500"><Droplets className="h-3 w-3 text-sky-500"/>Humidity</span>
        <span className={cn("font-semibold", out(sensor.humidity, sensor.minHumidity, sensor.maxHumidity) && "text-red-600")}>{sensor.humidity?.toFixed(0) ?? "--"}%RH <span className="font-normal text-slate-500">alert &lt;{sensor.minHumidity} / &gt;{sensor.maxHumidity}%RH</span></span>
      </div>
    </div>
  );
}
