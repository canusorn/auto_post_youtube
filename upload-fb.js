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

async function dumpButtons(page, label) {
  const buttons = await page.evaluate(() => {
    const results = [];
    const seen = new Set();
    for (const sel of ["button", "div[role='button']", "[aria-label]", "a[role='button']"]) {
      for (const el of document.querySelectorAll(sel)) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const text = (el.textContent || "").trim().slice(0, 80);
        const aria = el.getAttribute("aria-label") || "";
        const key = `${aria}|${text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({ tag: el.tagName, role: el.getAttribute("role") || "", aria, text, pos: `${Math.round(rect.left)},${Math.round(rect.top)}` });
      }
    }
    return results;
  });
  console.log(`\n=== ปุ่มทั้งหมด (${label}) ===`);
  for (const b of buttons) {
    if (b.aria || b.text) {
      console.log(`  role="${b.role}" aria="${b.aria}" text="${b.text}"`);
    }
  }
}

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
    console.log("  File selected, waiting for upload...");
    await page.waitForTimeout(8000);
    console.log("  Upload in progress. Facebook may take time to process.");

    // Click "ถัดไป" twice: upload → edit page → publish page
    for (let step = 1; step <= 2; step++) {
      const nextBtn = page.locator("[aria-label='ถัดไป'], span:has-text('ถัดไป'), div[role='button']:has-text('ถัดไป')").first();
      if (await nextBtn.isVisible({ timeout: 15000 }).catch(() => false)) {
        await nextBtn.click();
        console.log(`  Clicked ถัดไป (Next) #${step}`);
        await page.waitForTimeout(4000);
      }
    }

    // Now on publish page — add caption
    if (entry.description) {
      const captionSel = "div[contenteditable='true'], [role='textbox'], textarea";
      const descInput = page.locator(captionSel).first();
      if (await descInput.isVisible({ timeout: 10000 }).catch(() => false)) {
        const tagName = await descInput.evaluate(el => el.tagName);
        if (tagName === "TEXTAREA" || tagName === "INPUT") {
          await descInput.fill(entry.description);
        } else {
          await descInput.evaluate((el, text) => { el.innerText = text; }, entry.description);
        }
        console.log("  Caption filled.");
      } else {
        console.log("  Caption input not found.");
      }
    }

    await page.waitForTimeout(2000);

    // Handle scheduling if publish_at provided
    const pub = entry.publish_at;
    if (pub) {
      const dt = new Date(pub);
      if (!isNaN(dt.getTime())) {
        const clicked = await findAndClick(page, [
          "[aria-label*='แชร์กับ']",
          "[aria-label='แชร์กับ สาธารณะ']",
          "span:has-text('สาธารณะ')",
        ], "visibility dropdown");
        if (clicked) {
          await page.waitForTimeout(1500);
          const schedClicked = await findAndClick(page, [
            "span:has-text('ตั้งเวลาเผยแพร่')",
            "span:has-text('ตั้งเวลา')",
            "span:has-text('Schedule')",
            "div[role='menuitem']:has-text('ตั้งเวลา')",
            "div[role='menuitem']:has-text('กำหนดเวลา')",
          ], "schedule option");
          if (schedClicked) {
            await page.waitForTimeout(1000);
            const dateStr = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
            const timeStr = `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
            const dateInput = page.locator("input[type='date'], [aria-label='วันที่'], input[placeholder*='วว']").first();
            if (await dateInput.isVisible({ timeout: 3000 }).catch(() => false)) {
              await dateInput.fill(dateStr);
            }
            const timeInput = page.locator("input[type='time'], [aria-label='เวลา'], input[placeholder*='ชม']").first();
            if (await timeInput.isVisible({ timeout: 3000 }).catch(() => false)) {
              await timeInput.fill(timeStr);
            }
            console.log("  Schedule set.");
          }
        }
      }
    }

    // Dump buttons on editing page
    await page.screenshot({ path: `fb-ready-${entry.filename}.png` });
    await dumpButtons(page, `editing page - ${entry.filename}`);

    // Try to publish auto — look for "เผยแพร่" or "โพสต์"
    const pubClicked = await findAndClick(page, [
      "div[aria-label='เผยแพร่']",
      "span[aria-label='เผยแพร่']",
      "span:has-text('เผยแพร่')",
      "div[role='button']:has-text('เผยแพร่')",
      "span:has-text('โพสต์')",
      "div[role='button']:has-text('โพสต์')",
      "span:has-text('Post')",
      "div[role='button']:has-text('Post')",
      "span:has-text('Publish')",
      "div[role='button']:has-text('Publish')",
      "span:has-text('แชร์')",
      "div[role='button']:has-text('แชร์')",
    ], "publish button", 3000);

    if (pubClicked) {
      console.log("  Published/Scheduled!");
      await page.waitForTimeout(5000);
    } else {
      console.log("\n⚠ ไม่พบปุ่มเผยแพร่อัตโนมัติ — กรุณากดเอง แล้วกลับมากด Enter");
      await new Promise((resolve) => process.stdin.once("data", resolve));
    }

    console.log(`✓ Reel uploaded: ${entry.filename}`);
  } catch (err) {
    console.error(`✗ Failed: ${entry.filename} — ${err.message}`);
    console.log("  Browser will close in 10 seconds...");
    await page.screenshot({ path: `fb-error-${entry.filename}.png` });
    await page.waitForTimeout(10000);
  } finally {
    await page.close();
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
  for (const entry of entries) { await uploadReel(context, entry); }
  await context.close();
  console.log("\nAll reels uploaded!");
}

main();
