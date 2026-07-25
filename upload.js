import { chromium } from "playwright";
import "dotenv/config";
import { existsSync, readdirSync, readFileSync, mkdirSync } from "fs";
import path from "path";

const {
  YT_EMAIL,
  VIDEO_TAGS,
  PUBLISH_AT: ENV_PUBLISH_AT,
} = process.env;

if (!YT_EMAIL) {
  console.error("Missing YT_EMAIL in .env");
  process.exit(1);
}

const UPLOAD_DIR = path.resolve("upload");
if (!existsSync(UPLOAD_DIR)) {
  console.error("upload folder not found");
  process.exit(1);
}

const JSON_FILE = "schedule.json";
const CSV_FILE = "schedule.csv";
const PROFILE_DIR = path.resolve("chrome-profile");
if (!existsSync(PROFILE_DIR)) {
  mkdirSync(PROFILE_DIR, { recursive: true });
}

// ── Read schedule (CSV or JSON) ──────────────────────────────

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
  // Prefer JSON
  if (existsSync(JSON_FILE)) {
    return JSON.parse(readFileSync(JSON_FILE, "utf-8"));
  }
  // Fallback to CSV
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
      tags: idx.tags !== -1 ? cols[idx.tags]?.trim() || "" : "",
      publish_at: idx.publish_at !== -1 ? cols[idx.publish_at]?.trim() || "" : "",
    });
  }
  return entries;
}

// ── Resolve file list ────────────────────────────────────────

const videoExts = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv"]);

let scheduleEntries = readSchedule();
let filesToUpload;

if (scheduleEntries) {
  const srcFile = existsSync(JSON_FILE) ? JSON_FILE : CSV_FILE;
  console.log(`Loaded ${scheduleEntries.length} entries from ${srcFile}`);
  filesToUpload = scheduleEntries
    .filter((e) => existsSync(path.join(UPLOAD_DIR, e.filename)))
    .map((e) => ({
      file: e.filename,
      title: e.title,
      description: e.description,
      tags: e.tags,
      publish_at: e.publish_at,
    }));

  const missing = scheduleEntries.filter((e) => !existsSync(path.join(UPLOAD_DIR, e.filename)));
  for (const m of missing) {
    console.warn(`Warning: "${m.filename}" listed in CSV but not found in upload/ folder`);
  }
} else {
  const videos = readdirSync(UPLOAD_DIR).filter((f) =>
    videoExts.has(path.extname(f).toLowerCase())
  ).sort();
  filesToUpload = videos.map((f) => ({
    file: f,
    title: "",
    description: "",
    tags: "",
    publish_at: ENV_PUBLISH_AT || "",
  }));
}

if (filesToUpload.length === 0) {
  console.log("No video files to upload");
  process.exit(0);
}

console.log(`\nUpload queue (${filesToUpload.length} file(s)):`);
filesToUpload.forEach((f, i) => {
  const sched = f.publish_at ? ` @ ${f.publish_at}` : " (immediate)";
  console.log(`  ${i + 1}. ${f.file}${sched}`);
});

// ── Wait for manual login ──────────────────────────────────

async function ensureLoggedIn(page) {
  await page.goto("https://studio.youtube.com", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);

  // If redirected to accounts.google.com, user is not logged in
  if (page.url().includes("accounts.google.com")) {
    console.log("\n==============================================");
    console.log("  กรุณาล็อกอิน YouTube ใน Chrome ที่เปิดอยู่");
    console.log("  ล็อกอินด้วยบัญชี: " + YT_EMAIL);
    console.log("  จากนั้นกลับมาที่ Terminal แล้วกด Enter");
    console.log("==============================================\n");
    await new Promise((resolve) => {
      process.stdin.once("data", resolve);
    });
    // After user presses Enter, navigate to studio
    await page.goto("https://studio.youtube.com", { waitUntil: "networkidle", timeout: 120000 });
  }
}

// ── Upload logic ─────────────────────────────────────────────

async function uploadVideo(context, entry) {
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });
  const videoPath = path.join(UPLOAD_DIR, entry.file);
  const tags = entry.tags
    ? entry.tags.split(",").map((t) => t.trim()).filter(Boolean)
    : VIDEO_TAGS
      ? VIDEO_TAGS.split(",").map((t) => t.trim()).filter(Boolean)
      : [];

  try {
    console.log(`\n--- Uploading: ${entry.file} ---`);

    // Navigate to YouTube Studio
    await page.goto("https://studio.youtube.com", { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(3000);

    // Close any dialogs that may appear
    const dismissBtns = page.locator("ytcp-button:has-text('Dismiss'), ytcp-button:has-text('Got it'), ytcp-button:has-text('Skip')");
    if (await dismissBtns.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await dismissBtns.first().click();
      await page.waitForTimeout(1000);
    }

    // Click "Create" button (top-right)
    await page.waitForSelector("#create-icon", { timeout: 15000 });
    await page.click("#create-icon");
    await page.waitForTimeout(2000);

    // Click "Upload videos" from the dropdown
    await page.waitForSelector("ytcp-ve[action='upload'], tp-yt-iron-dropdown *:has-text('Upload videos')", { timeout: 10000 });
    await page.click("ytcp-ve[action='upload']");
    await page.waitForTimeout(2000);

    // Upload file
    const fileInput = page.locator("input[type='file']");
    await fileInput.setInputFiles(videoPath);
    console.log("File selected, waiting for upload...");

    // Wait for upload to complete (video title form appears)
    await page.waitForSelector("ytcp-video-title-form, #title-textarea", { timeout: 180000 });
    console.log("Upload completed, filling metadata...");

    // Fill title
    const videoTitle = entry.title || path.parse(entry.file).name;
    const titleInput = page.locator("#title-textarea");
    await titleInput.click();
    await titleInput.fill(videoTitle);

    // Fill description
    if (entry.description) {
      const descInput = page.locator("#description-textarea");
      await descInput.click();
      await descInput.fill(entry.description);
    }

    // Add tags
    if (tags.length > 0) {
      const tagsInput = page.locator("ytcp-form-input-container#tags-container input");
      if (await tagsInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        for (const tag of tags) {
          await tagsInput.fill(tag);
          await tagsInput.press("Enter");
          await page.waitForTimeout(300);
        }
      }
    }

    // Handle "Made for Kids"
    await page.waitForTimeout(2000);
    const notForKids = page.locator("#made-for-kids-group tp-yt-paper-radio-button[name='NOT_MADE_FOR_KIDS']");
    if (await notForKids.isVisible({ timeout: 3000 }).catch(() => false)) {
      await notForKids.click();
    }

    // Click NEXT through the panels
    for (let step = 0; step < 3; step++) {
      await page.waitForTimeout(2000);
      const nextBtn = page.locator("ytcp-button:has-text('Next'), ytcp-button#next-button");
      if (await nextBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await nextBtn.click();
      }
    }

    // Wait for visibility panel
    await page.waitForTimeout(3000);

    // Set visibility
    if (entry.publish_at) {
      const d = new Date(entry.publish_at);
      if (!isNaN(d.getTime())) {
        const scheduleRadio = page.locator("tp-yt-paper-radio-button[name='SCHEDULE'], #schedule-radio");
        if (await scheduleRadio.isVisible({ timeout: 3000 }).catch(() => false)) {
          await scheduleRadio.click();
          await page.waitForTimeout(1000);

          const dateInput = page.locator("#schedule-date, #date-input");
          await dateInput.click();
          const dateStr = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
          await dateInput.fill(dateStr);
          await dateInput.press("Tab");

          const timeInput = page.locator("#schedule-time, #time-input");
          await timeInput.click();
          const timeStr = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
          await timeInput.fill(timeStr);
          await timeInput.press("Tab");
          console.log(`  Scheduled for: ${entry.publish_at}`);
        }
      } else {
        console.warn(`  Invalid publish_at for ${entry.file}, publishing immediately`);
        const publicRadio = page.locator("tp-yt-paper-radio-button[name='PUBLIC'], #public-radio");
        if (await publicRadio.isVisible({ timeout: 2000 }).catch(() => false)) {
          await publicRadio.click();
          await page.waitForTimeout(1000);
        }
      }
    } else {
      const publicRadio = page.locator("tp-yt-paper-radio-button[name='PUBLIC'], #public-radio");
      if (await publicRadio.isVisible({ timeout: 3000 }).catch(() => false)) {
        await publicRadio.click();
        await page.waitForTimeout(1000);
      }
    }

    // Click DONE / PUBLISH
    const doneBtn = page.locator("ytcp-button:has-text('Done'), ytcp-button:has-text('PUBLISH'), ytcp-button#done-button");
    if (await doneBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await doneBtn.click();
    }

    await page.waitForTimeout(5000);
    console.log(`✓ Uploaded: ${entry.file}`);
  } catch (err) {
    console.error(`✗ Failed: ${entry.file} — ${err.message}`);
    await page.screenshot({ path: `error-${entry.file}.png` });
    console.log(`  Screenshot saved: error-${entry.file}.png`);
  } finally {
    await page.close();
  }
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",
    headless: false,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
    ],
    locale: "en-US",
    timezoneId: "America/New_York",
  });

  // Override automation detection on every new page
  context.on("page", (page) => {
    page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
  });

  const firstPage = context.pages()[0] || await context.newPage();
  await firstPage.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });
  await ensureLoggedIn(firstPage);

  for (const entry of filesToUpload) {
    await uploadVideo(context, entry);
  }

  await context.close();
  console.log("\nAll uploads complete!");
}

main();
