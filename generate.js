import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import path from "path";

const CSV_FILE = "schedule.csv";
const JSON_FILE = "schedule.json";
const UPLOAD_DIR = path.resolve("upload");

const videoExts = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv"]);

if (!existsSync(UPLOAD_DIR)) {
  console.error("upload folder not found");
  process.exit(1);
}

const videos = readdirSync(UPLOAD_DIR)
  .filter((f) => videoExts.has(path.extname(f).toLowerCase()))
  .sort();

if (videos.length === 0) {
  console.log("No video files found in upload/ folder");
  process.exit(0);
}

// ── Parse CLI args ───────────────────────────────────────────

const args = process.argv.slice(2);
console.error("DEBUG args:", JSON.stringify(args));
let startTime = null;
let intervalMs = null;
let defaultTitle = "";
let defaultDescription = "";
let useJson = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--start" && args[i + 1]) {
    startTime = new Date(args[++i]);
    if (isNaN(startTime.getTime())) {
      console.error("Invalid --start date. Use ISO 8601 format (e.g. 2026-07-25T14:00:00Z)");
      process.exit(1);
    }
  }
  if (args[i] === "--interval" && args[i + 1]) {
    const val = args[++i];
    const match = val.match(/^(\d+)(m|h|d)$/);
    if (!match) {
      console.error("Invalid --interval. Use format like 30m, 1h, 2d");
      process.exit(1);
    }
    const num = parseInt(match[1]);
    const unit = match[2];
    const multipliers = { m: 60000, h: 3600000, d: 86400000 };
    intervalMs = num * (multipliers[unit] || 0);
  }
  if (args[i] === "--title" && args[i + 1]) {
    defaultTitle = args[++i];
  }
  if (args[i] === "--description" && args[i + 1]) {
    defaultDescription = args[++i];
  }
  if (args[i] === "--json") {
    useJson = true;
  }
}

// ── Read existing CSV (all multi-line fields) ────────────────

function readAllCSV(filePath) {
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

function loadExisting() {
  const file = useJson ? JSON_FILE : CSV_FILE;
  if (!existsSync(file)) return {};

  if (useJson) {
    const arr = JSON.parse(readFileSync(file, "utf-8"));
    const map = {};
    for (const item of arr) {
      if (item.filename) map[item.filename] = item;
    }
    return map;
  }

  const lines = readAllCSV(file);
  if (lines.length < 2) return {};
  const headers = parseCSVLine(lines[0]).map((h) => h.trim());
  const idx = {
    filename: headers.indexOf("filename"),
    title: headers.indexOf("title"),
    description: headers.indexOf("description"),
    tags: headers.indexOf("tags"),
    shorts: headers.indexOf("shorts"),
    publish_at: headers.indexOf("publish_at"),
  };
  if (idx.filename === -1) return {};

  const map = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const fname = cols[idx.filename]?.trim();
    if (fname) {
      map[fname] = {
        title: idx.title !== -1 ? cols[idx.title]?.trim() || "" : "",
        description: idx.description !== -1 ? cols[idx.description]?.trim() || "" : "",
        tags: idx.tags !== -1 ? cols[idx.tags]?.trim() || "" : "",
        shorts: idx.shorts !== -1 ? cols[idx.shorts]?.trim() || "" : "",
        publish_at: idx.publish_at !== -1 ? cols[idx.publish_at]?.trim() || "" : "",
      };
    }
  }
  return map;
}

function esc(val) {
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ── Build entries ────────────────────────────────────────────

const existing = loadExisting();
const entries = [];
let nextTime = startTime ? new Date(startTime.getTime()) : null;

for (let i = 0; i < videos.length; i++) {
  const v = videos[i];
  const prev = existing[v] || { title: "", description: "", tags: "", shorts: "", publish_at: "" };
  let pub = prev.publish_at;

  if (startTime && intervalMs && (args.includes("--force") || !existing[v]?.publish_at?.trim())) {
    const oldPub = pub;
    pub = nextTime ? nextTime.toISOString() : "";
    nextTime = new Date(nextTime.getTime() + intervalMs);
    if (args.includes("--force") && oldPub && oldPub !== pub) {
      console.log(`  Force override: ${v} — ${oldPub} → ${pub}`);
    }
  }

  const rowTitle = prev.title || defaultTitle.replace(/\{n\}/g, String(i + 1)).replace(/\{name\}/g, path.parse(v).name);
  const rowDesc = prev.description || defaultDescription.replace(/\{n\}/g, String(i + 1)).replace(/\{name\}/g, path.parse(v).name);

  entries.push({ filename: v, title: rowTitle, description: rowDesc, tags: prev.tags || "", shorts: prev.shorts || "", publish_at: pub });
}

// ── Write output ─────────────────────────────────────────────

if (useJson) {
  writeFileSync(JSON_FILE, JSON.stringify(entries, null, 2), "utf-8");
  if (existsSync(CSV_FILE)) unlinkSync(CSV_FILE);
  console.log(`Generated ${JSON_FILE} with ${entries.length} file(s)`);
  console.log("ใช้ editor ใดก็ได้แก้ไข — description รองรับหลายบรรทัด");
} else {
  const csvRows = [["filename", "title", "description", "tags", "shorts", "publish_at"]];
  for (const e of entries) {
    csvRows.push([e.filename, e.title, e.description, e.tags, e.shorts, e.publish_at]);
  }
  const csvContent = csvRows.map((r) => r.map(esc).join(",")).join("\n");
  writeFileSync(CSV_FILE, csvContent, "utf-8");
  if (existsSync(JSON_FILE)) unlinkSync(JSON_FILE);
  console.log(`Generated ${CSV_FILE} with ${entries.length} file(s)`);
}

console.log("");
entries.forEach((e, i) => {
  const marker = e.publish_at ? ` @ ${e.publish_at}` : " (immediate)";
  const label = e.title ? `${e.title} (${e.filename})` : e.filename;
  const shorts = ["true", "yes", "1"].includes(String(e.shorts || "").toLowerCase().trim()) ? " [Short]" : "";
  console.log(`  ${i + 1}. ${label}${shorts}${marker}`);
});

if (startTime && intervalMs && entries.length > 1) {
  console.log(`\nSchedule range: ${entries[0].publish_at || "?"} → ${entries[entries.length - 1].publish_at || "?"}`);
}

console.log("\nOptions:");
console.log("  --json                   Output as schedule.json (รองรับ description หลายบรรทัด)");
console.log("  --start <ISO_DATE>       First publish time");
console.log("  --interval <DURATION>    Interval (30m, 1h, 2d)");
console.log("  --title <TITLE>          Default title ({n} = number, {name} = filename)");
console.log("  --description <TEXT>     Default description");
console.log("  --force                  Overwrite publish_at even if already set");
