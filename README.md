# Auto Post Videos

อัปโหลดวิดีโอไปยัง YouTube และ Facebook Reels พร้อมตั้งเวลาเผยแพร่

## คำสั่งทั้งหมด

| คำสั่ง | คำอธิบาย |
|---|---|
| `node generate.js` | สร้าง schedule.csv สำหรับกำหนดการอัปโหลด |
| `node generate.js --json` | สร้าง schedule.json (description หลายบรรทัดได้) |
| `npm run upload-api` | อัปโหลดไป YouTube ผ่าน API (แนะนำ) |
| `npm run upload` | อัปโหลดไป YouTube ผ่าน Playwright (browser) |
| `npm run upload-fb` | อัปโหลด Reels ไป Facebook ผ่าน Playwright |
| `npm run upload-fb -- --firefox` | ใช้ Firefox แทน Chrome |

---

## 1. เตรียมวิดีโอ

ใส่ไฟล์วิดีโอ (`.mp4`, `.mov`, `.avi`, `.mkv`, `.webm` ฯลฯ) ลงในโฟลเดอร์ `upload/`

## 2. สร้างตารางกำหนดการ

```bash
node generate.js --start 2026-07-24T12:00:00Z --interval 24h --json
```

เปิด `schedule.json` (หรือ `schedule.csv`) เพื่อแก้ไข:

| column | คำอธิบาย |
|---|---|
| `filename` | ชื่อไฟล์วิดีโอ |
| `title` | ชื่อวิดีโอ (ถ้าว่างจะใช้ชื่อไฟล์) |
| `description` | คำอธิบาย (ใช้ `\n` สำหรับขึ้นบรรทัดใหม่) |
| `tags` | แท็ก คั่นด้วยคอมม่า |
| `shorts` | `yes` = เพิ่ม #Shorts ใน description |
| `publish_at` | ISO 8601 เวลาเผยแพร่ ถ้าว่าง = โพสต์ทันที |

รูปแบบ interval: `30m`, `1h`, `2d`, `24h`

**หมายเหตุ:** ให้ใช้ `node generate.js` แทน `npm run generate --` เพราะ `--` ใช้ไม่ได้ใน PowerShell

```bash
# สร้าง schedule.csv พร้อมตั้งเวลา (เริ่มวันที่ 24 ก.ค. ห่างกัน 24h)
node generate.js --start 2026-07-24T12:00:00Z --interval 24h

# เขียนทับ publish_at ที่มีอยู่แล้ว
node generate.js --start 2026-07-24T12:00:00Z --interval 24h --force

# สร้างแบบ JSON
node generate.js --start 2026-07-24T12:00:00Z --interval 24h --json

# กรอก title/description อัตโนมัติ ({n}=ลำดับ, {name}=ชื่อไฟล์)
node generate.js --title "คลิปที่ {n}" --description "วิดีโอ {name} ดูเพลิน"
```

---

## 3. อัปโหลด

### YouTube ผ่าน API (แนะนำ)

```bash
npm run upload-api
```

- ต้องตั้งค่า Google Cloud (OAuth consent screen + client_secret.json)
- ครั้งแรกให้สิทธิ์ผ่าน browser ครั้งเดียว
- รองรับการตั้งเวลาเผยแพร่

### YouTube ผ่าน Playwright

```bash
npm run upload
# หรือใช้ Firefox (ใช้ node โดยตรง เพราะ `--` ใช้ไม่ได้ใน PowerShell)
node upload.js --firefox
```

- ใช้ browser automation (Google อาจ detect)
- Chrome จะเปิดให้ล็อกอินเอง แล้วกด Enter
- session ถูกบันทึกไว้ ไม่ต้องล็อกอินซ้ำ

### Facebook Reels

```bash
npm run upload-fb
# หรือใช้ Firefox (ใช้ node โดยตรง เพราะ `--` ใช้ไม่ได้ใน PowerShell)
node upload-fb.js --firefox
```

- ใช้ browser automation
- ครั้งแรก: ล็อกอิน Facebook เอง แล้วกด Enter
- session ถูกบันทึกไว้
- Facebook Reels รองรับการตั้งเวลาผ่านเว็บ (ใช้ publish_at ใน schedule)
- **ถ้าหน้าเว็บรีเฟรชไม่หยุด**: ให้ลบ `chrome-profile/` หรือ `firefox-profile/` แล้วรันใหม่

---

## หมายเหตุ

- `chrome-profile/` หรือ `firefox-profile/` — session browser (ลบทิ้งเมื่อต้องการล็อกอินใหม่)
- `token.json` — Token YouTube API (อย่าแชร์)
- `client_secret.json` — Client ID จาก Google Cloud (อย่าแชร์)
