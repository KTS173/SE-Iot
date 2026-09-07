import { useEffect, useMemo, useState } from "react";

// Production uses nginx's same-origin /api proxy, so the Pi's IP/hostname does
// not need to be baked into the frontend image.
const API_URL = import.meta.env.VITE_API_URL || "";

export type SensorStatus = "Online" | "Offline";

export interface Sensor {
  id: number;
  deviceId: string;
  name: string;
  location: string;
  status: SensorStatus;
  /** null when the device has never reported, or the backend is unreachable. */
  temperature: number | null;
  humidity: number | null;
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

/**
 * Floor-plan placement and display names, which the broker does not carry.
 * Devices missing from this map are still shown, using a derived position.
 */
const DEVICE_PRESENTATION: Record<string, { name: string; location: string; x: number; y: number }> = {
  "001": { name: "Sensor 1", location: "North Wall", x: 46, y: 26 },
  "002": { name: "Sensor 2", location: "South Wall", x: 46, y: 82 },
};

/** Stable pseudo-random placement so an unmapped device keeps its spot. */
function derivedPlacement(deviceId: string): { x: number; y: number } {
  let hash = 0;
  for (const char of deviceId) hash = (hash * 31 + char.charCodeAt(0)) % 10_000;
  return { x: 15 + (hash % 70), y: 15 + ((hash * 7) % 70) };
}

function chartId(deviceId: string, index: number): number {
  const numeric = Number(deviceId);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 1000 + index;
}

interface DeviceReading {
  device_id: string;
  temperature: number | null;
  humidity: number | null;
  received_at: string;
  online: boolean;
}

function toSensor(reading: DeviceReading, index: number): Sensor {
  const presentation = DEVICE_PRESENTATION[reading.device_id];
  return {
    id: chartId(reading.device_id, index),
    deviceId: reading.device_id,
    name: presentation?.name ?? `Sensor ${reading.device_id}`,
    location: presentation?.location ?? "Unassigned",
    status: reading.online ? "Online" : "Offline",
    temperature: reading.online ? reading.temperature : null,
    humidity: reading.online ? reading.humidity : null,
    ...(presentation
      ? { x: presentation.x, y: presentation.y }
      : derivedPlacement(reading.device_id)),
  };
}

/**
 * Devices known to the backend, with their latest reading. Polls every 5s.
 * A device that has stopped reporting, or an unreachable backend, shows as
 * Offline with no values rather than the last number it happened to send.
 */
export function useLiveSensors(): Sensor[] {
  const [sensors, setSensors] = useState<Sensor[]>([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`${API_URL}/api/devices`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const { data } = (await response.json()) as { data: DeviceReading[] };
        if (active) setSensors(data.map(toSensor));
      } catch {
        // Backend unreachable: keep the roster, drop the readings. Showing the
        // last known values here would make an outage look like live data.
        if (active) {
          setSensors((current) =>
            current.map((sensor) => ({
              ...sensor,
              status: "Offline" as SensorStatus,
              temperature: null,
              humidity: null,
            })),
          );
        }
      }
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return sensors;
}

interface ChartPoint {
  time: string;
  [key: `s${number}`]: number;
}

interface HistoryReading {
  device_id: string;
  temperature: number | null;
  humidity: number | null;
  received_at: string;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function bucketLabel(date: Date, byHour: boolean): string {
  if (byHour) return `${String(date.getHours()).padStart(2, "0")}:00`;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * Real history from the backend, averaged into hourly buckets for ranges up to
 * two days and daily buckets beyond that. Returns only buckets that have data.
 */
export function useRangeComparison(
  sensors: Sensor[],
  from: Date,
  to: Date,
  metric: "temperature" | "humidity",
): ChartPoint[] {
  const [readings, setReadings] = useState<HistoryReading[]>([]);
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const query = new URLSearchParams({ from: fromIso, to: toIso, limit: "5000" });
        const response = await fetch(`${API_URL}/api/sensors?${query}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const { data } = (await response.json()) as { data: HistoryReading[] };
        if (active) setReadings(data);
      } catch {
        if (active) setReadings([]);
      }
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [fromIso, toIso]);

  return useMemo(() => {
    const byHour = to.getTime() - from.getTime() <= 2 * DAY_MS;
    const bucketMs = byHour ? HOUR_MS : DAY_MS;
    const idOf = new Map(sensors.map((sensor) => [sensor.deviceId, sensor.id]));

    // bucket start -> chart id -> running average
    const buckets = new Map<number, Map<number, { sum: number; count: number }>>();

    for (const reading of readings) {
      const id = idOf.get(reading.device_id);
      const value = metric === "temperature" ? reading.temperature : reading.humidity;
      if (id === undefined || value == null) continue;

      const time = new Date(reading.received_at).getTime();
      if (Number.isNaN(time)) continue;

      const start = Math.floor(time / bucketMs) * bucketMs;
      const bucket = buckets.get(start) ?? new Map();
      const entry = bucket.get(id) ?? { sum: 0, count: 0 };
      entry.sum += value;
      entry.count += 1;
      bucket.set(id, entry);
      buckets.set(start, bucket);
    }

    return [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([start, bucket]) => {
        const point = { time: bucketLabel(new Date(start), byHour) } as ChartPoint;
        for (const [id, { sum, count }] of bucket) {
          point[`s${id}`] = Number((sum / count).toFixed(1));
        }
        return point;
      });
  }, [readings, sensors, metric, from, to]);
}
