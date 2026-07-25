# Auto Post YouTube

อัปโหลดวิดีโอไปยัง YouTube และตั้งเวลาเผยแพร่

มี 2 วิธี:
- **API** (แนะนำ) — ใช้ YouTube Data API โดยตรง ไม่ต้องเปิด browser
- **Playwright** — ใช้ browser automation (กันไว้ถ้า API มีข้อจำกัด)

---

## วิธีที่ 1: YouTube Data API (แนะนำ)

### ติดตั้ง

```bash
npm install
```

### ตั้งค่า Google Cloud

1. ไปที่ https://console.cloud.google.com/
2. สร้าง Project ใหม่
3. ไปที่ **APIs & Services → Library** → ค้นหา "YouTube Data API v3" → **Enable**
4. ไปที่ **APIs & Services → OAuth consent screen**
   - User Type: **External**
   - กรอก App name, User support email, Developer contact
   - กด Save
   - แท็บ **Test users** → **Add Users** → ใส่อีเมล YouTube ของคุณ
5. ไปที่ **APIs & Services → Credentials** → **Create Credentials → OAuth client ID**
   - Application type: **Desktop app** → สร้าง
   - ดาวน์โหลด JSON → บันทึกเป็น `client_secret.json`

### เตรียมวิดีโอ

ใส่ไฟล์วิดีโอลงในโฟลเดอร์ `upload/`

### สร้างตารางกำหนดการ

```bash
# สร้าง schedule.csv (แก้ใน Excel ได้)
npm run generate

# หรือใช้ --json สำหรับ description หลายบรรทัด
npm run generate -- --json

# กำหนดเวลาเริ่มต้น + ระยะห่าง
npm run generate -- --start 2026-07-25T14:00:00Z --interval 1h

# ใส่ title และ description
npm run generate -- --title "Video #{n}" --interval 1d --json
```

เปิด `schedule.json` (หรือ `schedule.csv`) เพื่อแก้ไข:
- **title** — ชื่อวิดีโอ
- **description** — คำอธิบาย (ใช้ \n หรือขึ้นบรรทัดใหม่ใน JSON ได้)
- **tags** — แท็ก
- **publish_at** — วัน/เวลาเผยแพร่ (ISO 8601) ถ้าว่างจะอัปโหลดเป็นสาธารณะทันที

### อัปโหลด

```bash
npm run upload-api
```

**ครั้งแรก**: Browser จะเปิดให้ล็อกอิน Google และให้สิทธิ์ — ทำครั้งเดียว
**ครั้งต่อ ๆ ไป**: ใช้ Token ที่บันทึกไว้ ไม่ต้องล็อกอินซ้ำ

---

## วิธีที่ 2: Playwright + Browser

ใช้ได้ถ้า API มีข้อจำกัด แต่ Google อาจ detect automation:

```bash
npm run upload
```

### หมายเหตุ

- `token.json` — Token การเข้าใช้งาน API (อย่าแชร์)
- `client_secret.json` — Client ID จาก Google Cloud (อย่าแชร์)
- ถ้าต้องการล็อกอินใหม่ ลบ `token.json` ทิ้งแล้วรันใหม่
