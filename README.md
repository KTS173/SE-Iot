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
