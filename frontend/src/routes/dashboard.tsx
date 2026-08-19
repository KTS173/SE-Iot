import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  FlaskConical, LogOut, Thermometer, Droplets, Server, BatteryCharging,
  Video, MapPin, Activity, Circle, Calendar as CalendarIcon, AlertTriangle,
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
import { generateRangeComparison, useLiveSensors, useSystemHealth } from "@/lib/sensors";
import { toast } from "sonner";


export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Lab Monitoring System" },
      { name: "description", content: "Live temperature, humidity and camera monitoring for your laboratory." },
      { property: "og:title", content: "Dashboard — Lab Monitoring System" },
      { property: "og:description", content: "Real-time sensor data across all lab rooms." },
    ],
  }),
  component: Dashboard,
});

const SENSOR_COLORS = ["#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];
type Metric = "temperature" | "humidity";

function Dashboard() {
  const navigate = useNavigate();
  const sensors = useLiveSensors();
  const systemHealth = useSystemHealth();
  const [user, setUserState] = useState<User | null>(null);
  const [activeId, setActiveId] = useState(1);
  const [metric, setMetric] = useState<Metric>("temperature");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - 6);
    return { from, to };
  });

  useEffect(() => {
    const u = getUser();
    if (!u) {
      navigate({ to: "/signin" });
      return;
    }
    setUserState(u);
  }, [navigate]);

  useEffect(() => {
    if (systemHealth?.storage.alert) {
      toast.error(`Storage nearly full: ${systemHealth.storage.used_percent}% used`, {
        id: "storage-nearly-full",
        duration: 10_000,
      });
    }
  }, [systemHealth?.storage.alert, systemHealth?.storage.used_percent]);

  const active = useMemo(
    () => sensors.find((s) => s.id === activeId) ?? sensors[0],
    [sensors, activeId],
  );
  const history = useMemo(() => {
    const from = dateRange?.from ?? new Date();
    const to = dateRange?.to ?? dateRange?.from ?? new Date();
    return generateRangeComparison(sensors, from, to, metric);
  }, [sensors, dateRange, metric]);


  const logout = () => {
    clearUser();
    toast.success("Signed out");
    navigate({ to: "/signin" });
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="px-4 sm:px-6 py-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br from-blue-600 to-sky-500 grid place-items-center text-white">
              <FlaskConical className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm sm:text-base font-semibold">
                Laboratory Temperature & Humidity Monitoring System
              </h1>
              <p className="text-xs text-muted-foreground hidden sm:block">Real-time environmental dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <StatusPill icon={<Server className="w-3.5 h-3.5" />} label="Host PC" ok />
            <StatusPill icon={<BatteryCharging className="w-3.5 h-3.5" />} label="UPS" ok />
            <div className="hidden md:flex items-center gap-2 pl-3 border-l">
              <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 grid place-items-center text-sm font-semibold">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div className="text-sm">
                <div className="font-medium leading-tight">{user.name}</div>
                <div className="text-xs text-muted-foreground leading-tight">Operator</div>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={logout} className="gap-2">
              <LogOut className="w-4 h-4" /> <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>
      </header>

      {systemHealth?.storage.alert && (
        <div className="mx-4 sm:mx-6 mt-4 flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div className="text-sm">
            <span className="font-semibold">พื้นที่จัดเก็บใกล้เต็ม</span>{" "}
            ใช้แล้ว {systemHealth.storage.used_percent}% เหลือประมาณ{" "}
            {(systemHealth.storage.free_bytes / 1_073_741_824).toFixed(1)} GB
          </div>
        </div>
      )}

      <div className="p-4 sm:p-6 grid grid-cols-12 gap-4 lg:gap-6">
        {/* Sidebar */}
        <aside className="col-span-12 lg:col-span-2">
          <Card className="p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2 px-2">Sensors</div>
            <div className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-visible">
              {sensors.map((s) => {
                const on = s.id === activeId;
                return (
                  <button
                    key={s.id}
                    onClick={() => setActiveId(s.id)}
                    className={`shrink-0 lg:w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-3 transition-all ${
                      on ? "bg-blue-600 text-white shadow-md shadow-blue-600/20" : "hover:bg-slate-100 text-slate-700"
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-md grid place-items-center ${on ? "bg-white/20" : "bg-blue-50 text-blue-600"}`}>
                      <Thermometer className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{s.name}</div>
                      <div className={`text-xs truncate ${on ? "text-blue-50" : "text-muted-foreground"}`}>{s.location}</div>
                    </div>
                    <Circle
                      className={`w-2 h-2 ml-auto fill-current ${s.status === "Online" ? "text-emerald-400" : "text-red-400"}`}
                    />
                  </button>
                );
              })}
            </div>
          </Card>
        </aside>

        {/* Main center */}
        <main className="col-span-12 lg:col-span-7 space-y-4 lg:space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">{active.name}</h2>
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" /> {active.location}
              </p>
            </div>
            <Badge variant={active.status === "Online" ? "default" : "destructive"} className={active.status === "Online" ? "bg-emerald-500 hover:bg-emerald-500" : ""}>
              <Circle className="w-2 h-2 fill-current mr-1.5" />
              {active.status}
            </Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MetricCard
              icon={<Thermometer className="w-5 h-5" />}
              label="Temperature"
              value={active.temperature.toFixed(1)}
              unit="°C"
              accent="from-orange-400 to-red-500"
              trend="+0.2°C vs 1h ago"
            />
            <MetricCard
              icon={<Droplets className="w-5 h-5" />}
              label="Humidity"
              value={active.humidity.toFixed(0)}
              unit="%"
              accent="from-sky-400 to-blue-600"
              trend="-1% vs 1h ago"
            />
          </div>

          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="font-semibold flex items-center gap-2">
                  <Activity className="w-4 h-4 text-blue-600" /> Sensor Comparison
                </h3>
                <p className="text-xs text-muted-foreground">
                  {metric === "temperature" ? "Temperature (°C)" : "Humidity (%)"} across all sensors
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Tabs value={metric} onValueChange={(v) => setMetric(v as Metric)}>
                  <TabsList>
                    <TabsTrigger value="temperature">Temperature</TabsTrigger>
                    <TabsTrigger value="humidity">Humidity</TabsTrigger>
                  </TabsList>
                </Tabs>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "justify-start text-left font-normal gap-2",
                        !dateRange && "text-muted-foreground",
                      )}
                    >
                      <CalendarIcon className="w-4 h-4" />
                      {dateRange?.from ? (
                        dateRange.to && dateRange.to.getTime() !== dateRange.from.getTime() ? (
                          <>
                            {format(dateRange.from, "MMM d, yyyy")} – {format(dateRange.to, "MMM d, yyyy")}
                          </>
                        ) : (
                          format(dateRange.from, "MMM d, yyyy")
                        )
                      ) : (
                        <span>Pick a date range</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar
                      mode="range"
                      selected={dateRange}
                      onSelect={setDateRange}
                      numberOfMonths={2}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="time" stroke="#94a3b8" fontSize={12} />
                  <YAxis stroke="#94a3b8" fontSize={12} unit={metric === "temperature" ? "°" : "%"} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {sensors.map((s, idx) => (
                    <Line
                      key={s.id}
                      type="monotone"
                      dataKey={`s${s.id}`}
                      stroke={SENSOR_COLORS[idx % SENSOR_COLORS.length]}
                      strokeWidth={s.id === activeId ? 3 : 1.75}
                      strokeOpacity={s.id === activeId ? 1 : 0.75}
                      dot={false}
                      name={s.name}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>


          {/* Floor plan */}
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-blue-600" /> Room Floor Plan
                </h3>
                <p className="text-xs text-muted-foreground">Click a marker to view sensor</p>
              </div>
              <span className="text-xs text-muted-foreground">6 sensors installed</span>
            </div>
            <div className="relative w-full aspect-[16/9] rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
              <svg viewBox="0 0 800 450" className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
                <defs>
                  <pattern id="floor" width="20" height="20" patternUnits="userSpaceOnUse">
                    <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e2e8f0" strokeWidth="1" />
                  </pattern>
                </defs>

                {/* Room floor */}
                <rect x="0" y="0" width="800" height="450" fill="url(#floor)" />
                <rect x="40" y="30" width="720" height="390" fill="#f8fafc" fillOpacity="0.6" />

                {/* Outer walls */}
                <rect x="40" y="30" width="720" height="390" fill="none" stroke="#1e293b" strokeWidth="4" />

                {/* Single entrance door */}
                <line x1="380" y1="420" x2="440" y2="420" stroke="#f8fafc" strokeWidth="5" />
                <path d="M 440 420 A 60 60 0 0 1 500 360" fill="none" stroke="#94a3b8" strokeWidth="1" />
                <text x="410" y="445" textAnchor="middle" fill="#64748b" fontSize="10">ENTRANCE</text>

                {/* Lab bench / equipment hints */}
                <rect x="70" y="60" width="180" height="34" fill="none" stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" />
                <rect x="70" y="350" width="180" height="34" fill="none" stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" />
                <rect x="560" y="60" width="170" height="34" fill="none" stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" />
                <rect x="560" y="350" width="170" height="34" fill="none" stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" />
                <rect x="340" y="90" width="120" height="70" fill="none" stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" />
                <rect x="120" y="150" width="60" height="120" fill="none" stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" />
                <rect x="620" y="150" width="60" height="120" fill="none" stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" />

                {/* Room label */}
                <text x="400" y="270" textAnchor="middle" fill="#64748b" fontSize="14" fontWeight="700" letterSpacing="2">MAIN LABORATORY</text>
                <text x="400" y="290" textAnchor="middle" fill="#94a3b8" fontSize="10" letterSpacing="1">6 SENSOR MONITORING POINTS</text>

                {/* Compass */}
                <g transform="translate(755, 405)">
                  <circle r="18" fill="white" stroke="#cbd5e1" strokeWidth="1" />
                  <path d="M 0 -12 L 4 4 L 0 0 L -4 4 Z" fill="#2563eb" />
                  <text y="-6" textAnchor="middle" fontSize="8" fill="#64748b" fontWeight="700">N</text>
                </g>
              </svg>
              {sensors.map((s) => {
                const on = s.id === activeId;
                return (
                  <button
                    key={s.id}
                    onClick={() => setActiveId(s.id)}
                    style={{ left: `${s.x}%`, top: `${s.y}%` }}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 group transition-all ${on ? "z-20 scale-110" : "z-10 hover:scale-105"}`}
                  >
                    <span className={`block w-7 h-7 rounded-full grid place-items-center text-white text-xs font-bold shadow-lg ${
                      on ? "bg-blue-600 ring-4 ring-blue-200" : s.status === "Online" ? "bg-emerald-500" : "bg-red-500"
                    }`}>
                      {s.id}
                    </span>
                    {on && (
                      <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1 whitespace-nowrap text-[10px] bg-slate-900 text-white px-2 py-0.5 rounded">
                        {s.name}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </Card>
        </main>

        {/* Right column */}
        <aside className="col-span-12 lg:col-span-3 space-y-4 lg:space-y-6">
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2">
                <Video className="w-4 h-4 text-blue-600" /> Live Cameras
              </h3>
              <Badge className="bg-red-500 hover:bg-red-500 text-[10px]">LIVE</Badge>
            </div>
            <div className="grid grid-cols-1 gap-3">
              {[1, 2].map((n) => (
                <div key={n} className="relative aspect-video rounded-lg bg-slate-900 overflow-hidden group">
                  <div className="absolute inset-0 bg-gradient-to-br from-slate-800 via-slate-900 to-black" />
                  <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_50%_50%,white_1px,transparent_1px)] [background-size:8px_8px]" />
                  <div className="absolute inset-0 grid place-items-center text-slate-400">
                    <div className="text-center">
                      <Video className="w-8 h-8 mx-auto opacity-60" />
                      <div className="text-xs mt-1">Camera {n} Feed</div>
                    </div>
                  </div>
                  <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/60 backdrop-blur px-2 py-1 rounded text-white text-[10px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                    CAM {n}
                  </div>
                  <div className="absolute bottom-2 right-2 text-[10px] text-white/70 font-mono">
                    {new Date().toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Sensor Summary</h3>
              <span className="text-xs text-muted-foreground">{sensors.length} total</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <SummaryStat label="Online" value={sensors.filter((s) => s.status === "Online").length} color="text-emerald-600" />
              <SummaryStat label="Offline" value={sensors.filter((s) => s.status === "Offline").length} color="text-red-600" />
              <SummaryStat label="Total" value={sensors.length} color="text-blue-600" />
            </div>
            <div className="space-y-1.5">
              {sensors.map((s) => {
                const on = s.id === activeId;
                return (
                  <button
                    key={s.id}
                    onClick={() => setActiveId(s.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                      on ? "bg-blue-50 border border-blue-200" : "hover:bg-slate-50 border border-transparent"
                    }`}
                  >
                    <Circle className={`w-2 h-2 shrink-0 fill-current ${s.status === "Online" ? "text-emerald-500" : "text-red-500"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{s.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{s.location}</div>
                    </div>
                    <div className="text-right text-xs shrink-0">
                      <div className="font-semibold text-slate-900">{s.temperature.toFixed(1)}°</div>
                      <div className="text-muted-foreground">{s.humidity}%</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function StatusPill({ icon, label, ok }: { icon: React.ReactNode; label: string; ok: boolean }) {
  return (
    <div className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
      ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
    }`}>
      {icon}
      <span>{label}</span>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-red-500"} animate-pulse`} />
    </div>
  );
}

function MetricCard({
  icon, label, value, unit, accent, trend,
}: { icon: React.ReactNode; label: string; value: string; unit: string; accent: string; trend: string }) {
  return (
    <Card className="p-5 relative overflow-hidden group hover:shadow-lg transition-shadow">
      <div className={`absolute -right-8 -top-8 w-32 h-32 rounded-full bg-gradient-to-br ${accent} opacity-10 group-hover:opacity-20 transition-opacity`} />
      <div className="flex items-center justify-between relative">
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-4xl font-bold tracking-tight text-slate-900">{value}</span>
            <span className="text-lg text-muted-foreground font-medium">{unit}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-2">{trend}</div>
        </div>
        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${accent} text-white grid place-items-center shadow-lg`}>
          {icon}
        </div>
      </div>
    </Card>
  );
}

function SummaryStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center py-2 rounded-lg bg-slate-50">
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
