import { chromium, firefox } from "playwright";
import "dotenv/config";
import { existsSync, readdirSync, readFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import path from "path";

const JSON_FILE = "schedule.json";
const CSV_FILE = "schedule.csv";
const useFirefox = process.argv.slice(2).includes("--firefox");
const PROFILE_DIR = path.resolve(useFirefox ? "firefox-profile" : "chrome-profile");
if (!existsSync(PROFILE_DIR)) mkdirSync(PROFILE_DIR, { recursive: true });

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

const UPLOAD_DIR = path.resolve("upload");
if (!existsSync(UPLOAD_DIR)) { console.error("upload folder not found"); process.exit(1); }

const videoExts = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv"]);
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

// ── Upload each reel ─────────────────────────────────────────

async function ensureLoggedIn(page) {
  await page.goto("https://www.facebook.com", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  if (page.url().includes("login") || page.url().includes("checkpoint")) {
    console.log("\n==============================================");
    const browserName = useFirefox ? "Firefox" : "Chrome";
    console.log(`  กรุณาล็อกอิน Facebook ในหน้าต่าง ${browserName} ที่เปิดอยู่`);
    console.log("  แล้วกลับมาที่ Terminal แล้วกด Enter");
    console.log("  (ถ้าหน้าเว็บรีเฟรชไม่หยุด ให้ลบ chrome-profile/ แล้วรันใหม่)");
    console.log("==============================================\n");
    await new Promise((resolve) => process.stdin.once("data", resolve));

    // Wait for login to complete (URL no longer contains login)
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(2000);
      const url = page.url();
      if (!url.includes("login") && !url.includes("checkpoint") && !url.includes("captcha")) {
        console.log("  Login detected!");
        break;
      }
      if (i === 15) {
        console.log("  กำลังรอให้ล็อกอินสำเร็จ... (รออีก 30 วินาที)");
      }
    }
  }
}

async function clickPublish(page, entry) {
  const publishSelectors = [
    "span:has-text('Publish')",
    "span:has-text('Share')",
    "span:has-text('Post')",
    "[aria-label='Publish']",
    "[aria-label='Share']",
    "[aria-label='Post']",
    "div[role='button']:has-text('Publish')",
    "div[role='button']:has-text('Share')",
  ].join(", ");
  const publishBtn = page.locator(publishSelectors).first();
  if (await publishBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await publishBtn.click();
    console.log("  Published!");
  } else {
    console.log("  Could not find Publish button. Check screenshot.");
    await page.screenshot({ path: `fb-no-publish-${entry.filename}.png` });
  }
}

async function setSchedule(page, publishAt) {
  const dt = new Date(publishAt);
  if (isNaN(dt.getTime())) {
    console.log(`  Invalid publish_at: ${publishAt}, publishing immediately`);
    return clickPublish(page, { filename: "?" });
  }

  // Format date/time for FB input
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  const hours = String(dt.getHours()).padStart(2, "0");
  const mins = String(dt.getMinutes()).padStart(2, "0");
  const dateStr = `${year}-${month}-${day}`;
  const timeStr = `${hours}:${mins}`;

  console.log(`  Setting schedule: ${dateStr} ${timeStr}`);

  // Try to find a "Schedule" toggle/button/option
  const scheduleSelectors = [
    "[aria-label='Schedule']",
    "[aria-label='Schedule post']",
    "span:has-text('Schedule')",
    "div[role='button']:has-text('Schedule')",
    "[aria-label*='schedule']",
    "span:has-text('Publish later')",
    "div:has-text('Schedule post')",
  ].join(", ");

  let scheduled = false;
  const schedEl = page.locator(scheduleSelectors).first();
  if (await schedEl.isVisible({ timeout: 3000 }).catch(() => false)) {
    await schedEl.click();
    await page.waitForTimeout(1000);
    scheduled = true;
    console.log("  Schedule option selected.");
  } else {
    // Maybe it's a dropdown on the Publish button
    const publishDropdown = page.locator("[aria-label='Publish options'], [aria-label='More options'], div[role='button'][aria-haspopup]").first();
    if (await publishDropdown.isVisible({ timeout: 2000 }).catch(() => false)) {
      await publishDropdown.click();
      await page.waitForTimeout(1000);
      const schedInMenu = page.locator("span:has-text('Schedule'), div[role='menuitem']:has-text('Schedule'), [role='menuitem']:has-text('Publish later')").first();
      if (await schedInMenu.isVisible({ timeout: 3000 }).catch(() => false)) {
        await schedInMenu.click();
        await page.waitForTimeout(1000);
        scheduled = true;
        console.log("  Schedule selected from dropdown.");
      }
    }
  }

  if (!scheduled) {
    console.log("  Could not find Schedule option. Publishing immediately.");
    await page.screenshot({ path: `fb-no-schedule.png` });
    return clickPublish(page, { filename: "?" });
  }

  // Fill date and time inputs
  const dateInput = page.locator("input[type='date'], [aria-label='Date'], input[placeholder*='date' i], input[placeholder*='DD' i]").first();
  if (await dateInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await dateInput.click();
    await dateInput.fill(dateStr);
    console.log("  Date filled.");
  }

  const timeInput = page.locator("input[type='time'], [aria-label='Time'], input[placeholder*='time' i], input[placeholder*='HH' i]").first();
  if (await timeInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await timeInput.click();
    await timeInput.fill(timeStr);
    console.log("  Time filled.");
  }

  // Click confirm/schedule button
  const confirmSelectors = [
    "span:has-text('Schedule')",
    "div[role='button']:has-text('Schedule')",
    "[aria-label='Schedule']",
    "span:has-text('Confirm')",
    "[aria-label='Confirm']",
    "div[role='button']:has-text('Confirm')",
  ].join(", ");
  const confirmBtn = page.locator(confirmSelectors).last();
  if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await confirmBtn.click();
    console.log("  Scheduled!");
  } else {
    console.log("  Schedule confirm button not found. Publishing immediately.");
    await page.screenshot({ path: `fb-no-schedule-confirm.png` });
    return clickPublish(page, { filename: "?" });
  }
}

async function uploadReel(context, entry) {
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });
  const videoPath = path.join(UPLOAD_DIR, entry.filename);

  try {
    console.log(`\n--- Uploading reel: ${entry.filename} ---`);

    // Check if logged in first
    await page.goto("https://www.facebook.com", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    if (page.url().includes("login")) {
      console.log("  Not logged in! Please login first.");
      return;
    }

    // Try Reels creation page directly
    await page.goto("https://www.facebook.com/reels/create/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    // If redirected away (not on create page), try alternative URLs
    if (!page.url().includes("reels")) {
      console.log("  Reels create page not found, trying alternative...");
      await page.goto("https://www.facebook.com/reels/?create=1", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000);
    }

    await page.waitForTimeout(2000);

    // Upload file
    const fileInput = page.locator("input[type='file']").first();
    // Click the upload area first to make sure file input is active
    const uploadArea = page.locator("[aria-label*='video'], [aria-label*='Upload'], [aria-label*='Select'], div:has-text('Click to upload'), div:has-text('Drag and drop')").first();
    if (await uploadArea.isVisible({ timeout: 3000 }).catch(() => false)) {
      await uploadArea.click();
      await page.waitForTimeout(1000);
    }
    await fileInput.setInputFiles(videoPath);
    console.log("  File selected, waiting for upload...");
    await page.waitForTimeout(5000);
    console.log("  Upload in progress. Facebook may take time to process.");
    await page.screenshot({ path: `fb-after-upload-${entry.filename}.png` });

    // Add caption if provided — try multiple selectors
    if (entry.description) {
      const captionSelectors = [
        "[aria-label='Write a caption...']",
        "[aria-label='Write a caption']",
        "[aria-label='Describe your reel']",
        "[aria-label='Description']",
        "div[contenteditable='true']",
        "[role='textbox']",
        "textarea",
      ].join(", ");
      const descInput = page.locator(captionSelectors).first();
      if (await descInput.isVisible({ timeout: 8000 }).catch(() => false)) {
        const tagName = await descInput.evaluate(el => el.tagName);
        if (tagName === "TEXTAREA" || tagName === "INPUT") {
          await descInput.fill(entry.description);
        } else {
          // contenteditable div — use evaluate to preserve newlines
          await descInput.evaluate((el, text) => { el.innerText = text; }, entry.description);
        }
        console.log("  Caption filled.");
      } else {
        console.log("  Caption input not found. Screenshot saved.");
        await page.screenshot({ path: `fb-no-caption-${entry.filename}.png` });
      }
    }

    // Schedule or Publish
    if (entry.publish_at) {
      await setSchedule(page, entry.publish_at);
    } else {
      await clickPublish(page, entry);
    }

    await page.waitForTimeout(5000);
    console.log(`✓ Reel uploaded: ${entry.filename}`);
  } catch (err) {
    console.error(`✗ Failed: ${entry.filename} — ${err.message}`);
    await page.screenshot({ path: `fb-error-${entry.filename}.png` });
  } finally {
    await page.close();
  }
}

// ── Main ─────────────────────────────────────────────────────

async function launchBrowser() {
  if (useFirefox) {
    // Try to find real Firefox
    const candidates = [
      "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
      "C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe",
    ];
    let fxPath = candidates.find((p) => existsSync(p));
    if (!fxPath) {
      try {
        const out = execSync("where firefox", { encoding: "utf8", shell: "cmd.exe" }).trim().split("\n")[0];
        if (out && existsSync(out)) fxPath = out;
      } catch {}
    }
    const launchOpts = {
      headless: false,
      locale: "en-US",
      firefoxUserPrefs: { "dom.webdriver.enabled": false },
    };
    if (fxPath) {
      launchOpts.executablePath = fxPath;
      console.log("Using real Firefox:", fxPath);
    } else {
      console.log("Using Playwright Firefox (system Firefox not found)");
    }
    return await firefox.launchPersistentContext(PROFILE_DIR, launchOpts);
  }

  // Default: Chrome
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
    locale: "en-US",
  });
  return context;
}

async function main() {
  const context = await launchBrowser();

  const engine = useFirefox ? "Firefox" : "Chrome";
  context.on("page", (page) => {
    page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
  });

  const firstPage = context.pages()[0] || await context.newPage();
  await firstPage.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });
  console.log(`Opening ${engine} for Facebook Reels upload...`);
  await ensureLoggedIn(firstPage);
  await firstPage.close();

  for (const entry of entries) {
    await uploadReel(context, entry);
  }

  await context.close();
  console.log("\nAll reels uploaded!");
}

main();
