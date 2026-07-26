import "dotenv/config";
import { existsSync, readdirSync, readFileSync } from "fs";
import path from "path";

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
    file_url: headers.indexOf("file_url"),
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
      file_url: idx.file_url !== -1 ? cols[idx.file_url]?.trim() || "" : "",
    });
  }
  return entries;
}

// ── Resolve files ────────────────────────────────────────────

if (!existsSync(UPLOAD_DIR)) { console.error("upload folder not found"); process.exit(1); }

let entries = readSchedule();
if (!entries) {
  const files = readdirSync(UPLOAD_DIR).filter((f) => videoExts.has(path.extname(f).toLowerCase())).sort();
  entries = files.map((f) => ({ filename: f, title: "", description: "", publish_at: "", file_url: "" }));
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

  console.log(`\nUploading: ${entry.filename}`);
  console.log(`  Size: ${(fileSize / 1024 / 1024).toFixed(1)} MB`);

  // Use file_url approach — requires video hosted at public URL
  // Set FILE_HOST_URL in .env to enable auto-hosting via simple server
  let fileUrl = entry.file_url;
  if (!fileUrl && process.env.FILE_HOST_URL) {
    fileUrl = process.env.FILE_HOST_URL + "/" + encodeURIComponent(entry.filename);
  }
  if (!fileUrl) {
    console.error("  ✗ Need file_url. Set FILE_HOST_URL in .env or add file_url column to CSV.");
    console.error("  Tip: Host files via ngrok: npx http-server upload -p 3000 --cors");
    console.error("       Then set: FILE_HOST_URL=https://your-ngrok-url");
    return;
  }

  const endpoint = `https://graph.facebook.com/${FACEBOOK_API_VERSION}/${PAGE_ID}/videos?access_token=${ACCESS_TOKEN}`;
  const body = new URLSearchParams();
  body.append("file_url", fileUrl);
  body.append("description", caption);
  if (entry.publish_at) {
    const ts = Math.floor(new Date(entry.publish_at).getTime() / 1000);
    if (!isNaN(ts)) {
      body.append("published", "false");
      body.append("scheduled_publish_time", String(ts));
      console.log(`  Schedule: ${entry.publish_at}`);
    }
  }

  const res = await fetch(endpoint, { method: "POST", body });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
  if (data.id) {
    console.log(`  ✓ Posted! Video ID: ${data.id}`);
    if (data.scheduled_publish_time)
      console.log(`  ✓ Scheduled for: ${new Date(data.scheduled_publish_time * 1000).toISOString()}`);
  } else {
    console.error(`  ✗ Failed: ${JSON.stringify(data)}`);
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
