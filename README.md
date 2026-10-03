# SE-IoT

ระบบติดตามอุณหภูมิ/ความชื้นในห้องแล็บ

```
ESP32 ──MQTT──▶ Mosquitto ──▶ FastAPI backend ──▶ SQLite
                                   ▲
Browser ──▶ nginx (React + Vite) ──┘ /api/
```

| ส่วน | เทคโนโลยี | โฟลเดอร์ |
|---|---|---|
| Frontend | React, Vite, TypeScript, Tailwind | `frontend/` |
| Backend | FastAPI, paho-mqtt, SQLite | `backend/` |
| Broker | Mosquitto (ต้องใช้ username/password) | `mosquitto/` |

## รันบนเครื่อง (dev)

```bash
# Backend: http://localhost:5000  (เอกสาร API: /docs)
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python app.py

# Frontend: http://localhost:5173
cd frontend
npm install
npm run dev
```

ค่าเชื่อมต่อใส่ใน `backend/.env` และ `frontend/.env` (ดูแม่แบบใน `.env.example`)

## ทดสอบ (backend)

```bash
cd backend
pip install -r requirements-dev.txt
pytest                                  # รันเทสต์ + รายงาน coverage
pytest --cov-report=html                # รายงานละเอียดที่ htmlcov/index.html
```

เทสต์ใช้ฐานข้อมูลชั่วคราว ไม่ต่อ MQTT และไม่ส่ง LINE จริง
ถ้า coverage ต่ำกว่า 85% คำสั่ง `pytest` จะ fail

## ติดตั้งบน Raspberry Pi

```bash
# สร้างรหัสผ่าน MQTT ครั้งแรก
docker run --rm -v "$PWD/mosquitto:/mosquitto/config" eclipse-mosquitto:2 \
  mosquitto_passwd -b -c /mosquitto/config/password.txt <MQTT_USERNAME> <MQTT_PASSWORD>

docker compose up -d --build
```

- หน้าเว็บ: `http://tempse.local:5174`
- API: `http://tempse.local:5001`
- MQTT: `tempse.local:1883`
- ค่าลับ (MQTT, LINE) อยู่ใน `.env` ข้าง `docker-compose.yml`

อัปเดตหลัง push โค้ดใหม่: `git pull && docker compose up -d --build`

## ส่งข้อมูลจาก sensor

Publish ไปที่ topic `Test sensor/<device_id>` เป็น JSON:

```json
{"temperature": 28.5, "humidity": 63, "pressure": 1001.2}
```

`pressure` ไม่บังคับ ถ้าไม่ส่ง `device_id` ระบบจะใช้ค่าจาก topic

```bash
mosquitto_pub -h tempse.local -u <user> -P <pass> \
  -t "Test sensor/001" -m '{"temperature":28.5,"humidity":63}'
```

## ค่าตั้งค่าหลัก (`docker-compose.yml` / `.env`)

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `SENSOR_RETENTION_DAYS` | 31 | ลบข้อมูลที่เก่ากว่านี้ (ตรวจทุกชั่วโมง) |
| `STORAGE_WARNING_PERCENT` | 85 | ดิสก์ถึงระดับนี้ เริ่มลบข้อมูลเก่าสุด |
| `STORAGE_CLEANUP_TARGET_PERCENT` | 80 | ลบจนดิสก์ลดเหลือระดับนี้ |
| `STORAGE_MIN_READINGS` | 100 | จำนวนข้อมูลล่าสุดที่ไม่ลบเสมอ |
| `DEVICE_OFFLINE_SECONDS` | 120 | ไม่มีข้อมูลนานเท่านี้ ถือว่า offline |
| `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET` | – | เปิดการแจ้งเตือนผ่าน LINE |
| `DATA_DIR` | volume `sensor_data` | ที่เก็บฐานข้อมูล เช่น `/mnt/se-iot-data` |

## API

ดูรายละเอียดและทดลองเรียกได้ที่ `/docs`

| Endpoint | ใช้ทำอะไร |
|---|---|
| `GET /api/health` | สถานะระบบ, MQTT, พื้นที่ดิสก์ |
| `GET /api/devices` | sensor ทั้งหมดพร้อมค่าล่าสุด |
| `PUT / DELETE /api/devices/{id}` | แก้ไข / ลบการตั้งค่า sensor |
| `GET /api/sensors?from=&to=&limit=` | ข้อมูลย้อนหลัง (สูงสุด 5000 ค่า) |
| `GET /api/alerts`, `GET /api/notifications` | ประวัติแจ้งเตือน / การส่ง LINE |
| `POST /api/line/webhook` | webhook ของ LINE |
