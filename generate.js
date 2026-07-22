import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

const CSV_FILE = "schedule.csv";
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

// Parse CLI args
const args = process.argv.slice(2);
let startTime = null;
let intervalMs = null;

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
}

// Parse existing CSV to preserve user edits
function parseCSV(filePath) {
  if (!existsSync(filePath)) return {};
  const lines = readFileSync(filePath, "utf-8").trim().split("\n");
  if (lines.length < 2) return {};
  const headers = lines[0].split(",").map((h) => h.trim());
  const filenameIdx = headers.indexOf("filename");
  const titleIdx = headers.indexOf("title");
  const descIdx = headers.indexOf("description");
  const tagsIdx = headers.indexOf("tags");
  const pubIdx = headers.indexOf("publish_at");
  if (filenameIdx === -1) return {};

  const map = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const fname = cols[filenameIdx]?.trim();
    if (fname) {
      map[fname] = {
        title: titleIdx !== -1 ? cols[titleIdx]?.trim() || "" : "",
        description: descIdx !== -1 ? cols[descIdx]?.trim() || "" : "",
        tags: tagsIdx !== -1 ? cols[tagsIdx]?.trim() || "" : "",
        publish_at: pubIdx !== -1 ? cols[pubIdx]?.trim() || "" : "",
      };
    }
  }
  return map;
}

// Simple CSV line parser (handles quoted fields)
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

// Escape CSV field
function esc(val) {
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const existing = parseCSV(CSV_FILE);

// Build rows
const rows = [["filename", "title", "description", "tags", "publish_at"]];
let nextTime = startTime ? new Date(startTime.getTime()) : null;

for (let i = 0; i < videos.length; i++) {
  const v = videos[i];
  const prev = existing[v] || { title: "", description: "", tags: "", publish_at: "" };
  let pub = prev.publish_at;

  // Auto-fill if --start and --interval given, and no user-set value
  if (startTime && intervalMs && !existing[v]?.publish_at?.trim()) {
    pub = nextTime ? nextTime.toISOString() : "";
    nextTime = new Date(nextTime.getTime() + intervalMs);
  }

  rows.push([
    v,
    prev.title || "",
    prev.description || "",
    prev.tags || "",
    pub,
  ]);
}

const csvContent = rows.map((r) => r.map(esc).join(",")).join("\n");
writeFileSync(CSV_FILE, csvContent, "utf-8");

console.log(`Generated ${CSV_FILE} with ${videos.length} file(s)\n`);
console.log(rows[0].join(" | "));
console.log("-".repeat(80));
let skipped = 0;
for (let i = 1; i < rows.length; i++) {
  const marker = rows[i][4] ? "" : " (no schedule)";
  if (rows[i][4]) skipped++;
  console.log(`${String(i).padStart(2)}. ${rows[i][0]}${marker}`);
}
if (startTime && intervalMs) {
  const total = intervalMs * (videos.length - 1);
  console.log(`\nSchedule range: ${rows[1]?.[4] || "?"} → ${rows[rows.length - 1]?.[4] || "?"}`);
}
console.log(`\nEdit ${CSV_FILE} to customize per-file title, description, tags, and publish time.`);
