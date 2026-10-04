import { useEffect, useMemo, useState } from "react";
import { apiFetch, poll } from "@/lib/api";


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
        const response = await apiFetch(`/api/health`);
        if (response.ok && active) setHealth((await response.json()) as SystemHealth);
      } catch {
        // Keep the last known health status during a temporary network failure.
      }
    };
    const stop = poll(load, 30_000);
    return () => {
      active = false;
      stop();
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

/**
 * Numeric key for charts and selection. Non-numeric device IDs get a hash, not
 * their list position, so the focused sensor survives the roster changing.
 */
function chartId(deviceId: string): number {
  const numeric = Number(deviceId);
  if (Number.isInteger(numeric) && numeric > 0 && numeric < 1_000_000) return numeric;
  let hash = 0;
  for (const char of deviceId) hash = (hash * 31 + char.charCodeAt(0)) % 1_000_000_000;
  return 1_000_000 + hash;
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

function toSensor(row: DeviceRow): Sensor {
  return {
    id: chartId(row.device_id),
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
  const response = await apiFetch(`/api/devices/${encodeURIComponent(deviceId)}`, {
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
  const response = await apiFetch(
    `/api/devices/${encodeURIComponent(deviceId)}${query}`,
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
        const response = await apiFetch(`/api/devices`);
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
    const stop = poll(load, 5000);
    changeListeners.add(load);
    return () => {
      active = false;
      stop();
      changeListeners.delete(load);
    };
  }, []);

  return sensors;
}

interface ChartPoint {
  time: string;
  [key: `s${number}`]: number;
}

interface ChartRow {
  device_id: string;
  /** bucket start, epoch ms */
  start: number;
  temperature: number | null;
  humidity: number | null;
}

export interface RangeHistory {
  temperature: ChartPoint[];
  humidity: ChartPoint[];
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
 * History for both charts from one request. The backend averages readings into
 * buckets sized to the span (minutes for hours, hours for days, days for
 * months), so even 30 days is a few hundred rows. Returns only buckets that
 * have data.
 */
export function useRangeHistory(sensors: Sensor[], from: Date, to: Date): RangeHistory {
  const [rows, setRows] = useState<ChartRow[]>([]);
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const bucket = bucketFor(to.getTime() - from.getTime());

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const query = new URLSearchParams({
          from: fromIso,
          to: toIso,
          bucket: String(bucket.ms / 1000),
          // Day buckets start at local midnight.
          offset: String(-new Date().getTimezoneOffset() * 60),
        });
        const response = await apiFetch(`/api/sensors/chart?${query}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const { data } = (await response.json()) as { data: ChartRow[] };
        if (active) setRows(data);
      } catch {
        if (active) setRows([]);
      }
    };
    const stop = poll(load, 30_000);
    return () => {
      active = false;
      stop();
    };
  }, [fromIso, toIso, bucket.ms]);

  return useMemo(() => {
    const idOf = new Map(sensors.map((sensor) => [sensor.deviceId, sensor.id]));
    const series = (metric: "temperature" | "humidity"): ChartPoint[] => {
      const points = new Map<number, ChartPoint>();
      for (const row of rows) {
        const id = idOf.get(row.device_id);
        const value = row[metric];
        if (id === undefined || value == null) continue;
        const point = points.get(row.start) ?? ({ time: bucket.label(new Date(row.start)) } as ChartPoint);
        point[`s${id}`] = value;
        points.set(row.start, point);
      }
      // Rows arrive ordered by bucket start.
      return [...points.values()];
    };
    return { temperature: series("temperature"), humidity: series("humidity") };
    // bucket.label only changes together with bucket.ms.
  }, [rows, sensors, bucket.ms]);
}
