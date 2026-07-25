# Auto Post YouTube

อัปโหลดวิดีโอไปยัง YouTube และตั้งเวลาเผยแพร่โดยใช้ Playwright + Chrome

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

คัดลอก `.env.example` ไปเป็น `.env` แล้วกรอกอีเมล:

```env
YT_EMAIL=your-google-email@gmail.com
VIDEO_TAGS=tag1,tag2,tag3
```

### 4. อัปโหลด

```bash
npm run upload
```

**ครั้งแรก**: Chrome จะเปิดขึ้นมา — ให้คุณล็อกอิน YouTube เองในหน้าต่างนั้น แล้วกลับมากด Enter ที่ Terminal

**ครั้งถัดไป**: Session จะถูกบันทึกไว้ใน `chrome-profile/` ไม่ต้องล็อกอินซ้ำ

สคริปต์จะอ่าน `schedule.csv` (ถ้ามี) แล้วอัปโหลดวิดีโอทีละไฟล์ตามกำหนดการที่ตั้งไว้

## หมายเหตุ

- ไม่ต้องใส่รหัสผ่านใน `.env` — ล็อกอินเองใน Chrome จริง ๆ (Google ไม่บล็อก Chrome)
- Session ถูกบันทึกไว้ใน `chrome-profile/` (ลบทิ้งเมื่อต้องการล็อกอินใหม่)
- YouTube Studio อาจเปลี่ยน UI ทำให้ selector ใช้ไม่ได้ — ตรวจสอบ `upload.js` ถ้าเกิดข้อผิดพลาด
