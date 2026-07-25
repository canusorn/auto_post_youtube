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
  await page.goto("https://www.facebook.com", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);
  if (page.url().includes("login")) {
    console.log("\n==============================================");
    const browserName = useFirefox ? "Firefox" : "Chrome";
    console.log(`  กรุณาล็อกอิน Facebook ใน ${browserName} ที่เปิดอยู่`);
    console.log("  แล้วกลับมาที่ Terminal แล้วกด Enter");
    console.log("==============================================\n");
    await new Promise((resolve) => process.stdin.once("data", resolve));
    await page.goto("https://www.facebook.com", { waitUntil: "networkidle", timeout: 60000 });
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

    // Go to Creator Studio
    await page.goto("https://business.facebook.com/creatorstudio/", { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(3000);

    // Click "Create Reel" or similar
    const createBtn = page.locator("span:has-text('Create reel'), span:has-text('Create Reel'), [aria-label='Create reel'], [aria-label='Create Reel']");
    if (await createBtn.first().isVisible({ timeout: 10000 }).catch(() => false)) {
      await createBtn.first().click();
    } else {
      // Try the reels tab directly
      await page.goto("https://www.facebook.com/reels/", { waitUntil: "networkidle" });
      await page.waitForTimeout(3000);
      const uploadBtn = page.locator("[aria-label='Create reel'], [aria-label='Upload reel'], span:has-text('Upload')");
      if (await uploadBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await uploadBtn.first().click();
      } else {
        console.log("  No Create Reel button found. Trying direct upload...");
      }
    }

    await page.waitForTimeout(2000);

    // Upload file — try multiple approaches
    const fileInput = page.locator("input[type='file']").first();
    if (await fileInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await fileInput.setInputFiles(videoPath);
    } else {
      // Facebook may use a hidden file input triggered by a button
      await page.evaluate(() => {
        const inp = document.querySelector("input[type='file']");
        if (inp) inp.style.display = "block";
      });
      await page.waitForTimeout(500);
      await fileInput.setInputFiles(videoPath);
    }
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
        await descInput.click();
        await page.waitForTimeout(500);
        await descInput.fill(entry.description);
        console.log("  Caption filled.");
      } else {
        console.log("  Caption input not found. Screenshot saved.");
        await page.screenshot({ path: `fb-no-caption-${entry.filename}.png` });
      }
    }

    // Click Publish
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
