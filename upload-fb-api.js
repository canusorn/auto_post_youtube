import "dotenv/config";
import { existsSync, readdirSync, readFileSync, createReadStream } from "fs";
import path from "path";
import FormData from "form-data";

const JSON_FILE = "schedule.json";
const CSV_FILE = "schedule.csv";
const UPLOAD_DIR = path.resolve("upload");

const FACEBOOK_API_VERSION = "v22.0";
let PAGE_ID = process.env.FACEBOOK_PAGE_ID;
let ACCESS_TOKEN = process.env.FACEBOOK_ACCESS_TOKEN || process.env.FACEBOOK_USER_TOKEN;

if (!PAGE_ID && !ACCESS_TOKEN) {
  console.error("ใส่ FACEBOOK_USER_TOKEN ใน .env (ใช้ User Token จาก Access Token Tool)");
  console.error("หรือใส่ FACEBOOK_PAGE_ID + FACEBOOK_ACCESS_TOKEN");
  process.exit(1);
}

const videoExts = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv"]);

// ── Read schedule ─────────────────────────────────────────────

function readCSVLines(filePath) {
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, "utf-8");
  const lines = [];
  let current = "";
  let inQuotes = false;
  for (const ch of raw) {
    if (ch === '"') { inQuotes = !inQuotes; current += ch; }
    else if (ch === "\n" && !inQuotes) { lines.push(current); current = ""; }
    else { current += ch; }
  }
  if (current.trim()) lines.push(current);
  return lines;
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === "," && !inQuotes) { result.push(current); current = ""; }
    else { current += ch; }
  }
  result.push(current);
  return result;
}

function readSchedule() {
  if (existsSync(JSON_FILE)) return JSON.parse(readFileSync(JSON_FILE, "utf-8"));
  if (!existsSync(CSV_FILE)) return null;
  const lines = readCSVLines(CSV_FILE);
  if (lines.length < 2) return null;
  const headers = parseCSVLine(lines[0]).map((h) => h.trim());
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
      description: idx.description !== -1 ? (cols[idx.description]?.trim() || "").replace(/\\n/g, "\n") : "",
      publish_at: idx.publish_at !== -1 ? cols[idx.publish_at]?.trim() || "" : "",
    });
  }
  return entries;
}

// ── Resolve files ────────────────────────────────────────────

if (!existsSync(UPLOAD_DIR)) { console.error("upload folder not found"); process.exit(1); }

let entries = readSchedule();
if (!entries) {
  const files = readdirSync(UPLOAD_DIR).filter((f) => videoExts.has(path.extname(f).toLowerCase())).sort();
  entries = files.map((f) => ({ filename: f, title: "", description: "", publish_at: "" }));
}

entries = entries.filter((e) => existsSync(path.join(UPLOAD_DIR, e.filename)));
if (entries.length === 0) { console.log("No video files to upload"); process.exit(0); }

console.log(`\nUpload queue (${entries.length} file(s)):`);
entries.forEach((e, i) => {
  const sched = e.publish_at ? ` @ ${e.publish_at}` : " (immediate)";
  console.log(`  ${i + 1}. ${e.filename}${sched}`);
});

// ── Resolve Page Token from User Token ──────────────────────

async function resolveToken() {
  // Always verify by fetching page list
  const userToken = process.env.FACEBOOK_USER_TOKEN || process.env.FACEBOOK_ACCESS_TOKEN;
  if (!userToken) {
    console.error("Need FACEBOOK_USER_TOKEN or FACEBOOK_ACCESS_TOKEN in .env");
    process.exit(1);
  }
  console.log("Fetching your pages...");
  const url = `https://graph.facebook.com/${FACEBOOK_API_VERSION}/me/accounts?access_token=${userToken}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.data || data.data.length === 0) {
    console.error("No pages found. Response:", JSON.stringify(data));
    console.error("Tip: Token must have pages_show_list + pages_manage_posts permissions");
    process.exit(1);
  }
  console.log("Your pages:");
  data.data.forEach((p, i) => console.log(`  ${i + 1}. ${p.name} (ID: ${p.id})`));

  if (PAGE_ID) {
    const page = data.data.find((p) => p.id === PAGE_ID);
    if (page) {
      ACCESS_TOKEN = page.access_token;
      console.log(`Using page: ${page.name}`);
    } else {
      console.error(`Page ID ${PAGE_ID} not found. Pick one from the list above.`);
      process.exit(1);
    }
  } else {
    const page = data.data[0];
    PAGE_ID = page.id;
    ACCESS_TOKEN = page.access_token;
    console.log(`Using page: ${page.name}`);
  }
}

// ── Upload via Graph API ──────────────────────────────────────

async function uploadVideo(entry) {
  const videoPath = path.join(UPLOAD_DIR, entry.filename);
  const fileSize = existsSync(videoPath) ? readFileSync(videoPath).length : 0;
  const caption = entry.description || "";
  const baseUrl = `https://graph.facebook.com/${FACEBOOK_API_VERSION}/${PAGE_ID}/videos`;

  console.log(`\nUploading: ${entry.filename}`);
  console.log(`  Size: ${(fileSize / 1024 / 1024).toFixed(1)} MB`);

  // ── Step 1: Start upload session ──
  const startUrl = `${baseUrl}?access_token=${ACCESS_TOKEN}&upload_phase=start&file_size=${fileSize}`;
  const startRes = await fetch(startUrl, { method: "POST" });
  const startData = await startRes.json();
  if (!startData.upload_session_id) {
    console.error(`  ✗ Failed to start upload session: ${JSON.stringify(startData)}`);
    return;
  }
  console.log(`  Session: ${startData.upload_session_id}`);

  // ── Step 2: Transfer (upload file) ──
  const transferUrl = `${baseUrl}?access_token=${ACCESS_TOKEN}&upload_phase=transfer&upload_session_id=${startData.upload_session_id}&start_offset=${startData.start_offset || 0}`;
  const fileStream = createReadStream(videoPath);
  const transferRes = await fetch(transferUrl, { method: "POST", body: fileStream, headers: { "Content-Type": "video/mp4" } });
  const transferData = await transferRes.json();
  if (!transferData.upload_session_id) {
    console.error(`  ✗ Failed to transfer: ${JSON.stringify(transferData)}`);
    return;
  }
  console.log(`  Transferred: ${transferData.start_offset} / ${fileSize} bytes`);

  // ── Step 3: Finish (set metadata + publish) ──
  const finishBody = new FormData();
  finishBody.append("description", caption);
  if (entry.publish_at) {
    const ts = Math.floor(new Date(entry.publish_at).getTime() / 1000);
    if (!isNaN(ts)) {
      finishBody.append("published", "false");
      finishBody.append("scheduled_publish_time", String(ts));
      console.log(`  Schedule: ${entry.publish_at}`);
    }
  }
  const finishUrl = `${baseUrl}?access_token=${ACCESS_TOKEN}&upload_phase=finish&upload_session_id=${startData.upload_session_id}`;
  const finishRes = await fetch(finishUrl, { method: "POST", body: finishBody, headers: finishBody.getHeaders() });
  const finishData = await finishRes.json();
  if (finishData.id) {
    console.log(`  ✓ Uploaded! Video ID: ${finishData.id}`);
    if (finishData.scheduled_publish_time) {
      console.log(`  ✓ Scheduled for: ${new Date(finishData.scheduled_publish_time * 1000).toISOString()}`);
    }
  } else {
    console.error(`  ✗ Failed to finish: ${JSON.stringify(finishData)}`);
  }
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  await resolveToken();
  for (const entry of entries) {
    await uploadVideo(entry);
  }
  console.log("\nAll uploads complete!");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
