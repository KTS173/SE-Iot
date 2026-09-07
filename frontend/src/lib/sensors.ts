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
  minTemp: number;
  maxTemp: number;
  minHumidity: number;
  maxHumidity: number;
  /** false when the device has reported but has no saved settings yet. */
  configured: boolean;
}

export interface SensorConfigInput {
  name: string;
  location: string;
  x?: number;
  y?: number;
  min_temp: number;
  max_temp: number;
  min_humidity: number;
  max_humidity: number;
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

/** Stable placement for a device with no saved position, so it keeps its spot. */
function derivedPlacement(deviceId: string): { x: number; y: number } {
  let hash = 0;
  for (const char of deviceId) hash = (hash * 31 + char.charCodeAt(0)) % 10_000;
  return { x: 15 + (hash % 70), y: 15 + ((hash * 7) % 70) };
}

function chartId(deviceId: string, index: number): number {
  const numeric = Number(deviceId);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 1000 + index;
}

interface DeviceRow {
  device_id: string;
  temperature: number | null;
  humidity: number | null;
  received_at: string | null;
  online: boolean;
  name: string;
  location: string;
  x: number;
  y: number;
  min_temp: number;
  max_temp: number;
  min_humidity: number;
  max_humidity: number;
  configured: boolean;
}

function toSensor(row: DeviceRow, index: number): Sensor {
  return {
    id: chartId(row.device_id, index),
    deviceId: row.device_id,
    name: row.name,
    location: row.location,
    status: row.online ? "Online" : "Offline",
    temperature: row.online ? row.temperature : null,
    humidity: row.online ? row.humidity : null,
    ...(row.configured ? { x: row.x, y: row.y } : derivedPlacement(row.device_id)),
    minTemp: row.min_temp,
    maxTemp: row.max_temp,
    minHumidity: row.min_humidity,
    maxHumidity: row.max_humidity,
    configured: row.configured,
  };
}

/** Lets a write refresh every mounted sensor list without waiting for the poll. */
const changeListeners = new Set<() => void>();
function notifySensorsChanged(): void {
  for (const listener of changeListeners) listener();
}

export async function saveSensorConfig(
  deviceId: string,
  config: SensorConfigInput,
): Promise<void> {
  const response = await fetch(`${API_URL}/api/devices/${encodeURIComponent(deviceId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    const { error } = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(error ?? `Could not save sensor (HTTP ${response.status})`);
  }
  notifySensorsChanged();
}

export async function deleteSensorConfig(deviceId: string, purge = false): Promise<void> {
  const query = purge ? "?purge=true" : "";
  const response = await fetch(
    `${API_URL}/api/devices/${encodeURIComponent(deviceId)}${query}`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error(`Could not delete sensor (HTTP ${response.status})`);
  notifySensorsChanged();
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
        const { data } = (await response.json()) as { data: DeviceRow[] };
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
    changeListeners.add(load);
    return () => {
      active = false;
      clearInterval(timer);
      changeListeners.delete(load);
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

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function clockLabel(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * Bucket width follows the span. Anything up to half a day plots one point per
 * minute; beyond that a minute bucket is more points than the axis can carry.
 */
function bucketFor(spanMs: number): { ms: number; label: (date: Date) => string } {
  if (spanMs <= 12 * HOUR_MS) return { ms: MINUTE_MS, label: clockLabel };
  if (spanMs <= 2 * DAY_MS) {
    return { ms: HOUR_MS, label: (date) => `${String(date.getHours()).padStart(2, "0")}:00` };
  }
  return { ms: DAY_MS, label: (date) => `${date.getMonth() + 1}/${date.getDate()}` };
}

/**
 * Real history from the backend, averaged into buckets sized to the requested
 * span (minutes for hours, hours for days, days for months). Returns only
 * buckets that have data.
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
    const { ms: bucketMs, label } = bucketFor(to.getTime() - from.getTime());
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
        const point = { time: label(new Date(start)) } as ChartPoint;
        for (const [id, { sum, count }] of bucket) {
          point[`s${id}`] = Number((sum / count).toFixed(1));
        }
        return point;
      });
  }, [readings, sensors, metric, from, to]);
}
