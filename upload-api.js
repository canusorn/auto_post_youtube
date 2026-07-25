import { google } from "googleapis";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, createReadStream } from "fs";
import path from "path";
import { createInterface } from "readline";
import { fileURLToPath } from "url";

const SCOPES = ["https://www.googleapis.com/auth/youtube.upload"];
const TOKEN_PATH = "token.json";
const CREDENTIALS_PATH = "client_secret.json";
const UPLOAD_DIR = path.resolve("upload");
const CSV_FILE = "schedule.csv";

const videoExts = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv"]);

// ── OAuth 2.0 ──────────────────────────────────────────────

async function getOAuthClient() {
  if (!existsSync(CREDENTIALS_PATH)) {
    console.log(`
ไม่พบไฟล์ client_secret.json

วิธีสร้าง:
1. ไปที่ https://console.cloud.google.com/
2. สร้าง Project ใหม่ → เลือกชื่อ
3. ไปที่ APIs & Services → Library → ค้นหา "YouTube Data API v3" → Enable
4. ไปที่ APIs & Services → Credentials → Create Credentials → OAuth client ID
5. Application type: Desktop app → สร้าง
6. ดาวน์โหลด JSON → บันทึกเป็น client_secret.json ในโฟลเดอร์นี้
`);
    process.exit(1);
  }

  const creds = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf-8"));
  const { client_secret, client_id, redirect_uris } =
    creds.installed || creds.web || {};

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris?.[0] || "http://localhost"
  );

  // Check if we have a saved token
  if (existsSync(TOKEN_PATH)) {
    const token = JSON.parse(readFileSync(TOKEN_PATH, "utf-8"));
    oAuth2Client.setCredentials(token);
  }

  // Refresh or get new token
  try {
    const { token } = await oAuth2Client.getAccessToken();
  } catch {
    await getNewToken(oAuth2Client);
  }

  return oAuth2Client;
}

async function getNewToken(oAuth2Client) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });

  console.log("\n=====================");
  console.log("เปิดลิงก์นี้ใน Chrome เพื่อให้สิทธิ์:");
  console.log(authUrl);
  console.log("=====================\n");
  console.log("หลังจากให้สิทธิ์แล้ว จะได้รหัส authorization code");
  console.log("ให้คัดลอกมา paste ที่นี่:\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const code = await new Promise((resolve) => rl.question("Enter code: ", resolve));
  rl.close();

  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log("Token saved to", TOKEN_PATH);
}

// ── CSV helpers ──────────────────────────────────────────────

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function readSchedule() {
  if (!existsSync(CSV_FILE)) return null;
  const lines = readFileSync(CSV_FILE, "utf-8").trim().split("\n");
  if (lines.length < 2) return null;
  const headers = lines[0].split(",").map((h) => h.trim());
  const idx = {
    filename: headers.indexOf("filename"),
    title: headers.indexOf("title"),
    description: headers.indexOf("description"),
    tags: headers.indexOf("tags"),
    publish_at: headers.indexOf("publish_at"),
  };
  if (idx.filename === -1) return null;

  const entries = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const fname = cols[idx.filename]?.trim();
    if (!fname) continue;
    entries.push({
      filename: fname,
      title: idx.title !== -1 ? cols[idx.title]?.trim() || "" : "",
      description: idx.description !== -1 ? cols[idx.description]?.trim() || "" : "",
      tags: idx.tags !== -1 ? cols[idx.tags]?.trim() || "" : "",
      publish_at: idx.publish_at !== -1 ? cols[idx.publish_at]?.trim() || "" : "",
    });
  }
  return entries;
}

// ── Resolve files ────────────────────────────────────────────

function getFiles() {
  if (!existsSync(UPLOAD_DIR)) {
    console.error("upload folder not found");
    process.exit(1);
  }

  let entries = readSchedule();
  if (entries) {
    const files = entries.filter((e) => existsSync(path.join(UPLOAD_DIR, e.filename)));
    const missing = entries.filter((e) => !existsSync(path.join(UPLOAD_DIR, e.filename)));
    for (const m of missing) console.warn("Warning: not found:", m.filename);
    return files;
  }

  const videos = readdirSync(UPLOAD_DIR)
    .filter((f) => videoExts.has(path.extname(f).toLowerCase())).sort();
  return videos.map((f) => ({
    filename: f,
    title: "",
    description: "",
    tags: "",
    publish_at: "",
  }));
}

// ── Upload ─────────────────────────────────────────────────

async function uploadVideo(auth, entry) {
  const videoPath = path.join(UPLOAD_DIR, entry.filename);
  const fileSize = existsSync(videoPath) ? readFileSync(videoPath).length : 0;

  const title = entry.title || path.parse(entry.filename).name;
  const tags = entry.tags
    ? entry.tags.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  const snippet = { title, description: entry.description || "", tags };
  const status = { privacyStatus: "public" };

  // Set publishAt for scheduling
  if (entry.publish_at) {
    const d = new Date(entry.publish_at);
    if (!isNaN(d.getTime())) {
      status.publishAt = d.toISOString();
      status.privacyStatus = "private"; // must be private when scheduling
    }
  }

  console.log(`\nUploading: ${entry.filename}`);
  console.log(`  Title: ${title}`);
  console.log(`  Size: ${(fileSize / 1024 / 1024).toFixed(1)} MB`);
  if (status.publishAt) console.log(`  Schedule: ${status.publishAt}`);

  const youtube = google.youtube({ version: "v3", auth });

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    notifySubscribers: false,
    requestBody: { snippet, status },
    media: { body: createReadStream(videoPath) },
  });

  const videoId = res.data.id;
  console.log(`✓ Uploaded: https://youtu.be/${videoId}`);
  return videoId;
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  const files = getFiles();
  if (files.length === 0) {
    console.log("No video files to upload");
    process.exit(0);
  }

  console.log(`\nFound ${files.length} file(s) to upload:\n`);
  files.forEach((f, i) => {
    const sched = f.publish_at ? ` @ ${f.publish_at}` : " (public)";
    console.log(`  ${i + 1}. ${f.filename}${sched}`);
  });

  console.log("\n Authenticating...");
  const auth = await getOAuthClient();

  for (const entry of files) {
    await uploadVideo(auth, entry);
  }

  console.log("\nAll uploads complete!");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
