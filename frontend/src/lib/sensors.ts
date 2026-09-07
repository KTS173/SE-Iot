import { useEffect, useState } from "react";

// Production uses nginx's same-origin /api proxy, so the Pi's IP/hostname does
// not need to be baked into the frontend image.
const API_URL = import.meta.env.VITE_API_URL || "";

export type SensorStatus = "Online" | "Offline";

export interface Sensor {
  id: number;
  name: string;
  location: string;
  status: SensorStatus;
  temperature: number;
  humidity: number;
  /** floor-plan marker position, percent of container */
  x: number;
  y: number;
}

export interface SystemHealth {
  status: string;
  mqtt_connected: boolean;
  stored_readings: number;
  storage: {
    used_percent: number;
    free_bytes: number;
    total_bytes: number;
    warning_percent: number;
    alert: boolean;
  };
}

export function useSystemHealth(): SystemHealth | null {
  const [health, setHealth] = useState<SystemHealth | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`${API_URL}/api/health`);
        if (response.ok && active) setHealth((await response.json()) as SystemHealth);
      } catch {
        // Keep the last known health status during a temporary network failure.
      }
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return health;
}

/** Baseline mock sensors. Sensor 1 & 2 are overridden with live data. */
export const SENSORS: Sensor[] = [
  { id: 1, name: "Sensor 1", location: "North Wall", status: "Online", temperature: 22.4, humidity: 48, x: 46, y: 26 },
  { id: 2, name: "Sensor 2", location: "South Wall", status: "Online", temperature: 23.1, humidity: 51, x: 46, y: 82 },
  { id: 3, name: "Sensor 3", location: "East Bench", status: "Online", temperature: 4.8, humidity: 62, x: 78, y: 40 },
  { id: 4, name: "Sensor 4", location: "West Bench", status: "Offline", temperature: 21.7, humidity: 45, x: 20, y: 62 },
  { id: 5, name: "Sensor 5", location: "Incubator Row", status: "Online", temperature: 37.2, humidity: 55, x: 66, y: 68 },
  { id: 6, name: "Sensor 6", location: "Server Rack", status: "Online", temperature: 19.5, humidity: 40, x: 24, y: 40 },
];

/** Real broker device_id -> mock sensor id. */
const LIVE_DEVICE_MAP: Record<string, number> = { "001": 1, "002": 2 };

interface Reading {
  device_id: string;
  temperature: number | null;
  humidity: number | null;
}

/**
 * Returns the sensor list with Sensor 1 & 2 overridden by the latest live
 * temperature/humidity from the Flask API (devices 001 / 002). Sensors 3-6
 * stay mock. Polls every 5s.
 */
export function useLiveSensors(): Sensor[] {
  const [live, setLive] = useState<Record<number, { temperature: number; humidity: number }>>({});

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/api/sensors?limit=100`);
        if (!res.ok) return;
        const { data } = (await res.json()) as { data: Reading[] };
        const latest: Record<number, { temperature: number; humidity: number }> = {};
        for (const r of data) {
          const id = LIVE_DEVICE_MAP[r.device_id];
          if (id && r.temperature != null && r.humidity != null) {
            latest[id] = { temperature: r.temperature, humidity: r.humidity };
          }
        }
        if (active) setLive(latest);
      } catch {
        /* backend down -> keep mock values */
      }
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return SENSORS.map((s) =>
    live[s.id] ? { ...s, ...live[s.id], status: "Online" as SensorStatus } : s,
  );
}

interface ChartPoint {
  time: string;
  [key: `s${number}`]: number;
}

/** Deterministic pseudo-history for the comparison chart (no real history in backend). */
export function generateRangeComparison(
  sensors: Sensor[],
  from: Date,
  to: Date,
  metric: "temperature" | "humidity",
): ChartPoint[] {
  const dayMs = 86_400_000;
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / dayMs) + 1);
  const points: ChartPoint[] = [];

  for (let i = 0; i < days; i++) {
    const d = new Date(from.getTime() + i * dayMs);
    const row = { time: `${d.getMonth() + 1}/${d.getDate()}` } as ChartPoint;
    for (const s of sensors) {
      const base = metric === "temperature" ? s.temperature : s.humidity;
      const wobble = Math.sin((i + s.id) * 1.3) * (metric === "temperature" ? 1.5 : 4);
      row[`s${s.id}`] = Number((base + wobble).toFixed(1));
    }
    points.push(row);
  }
  return points;
}
