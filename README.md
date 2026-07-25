# Auto Post YouTube

อัปโหลดวิดีโอไปยัง YouTube และตั้งเวลาเผยแพร่โดยใช้ Playwright + Firefox

## ติดตั้ง

```bash
npm install
```

## วิธีใช้

### 1. เตรียมวิดีโอ

ใส่ไฟล์วิดีโอ (`.mp4`, `.mov`, `.avi`, `.mkv`, `.webm` ฯลฯ) ลงในโฟลเดอร์ `upload/`

### 2. สร้างตารางกำหนดการ

```bash
# สร้าง schedule.csv พร้อมรายชื่อไฟล์ (แก้ไขกำหนดการเองทีละไฟล์ได้)
npm run generate

# กำหนดเวลาเริ่มต้น + ระยะห่าง
npm run generate -- --start 2026-07-25T14:00:00Z --interval 1h

# ใส่ title และ description ตั้งต้น (ใช้ {n} = หมายเลข, {name} = ชื่อไฟล์)
npm run generate -- --title "Video #{n}" --description "Check out {name}" --start 2026-07-25T14:00:00Z --interval 1d
```

เปิด `schedule.csv` ที่สร้างขึ้นมาเพื่อแก้ไข:
- **title** — ชื่อวิดีโอ (ถ้าว่างจะใช้ชื่อไฟล์)
- **description** — คำอธิบายวิดีโอ
- **tags** — แท็ก คั่นด้วยคอมม่า
- **publish_at** — วัน/เวลาเผยแพร่ (ISO 8601) ถ้าว่างจะอัปโหลดแบบสาธารณะทันที

รูปแบบ interval: `30m` (30 นาที), `1h` (1 ชั่วโมง), `2d` (2 วัน)

### 3. ตั้งค่า .env

คัดลอก `.env.example` ไปเป็น `.env` แล้วกรอกข้อมูล:

```env
YT_EMAIL=your-google-email@gmail.com
# เว้นว่างไว้เพื่อล็อกอินเอง (กรณีมี 2FA)
YT_PASSWORD=your-google-password
VIDEO_TAGS=tag1,tag2,tag3
```

### 4. อัปโหลด

```bash
npm run upload
```

สคริปต์จะอ่าน `schedule.csv` (ถ้ามี) แล้วอัปโหลดวิดีโอทีละไฟล์ตามกำหนดการที่ตั้งไว้

## หมายเหตุ

- ถ้าไม่ใส่ `YT_PASSWORD` ใน `.env` บราวเซอร์จะเปิดมาให้ล็อกอินเอง — เหมาะกับบัญชีที่มี 2FA
- YouTube Studio อาจเปลี่ยน UI ทำให้ selector ใช้ไม่ได้ — ตรวจสอบ `upload.js` ถ้าเกิดข้อผิดพลาด
- ควรให้ `headless: false` เพื่อดูขั้นตอนการทำงาน
