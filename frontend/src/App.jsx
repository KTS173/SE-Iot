import { useCallback, useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

function MetricCard({ icon, label, value, unit, tone }) {
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-icon">{icon}</div>
      <div>
        <p>{label}</p>
        <strong>{value ?? "--"} <span>{unit}</span></strong>
      </div>
    </article>
  );
}

function App() {
  const [latest, setLatest] = useState(null);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const [sensorResponse, healthResponse] = await Promise.all([
        fetch(`${API_URL}/api/sensors/latest`),
        fetch(`${API_URL}/api/health`),
      ]);
      if (!sensorResponse.ok || !healthResponse.ok) throw new Error("API unavailable");
      const sensor = await sensorResponse.json();
      const apiHealth = await healthResponse.json();
      setLatest(sensor.data);
      setHealth(apiHealth);
      setUpdatedAt(new Date());
      setError("");
    } catch {
      setError("เชื่อมต่อ Flask API ไม่สำเร็จ");
    }
  }, []);

  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, 5000);
    return () => clearInterval(timer);
  }, [loadData]);

  return (
    <main className="page">
      <header>
        <div>
          <p className="eyebrow">SMART ENVIRONMENT</p>
          <h1>IoT Sensor Dashboard</h1>
          <p className="subtitle">ติดตามข้อมูลสภาพแวดล้อมแบบเรียลไทม์</p>
        </div>
        <button onClick={loadData}>↻ รีเฟรช</button>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="status-panel">
        <div className="status-title">
          <span className={`pulse ${health?.mqtt_connected ? "online" : ""}`} />
          <div>
            <strong>{health?.mqtt_connected ? "MQTT ออนไลน์" : "รอการเชื่อมต่อ MQTT"}</strong>
            <p>Topic: {health?.mqtt_topic || "กำลังโหลด..."}</p>
          </div>
        </div>
        <span>อัปเดต {updatedAt ? updatedAt.toLocaleTimeString("th-TH") : "--:--"}</span>
      </section>

      <section className="metrics">
        <MetricCard icon="🌡️" label="อุณหภูมิ" value={latest?.temperature} unit="°C" tone="orange" />
        <MetricCard icon="💧" label="ความชื้น" value={latest?.humidity} unit="%" tone="blue" />
      </section>

      <section className="device">
        <div>
          <p className="eyebrow">LATEST READING</p>
          <h2>{latest ? latest.device_id : "ยังไม่มีข้อมูล Sensor"}</h2>
          <p>
            {latest
              ? `รับข้อมูลเมื่อ ${new Date(latest.received_at).toLocaleString("th-TH")}`
              : "ส่งข้อมูลผ่าน MQTT หรือ REST API เพื่อเริ่มแสดงผล"}
          </p>
        </div>
        <div className="device-art">⌁</div>
      </section>
    </main>
  );
}

export default App;
