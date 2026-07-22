# Auto Post YouTube

อัปโหลดวิดีโอไปยัง YouTube และตั้งเวลาเผยแพร่โดยใช้ Playwright + Firefox

## ติดตั้ง

```bash
npm install
```

## วิธีใช้

1. ใส่ไฟล์วิดีโอ (`.mp4`, `.mov`, `.avi`, `.mkv`, `.webm` ฯลฯ) ลงในโฟลเดอร์ `upload/`
2. คัดลอก `.env.example` ไปเป็น `.env` แล้วกรอกข้อมูล:

```env
YT_EMAIL=your-google-email@gmail.com
YT_PASSWORD=your-google-password
VIDEO_TITLE=My Video Title
VIDEO_DESCRIPTION=Video description here
VIDEO_TAGS=tag1,tag2,tag3
PUBLISH_AT=2026-07-25T14:00:00Z
```

| ตัวแปร | คำอธิบาย |
|---|---|
| `YT_EMAIL` | อีเมลบัญชี Google ของคุณ |
| `YT_PASSWORD` | รหัสผ่านบัญชี Google ของคุณ |
| `VIDEO_TITLE` | ชื่อวิดีโอ (ถ้าไม่ใส่จะใช้ชื่อไฟล์) |
| `VIDEO_DESCRIPTION` | คำอธิบายวิดีโอ |
| `VIDEO_TAGS` | แท็ก คั่นด้วยเครื่องหมายจุลภาค |
| `PUBLISH_AT` | วันที่ในรูปแบบ ISO 8601 เพื่อตั้งเวลาเผยแพร่ เว้นว่างไว้เพื่อเผยแพร่ทันที |

3. รัน:

```bash
npm run upload
```

สคริปต์จะอ่านไฟล์วิดีโอทั้งหมดใน `upload/` และอัปโหลดทีละไฟล์ พร้อมตั้งค่าการมองเห็นเป็น **สาธารณะ** หรือ **กำหนดเวลา** ตามค่า `PUBLISH_AT`

## หมายเหตุ

- ครั้งแรกต้องเข้าสู่ระบบด้วยตัวเอง (2FA, ยืนยันเบอร์โทร ฯลฯ)
- YouTube Studio อาจเปลี่ยน UI ทำให้ selector ใช้ไม่ได้ — ตรวจสอบ `upload.js` ถ้าเกิดข้อผิดพลาด
- ควรให้ `headless: false` เพื่อดูขั้นตอนการทำงาน
