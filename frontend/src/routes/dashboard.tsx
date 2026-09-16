import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  LogOut, Thermometer, Droplets, Server, BatteryCharging,
  MapPin, Activity, Calendar as CalendarIcon, LayoutDashboard, Radio, Users, Settings, Plus, Wifi,
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
import { mockRole, permissions } from "@/lib/roles";

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

const SENSOR_COLORS = ["#2563eb", "#16a34a", "#9333ea", "#f97316", "#ef4444", "#0d9488"];
type Metric = "temperature" | "humidity";
type Preset = "today" | "7d" | "30d" | "custom";
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

  const { from, to } = useMemo(() => rangeFor(preset, customRange), [preset, customRange]);
  const history = useMemo(() => generateRangeComparison(sensors, from, to, metric), [sensors, from, to, metric]);
  const online = sensors.filter((sensor) => sensor.status === "Online");
  const avgTemp = online.reduce((sum, sensor) => sum + sensor.temperature, 0) / Math.max(1, online.length);
  const avgHum = online.reduce((sum, sensor) => sum + sensor.humidity, 0) / Math.max(1, online.length);
  const logout = () => { clearUser(); toast.success("Signed out"); navigate({ to: "/signin" }); };

  if (!user) return null;
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 lg:h-screen lg:overflow-hidden">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-[#0b1739] text-white lg:flex">
        <div className="flex h-20 items-center gap-3 border-b border-white/10 px-5"><BrandMark className="h-10 w-10 rounded-lg shadow-none" iconClassName="h-5 w-5" /><div><p className="text-sm font-bold">Lab Environment</p><p className="text-xs text-blue-200/70">Monitor</p></div></div>
        <nav className="flex-1 space-y-1.5 px-3 py-6" aria-label="Main navigation"><Link to="/dashboard" className="flex items-center gap-3 rounded-lg bg-blue-600 px-3 py-2.5 text-sm font-medium text-white"><LayoutDashboard className="h-[18px] w-[18px]"/>Dashboard</Link>{permissions.canManageSensors && <Link to="/sensors" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white"><Radio className="h-[18px] w-[18px]"/>Sensors</Link>}{permissions.canViewMembers && <Link to="/members" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white"><Users className="h-[18px] w-[18px]"/>Members</Link>}</nav>
        <div className="border-t border-white/10 px-3 py-4"><Link to="/settings" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white"><Settings className="h-[18px] w-[18px]"/>Settings</Link></div>
      </aside>
      <div className="flex min-h-screen min-w-0 flex-col lg:ml-60 lg:h-screen">
        <header className="flex h-16 shrink-0 items-center justify-between border-b bg-white px-4 sm:px-6"><div><h1 className="text-xl font-bold">Dashboard</h1><p className="hidden text-xs text-slate-500 sm:block">Real-time laboratory environment overview</p></div><div className="flex items-center gap-3"><div className="hidden text-right sm:block"><p className="text-sm font-semibold">{user.name}</p><p className="text-[11px] capitalize text-slate-500">{mockRole}</p></div><div className="grid h-9 w-9 place-items-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">{user.name.charAt(0).toUpperCase()}</div><Button variant="ghost" size="sm" onClick={logout}><LogOut className="h-4 w-4" /></Button></div></header>
        <main className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4 xl:p-5"><div className="mx-auto grid max-w-[1600px] gap-4 lg:h-full lg:grid-cols-[280px_minmax(0,1fr)] lg:grid-rows-[minmax(340px,1.35fr)_minmax(240px,1fr)]">
          <Card className="flex min-h-[430px] flex-col overflow-hidden lg:row-span-2 lg:min-h-0"><div className="flex items-center justify-between border-b px-4 py-4"><div><h2 className="font-semibold">Sensors</h2><p className="text-xs text-slate-500">{sensors.length} devices connected</p></div>{permissions.canManageSensors && <Button asChild size="sm" className="h-8 gap-1 bg-blue-600 px-2 text-xs"><Link to="/sensors"><Plus className="h-3.5 w-3.5" /> Add Sensor</Link></Button>}</div><div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 dashboard-scrollbar">{sensors.map((sensor,index)=>{const isOffline=sensor.status==="Offline";return <button key={sensor.id} onClick={()=>setActiveId(sensor.id)} className={cn("w-full rounded-xl border p-3 text-left",isOffline?"border-dashed border-slate-400 bg-slate-100 text-slate-700 hover:bg-slate-200":sensor.id===activeId?"border-blue-200 bg-blue-50":"hover:bg-slate-50")}><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><span className={cn("h-2.5 w-2.5 rounded-full",isOffline&&"bg-slate-500")} style={isOffline?undefined:{backgroundColor:SENSOR_COLORS[index%6]}}/><span className={cn("text-sm font-semibold",isOffline&&"text-slate-800")}>{sensor.name}</span></div><span className={cn("text-[10px] font-semibold",sensor.status==="Online"?"text-emerald-600":"text-slate-500")}>{sensor.status}</span></div><div className={cn("grid grid-cols-2 gap-2 text-slate-600",isOffline&&"text-slate-600")}><span className="flex items-center gap-1 text-sm font-semibold"><Thermometer className={cn("h-4 w-4",isOffline?"text-slate-500":"text-orange-500")}/>{sensor.temperature.toFixed(1)}°C</span><span className="flex items-center gap-1 text-sm font-semibold"><Droplets className={cn("h-4 w-4",isOffline?"text-slate-500":"text-sky-500")}/>{sensor.humidity.toFixed(0)} %RH</span></div></button>})}</div></Card>
          <Card className="flex min-h-[400px] min-w-0 flex-col p-4 lg:min-h-0"><div className="mb-3 flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 font-semibold"><Activity className="h-4 w-4 text-blue-600"/>Sensor Trends</h2><p className="text-xs text-slate-500">All sensors · {format(from,"d MMM")} – {format(to,"d MMM yyyy")}</p></div><div className="flex flex-wrap gap-2"><Tabs value={metric} onValueChange={v=>setMetric(v as Metric)}><TabsList className="h-8"><TabsTrigger value="temperature" className="text-xs">Temperature</TabsTrigger><TabsTrigger value="humidity" className="text-xs">Humidity</TabsTrigger></TabsList></Tabs><div className="flex rounded-lg border p-0.5">{([["today","1D"],["7d","7D"],["30d","30D"]] as const).map(([k,l])=><button key={k} onClick={()=>setPreset(k)} className={cn("rounded-md px-2 py-1 text-[11px]",preset===k?"bg-blue-600 text-white":"hover:bg-slate-100")}>{l}</button>)}<Popover><PopoverTrigger asChild><button className={cn("flex items-center gap-1 rounded-md px-2 py-1 text-[11px]",preset==="custom"&&"bg-blue-600 text-white")}><CalendarIcon className="h-3 w-3"/>Custom</button></PopoverTrigger><PopoverContent className="w-auto p-0" align="end"><Calendar mode="range" selected={customRange} onSelect={r=>{setCustomRange(r);setPreset("custom")}} numberOfMonths={2} initialFocus className="p-3 pointer-events-auto"/></PopoverContent></Popover></div></div></div><div className="min-h-[290px] flex-1"><ResponsiveContainer width="100%" height="100%"><LineChart data={history} margin={{top:8,right:12,left:-10}}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false}/><XAxis dataKey="time" fontSize={11} tickLine={false} axisLine={false}/><YAxis fontSize={11} tickLine={false} axisLine={false} unit={metric==="temperature"?"°":"%"}/><Tooltip/><Legend wrapperStyle={{fontSize:11}} iconType="circle" iconSize={7}/>{sensors.map((sensor,index)=><Line key={sensor.id} type="monotone" dataKey={`s${sensor.id}`} stroke={SENSOR_COLORS[index%6]} strokeWidth={sensor.id===activeId?2.75:2} dot={false} name={sensor.name}/>)}</LineChart></ResponsiveContainer></div></Card>
          <div className="grid min-h-0 gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(300px,1fr)]"><Card className="flex min-h-[260px] flex-col p-4"><div className="mb-3 flex justify-between"><h2 className="flex items-center gap-2 font-semibold"><MapPin className="h-4 w-4 text-blue-600"/>Floor Plan</h2><span className="text-xs text-slate-500">{sensors.length} points</span></div><div className="relative min-h-[190px] flex-1 overflow-hidden rounded-xl border bg-slate-50"><svg viewBox="0 0 800 450" className="absolute inset-0 h-full w-full" preserveAspectRatio="none"><rect x="40" y="30" width="720" height="390" fill="#fff" stroke="#334155" strokeWidth="4"/><rect x="70" y="60" width="180" height="34" fill="none" stroke="#cbd5e1" strokeDasharray="6 6"/><rect x="560" y="350" width="170" height="34" fill="none" stroke="#cbd5e1" strokeDasharray="6 6"/><text x="400" y="235" textAnchor="middle" fill="#94a3b8" fontSize="19" fontWeight="700">LABORATORY ROOM</text></svg>{sensors.map((sensor,index)=><button key={sensor.id} onClick={()=>setActiveId(sensor.id)} style={{left:`${sensor.x}%`,top:`${sensor.y}%`,backgroundColor:SENSOR_COLORS[index%6]}} className={cn("absolute grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-xs font-bold text-white shadow",sensor.id===activeId&&"ring-4 ring-white")}>{sensor.id}</button>)}</div></Card>
          <Card className="flex min-h-[260px] flex-col p-4"><h2 className="mb-3 font-semibold">Summary</h2><div className="grid flex-1 gap-2.5 sm:grid-cols-3 md:grid-cols-1 xl:grid-cols-3">{[["Sensors Online",`${online.length} / ${sensors.length}`,`${Math.round(online.length/Math.max(1,sensors.length)*100)}% Online`,Wifi,"text-emerald-600"],["Average Temperature",`${avgTemp.toFixed(1)} °C`,"Across online sensors",Thermometer,"text-orange-600"],["Average Humidity",`${avgHum.toFixed(0)} %RH`,"Across online sensors",Droplets,"text-sky-600"]].map(([label,value,detail,Icon,tone])=><div key={label as string} className="flex flex-col justify-center rounded-xl border bg-slate-50 p-3"><Icon className={cn("mb-3 h-5 w-5",tone as string)}/><p className="text-[11px] text-slate-500">{label as string}</p><p className="mt-1 whitespace-nowrap text-lg font-bold">{value as string}</p><p className="text-[10px] text-slate-400">{detail as string}</p></div>)}</div></Card></div>
        </div></main>
      </div>
    </div>
  );
}
