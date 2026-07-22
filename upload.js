import { chromium } from "playwright";
import "dotenv/config";
import { existsSync, readdirSync, readFileSync } from "fs";
import path from "path";

const {
  YT_EMAIL,
  YT_PASSWORD,
  VIDEO_TAGS,
  PUBLISH_AT: ENV_PUBLISH_AT,
} = process.env;

if (!YT_EMAIL || !YT_PASSWORD) {
  console.error("Missing YT_EMAIL or YT_PASSWORD in .env");
  process.exit(1);
}

const UPLOAD_DIR = path.resolve("upload");
if (!existsSync(UPLOAD_DIR)) {
  console.error("upload folder not found");
  process.exit(1);
}

const CSV_FILE = "schedule.csv";

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

// ── Resolve file list ────────────────────────────────────────

const videoExts = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv"]);

let scheduleEntries = readSchedule();
let filesToUpload;

if (scheduleEntries) {
  console.log(`Loaded ${scheduleEntries.length} entries from ${CSV_FILE}`);
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
  // Fallback: scan folder
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

// ── Upload logic ─────────────────────────────────────────────

async function uploadVideo(browser, entry) {
  const context = await browser.newContext({
    locale: "en-US",
    timezoneId: "America/New_York",
  });
  const page = await context.newPage();
  const videoPath = path.join(UPLOAD_DIR, entry.file);
  const tags = entry.tags
    ? entry.tags.split(",").map((t) => t.trim()).filter(Boolean)
    : VIDEO_TAGS
      ? VIDEO_TAGS.split(",").map((t) => t.trim()).filter(Boolean)
      : [];

  try {
    console.log(`\n--- Uploading: ${entry.file} ---`);

    // 1. Sign in
    console.log("Signing in to Google...");
    await page.goto("https://accounts.google.com/signin", { waitUntil: "networkidle" });
    await page.fill('input[type="email"]', YT_EMAIL);
    await page.click("#identifierNext");
    await page.waitForTimeout(2000);
    await page.fill('input[type="password"]', YT_PASSWORD);
    await page.click("#passwordNext");
    await page.waitForURL(/myaccount|youtube/, { timeout: 30000 });
    console.log("Signed in successfully.");

    // 2. Navigate to YouTube Studio
    await page.goto("https://studio.youtube.com", { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);

    // 3. Click "Create" button
    await page.click("ytcp-button#create-icon");
    await page.waitForTimeout(2000);

    // 4. Click "Upload videos"
    await page.click("ytcp-ve[action='upload']");
    await page.waitForTimeout(2000);

    // 5. Upload file
    const fileInput = page.locator("input[type='file']");
    await fileInput.setInputFiles(videoPath);
    console.log("File selected, waiting for upload...");

    // 6. Wait for upload to complete
    await page.waitForSelector("ytcp-video-title-form", { timeout: 120000 });
    console.log("Upload completed, filling metadata...");

    // 7. Fill title
    const videoTitle = entry.title || path.parse(entry.file).name;
    const titleInput = page.locator("#title-textarea");
    await titleInput.click();
    await titleInput.fill(videoTitle);

    // 8. Fill description
    if (entry.description) {
      const descInput = page.locator("#description-textarea");
      await descInput.click();
      await descInput.fill(entry.description);
    }

    // 9. Add tags
    if (tags.length > 0) {
      const tagsInput = page.locator("ytcp-form-input-container#tags-container input");
      if (await tagsInput.isVisible()) {
        for (const tag of tags) {
          await tagsInput.fill(tag);
          await tagsInput.press("Enter");
          await page.waitForTimeout(300);
        }
      }
    }

    // 10. Handle "Made for Kids"
    await page.waitForTimeout(2000);
    const notForKids = page.locator("tp-yt-paper-radio-button[name='NOT_MADE_FOR_KIDS']");
    if (await notForKids.isVisible()) {
      await notForKids.click();
    }

    // 11. Click NEXT through the panels
    for (let step = 0; step < 3; step++) {
      await page.waitForTimeout(1500);
      const nextBtn = page.locator("ytcp-button:has-text('Next')");
      if (await nextBtn.isVisible()) {
        await nextBtn.click();
      }
    }

    // 12. Set visibility on final panel
    await page.waitForTimeout(2000);
    await page.waitForSelector("ytcp-visibility-select", { timeout: 15000 });

    if (entry.publish_at) {
      const d = new Date(entry.publish_at);
      if (isNaN(d.getTime())) {
        console.warn(`  Invalid publish_at for ${entry.file}, publishing immediately`);
      } else {
        const scheduleRadio = page.locator("tp-yt-paper-radio-button[name='SCHEDULE']");
        await scheduleRadio.click();
        await page.waitForTimeout(1000);

        const dateInput = page.locator("#schedule-date");
        await dateInput.click();
        const dateStr = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
        await dateInput.fill(dateStr);
        await dateInput.press("Tab");

        const timeInput = page.locator("#schedule-time");
        await timeInput.click();
        const timeStr = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        await timeInput.fill(timeStr);
        await timeInput.press("Tab");
        console.log(`  Scheduled for: ${entry.publish_at}`);
      }
    } else {
      const publicRadio = page.locator("tp-yt-paper-radio-button[name='PUBLIC']");
      await publicRadio.click();
      await page.waitForTimeout(1000);
    }

    // 13. Click DONE
    const doneBtn = page.locator("ytcp-button:has-text('Done')");
    await doneBtn.click();

    await page.waitForTimeout(5000);
    console.log(`✓ Uploaded: ${entry.file}`);
  } catch (err) {
    console.error(`✗ Failed: ${entry.file} — ${err.message}`);
    await page.screenshot({ path: `error-${entry.file}.png` });
  } finally {
    await context.close();
  }
}

async function main() {
  const browser = await chromium.launch({ headless: false });

  for (const entry of filesToUpload) {
    await uploadVideo(browser, entry);
  }

  await browser.close();
  console.log("\nAll uploads complete!");
}

main();
