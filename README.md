# SE-IoT

หน้าเว็บ IoT แบบง่าย ประกอบด้วย React + Vite, Flask REST API และ MQTT subscriber
สำหรับรับค่าอุณหภูมิ/ความชื้นจาก sensor

## เริ่มใช้งาน

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

API จะเปิดที่ `http://localhost:5000`

### Frontend

```bash
cd frontend
npm install
npm run dev
```

หน้าเว็บจะเปิดที่ `http://localhost:5173` และดึงข้อมูลใหม่ทุก 5 วินาที

## รูปแบบ MQTT

ค่าเริ่มต้น subscribe topic `sensors/+/data` โดย payload เป็น JSON:

```json
{
  "device_id": "sensor-01",
  "temperature": 28.5,
  "humidity": 63
}
```

ตัวอย่าง publish ด้วย Mosquitto:

```bash
mosquitto_pub -h localhost -t sensors/sensor-01/data \
  -m '{"temperature":28.5,"humidity":63}'
```

หากยังไม่มี MQTT broker ทดสอบผ่าน REST API ได้:

```bash
curl -X POST http://localhost:5000/api/sensors \
  -H "Content-Type: application/json" \
  -d '{"device_id":"demo-01","temperature":28.5,"humidity":63}'
```

เตรียมไฟล์ `.env` ไว้ให้แล้วทั้ง `backend/.env` และ `frontend/.env`
สามารถใส่ค่าการเชื่อมต่อจริงได้ทันที โดยมี `.env.example` เป็นแม่แบบสำหรับนำไปใช้งานในเครื่องอื่น

## ติดตั้งบน Raspberry Pi

ชุด Docker Compose ใช้ Mosquitto ในเครื่องเป็น broker โดย Backend เชื่อมต่อผ่าน
ชื่อ service `broker` และเปิดพอร์ต MQTT `1883` ให้ sensor ใน LAN เชื่อมต่อได้

ตั้ง hostname ของ Pi และเปิดระบบ:

```bash
sudo hostnamectl set-hostname tempse
sudo reboot
# SSH กลับเข้ามาแล้วรันในโฟลเดอร์โปรเจกต์
docker run --rm -v "$PWD/mosquitto:/mosquitto/config" eclipse-mosquitto:2 \
  mosquitto_passwd -b -c /mosquitto/config/password.txt <MQTT_USERNAME> <MQTT_PASSWORD>
docker compose up -d --build
```

หน้าเว็บเปิดที่ `http://tempse.local:5174` และ sensor ตั้ง MQTT ดังนี้:

```cpp
const char* mqtt_server = "tempse.local";
const int mqtt_port = 1883;
```

Broker บังคับใช้ username/password โดย Backend subscribe topic `Test sensor/+`
เช่น device `001` publish ไปที่ `Test sensor/001`

ข้อมูล sensor ถูกเก็บถาวรใน SQLite ผ่าน Docker volume `sensor_data` จึงไม่หาย
เมื่อ restart หรือ rebuild container โดย API ขอข้อมูลย้อนหลังได้สูงสุด 1,000 ค่า
ต่อครั้ง เช่น `/api/sensors?limit=1000`

ระบบตรวจพื้นที่เก็บข้อมูลทุกครั้งที่บันทึกและทุก 30 วินาทีจากหน้า Dashboard
โดยแสดงแถบแจ้งเตือนเมื่อใช้พื้นที่ตั้งแต่ 85% ขึ้นไป ปรับเกณฑ์ได้ด้วย
`STORAGE_WARNING_PERCENT` ใน `docker-compose.yml`

เมื่อพื้นที่ถึง 85% Backend จะลบข้อมูล sensor ที่เก่าที่สุดเป็นชุดจนพื้นที่ลดลง
ถึงเป้าหมาย 80% โดยป้องกันข้อมูลล่าสุด 100 รายการไว้ ค่าทั้งหมดนี้ปรับได้ด้วย
`STORAGE_CLEANUP_TARGET_PERCENT`, `STORAGE_CLEANUP_BATCH_SIZE` และ
`STORAGE_MIN_READINGS`

ข้อมูล sensor ใช้นโยบายเก็บย้อนหลัง 31 วันแบบ rolling retention โดย Backend
ตรวจทุกชั่วโมงและลบข้อมูลที่เก่ากว่า 31 วันอัตโนมัติ ปรับได้ด้วย
`SENSOR_RETENTION_DAYS`
