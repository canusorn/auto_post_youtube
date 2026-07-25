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

// ── Helpers ───────────────────────────────────────────────────

async function findAndClick(page, selectors, name, timeout = 5000) {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout }).catch(() => false)) {
      console.log(`  Found ${name}: ${sel}`);
      await el.click();
      await page.waitForTimeout(1000);
      return true;
    }
  }
  return false;
}

async function ensureLoggedIn(page) {
  await page.goto("https://www.facebook.com", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  if (page.url().includes("login") || page.url().includes("checkpoint")) {
    console.log("\n==============================================");
    console.log(`  กรุณาล็อกอิน Facebook ในหน้าต่างที่เปิดอยู่`);
    console.log("  แล้วกลับมาที่ Terminal แล้วกด Enter");
    console.log("==============================================\n");
    await new Promise((resolve) => process.stdin.once("data", resolve));
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(2000);
      const url = page.url();
      if (!url.includes("login") && !url.includes("checkpoint") && !url.includes("captcha")) {
        console.log("  Login detected!");
        return;
      }
      if (i === 15) console.log("  กำลังรอให้ล็อกอินสำเร็จ... (รออีก 30 วินาที)");
    }
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

    // Navigate to Reels creation page
    await page.goto("https://www.facebook.com/reels/create/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(5000);

    // Click upload button and intercept file chooser dialog
    const uploadBtn = page.locator("[aria-label='อัพโหลดวิดีโอสำหรับคลิป Reels'], [aria-label='เพิ่มวิดีโอหรือลากแล้ววาง']").first();
    if (!(await uploadBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
      console.log("  Upload button not found.");
      await page.screenshot({ path: `fb-no-upload-btn-${entry.filename}.png` });
      throw new Error("Could not find upload button");
    }

    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 15000 }),
      uploadBtn.click(),
    ]);
    await fileChooser.setFiles(videoPath);
    console.log("  File selected, waiting for upload to complete...");

    // Wait for upload to finish by watching for "ถัดไป" button (up to 10 min)
    for (let step = 1; step <= 2; step++) {
      const btn = page.locator("[aria-label='ถัดไป'], span:has-text('ถัดไป'), div[role='button']:has-text('ถัดไป')").first();
      await btn.waitFor({ state: "visible", timeout: 600000 });
      await btn.click();
      console.log(`  Clicked ถัดไป #${step}`);
      await page.waitForTimeout(4000);
    }

    // Now on publish page — add caption
    if (entry.description) {
      const captionSel = "[aria-label='คลิป Reels'] [contenteditable='true']";
      const descInput = page.locator(captionSel).first();
      if (await descInput.isVisible({ timeout: 10000 }).catch(() => false)) {
        await descInput.click();
        await page.waitForTimeout(500);
        await descInput.fill(entry.description);
        console.log("  Caption filled.");
      } else {
        console.log("  Caption input not found within form, trying fallback...");
        const fallback = page.locator("[contenteditable='true'], [role='textbox']").first();
        if (await fallback.isVisible({ timeout: 5000 }).catch(() => false)) {
          await fallback.click();
          await page.waitForTimeout(500);
          await fallback.fill(entry.description);
          console.log("  Caption filled (fallback).");
        } else {
          console.log("  Caption input not found at all.");
          await page.screenshot({ path: `fb-no-caption-${entry.filename}.png` });
        }
      }
    }

    await page.waitForTimeout(2000);

    // Set schedule if publish_at provided
    const pub = entry.publish_at;
    if (pub) {
      const dt = new Date(pub);
      if (!isNaN(dt.getTime())) {
        console.log("  Setting schedule...");
        // Click schedule options button ("ตัวเลือกการกำหนดเวลาเผยแพร่")
        const schedBtn = page.locator("text=ตัวเลือกการกำหนดเวลาเผยแพร่, text=กำหนดเวลาเผยแพร่").first();
        if (await schedBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await schedBtn.click();
          await page.waitForTimeout(1500);
        }
        // If a popup appeared, look for "ตั้งเวลา" option
        const scheduleOpt = page.locator("text=ตั้งเวลาเผยแพร่, text=ตั้งเวลา").first();
        if (await scheduleOpt.isVisible({ timeout: 3000 }).catch(() => false)) {
          await scheduleOpt.click();
          await page.waitForTimeout(1000);
        }
        // Fill date/time inputs
        const dateStr = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
        const timeStr = `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
        const dateInput = page.locator("input[type='date'], [aria-label='วันที่'], input[placeholder*='วว']").first();
        if (await dateInput.isVisible({ timeout: 5000 }).catch(() => false)) {
          await dateInput.fill(dateStr);
        }
        const timeInput = page.locator("input[type='time'], [aria-label='เวลา'], input[placeholder*='ชม']").first();
        if (await timeInput.isVisible({ timeout: 5000 }).catch(() => false)) {
          await timeInput.fill(timeStr);
        }
        console.log("  Schedule set.");
      }
    }

    // Wait for publish button and click it
    console.log("  Waiting for publish button to become active...");
    const pubBtn = page.locator("[aria-label='โพสต์'], [aria-label='เผยแพร่'], [aria-label='Post']").first();
    try {
      await pubBtn.waitFor({ state: "visible", timeout: 600000 });
      await page.waitForTimeout(2000);
      await pubBtn.click();
      console.log("  Published! Waiting for page to load...");
    } catch {
      console.log("\n⚠ ปุ่มโพสต์ไม่ทำงานหลังจาก 10 นาที — กรุณากดเอง แล้วกลับมากด Enter");
      await page.screenshot({ path: `fb-pub-timeout-${entry.filename}.png` });
      await new Promise((resolve) => process.stdin.once("data", resolve));
    }
    try { await page.waitForTimeout(60000); } catch {}
    console.log(`✓ Reel uploaded: ${entry.filename}`);
  } catch (err) {
    console.error(`✗ Failed: ${entry.filename} — ${err.message}`);
    try { await page.screenshot({ path: `fb-error-${entry.filename}.png` }); } catch {}
  } finally {
    try { await page.close(); } catch {}
  }
}

// ── Main ──────────────────────────────────────────────────────

async function launchBrowser() {
  if (useFirefox) {
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
      headless: false, locale: "en-US",
      firefoxUserPrefs: { "dom.webdriver.enabled": false },
    };
    if (fxPath) { launchOpts.executablePath = fxPath; console.log("Using real Firefox:", fxPath); }
    else { console.log("Using Playwright Firefox (system Firefox not found)"); }
    return await firefox.launchPersistentContext(PROFILE_DIR, launchOpts);
  }
  return await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome", headless: false,
    args: ["--disable-blink-features=AutomationControlled"], locale: "en-US",
  });
}

async function main() {
  const context = await launchBrowser();
  const engine = useFirefox ? "Firefox" : "Chrome";
  context.on("page", (page) => {
    page.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => false }); });
  });
  const firstPage = context.pages()[0] || await context.newPage();
  await firstPage.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => false }); });
  console.log(`Opening ${engine} for Facebook Reels upload...`);
  await ensureLoggedIn(firstPage);
  await firstPage.close();
  for (let i = 0; i < entries.length; i++) {
    await uploadReel(context, entries[i]);
    if (i < entries.length - 1) {
      console.log("  Waiting 30s before next upload...");
      await new Promise(r => setTimeout(r, 30000));
    }
  }
  console.log("  Waiting 30s before closing...");
  await new Promise(r => setTimeout(r, 30000));
  await context.close();
  console.log("\nAll reels uploaded!");
}

main();
