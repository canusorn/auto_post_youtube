import { chromium } from "playwright";
import "dotenv/config";
import { existsSync, mkdirSync } from "fs";
import path from "path";

const PROFILE_DIR = path.resolve("chrome-profile");
if (!existsSync(PROFILE_DIR)) mkdirSync(PROFILE_DIR, { recursive: true });

async function main() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const page = context.pages()[0] || await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  console.log("กำลังเปิด Facebook...");
  await page.goto("https://www.facebook.com/reels/create/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(5000);

  const currentUrl = page.url();
  console.log("\nURL ปัจจุบัน:", currentUrl);

  if (currentUrl.includes("login")) {
    console.log("\n⚠ ยังไม่ได้ล็อกอิน — กรุณาล็อกอินก่อน");
    console.log("ล็อกอินเสร็จกลับมากด Enter...");
    await new Promise(resolve => process.stdin.once("data", resolve));
    await page.goto("https://www.facebook.com/reels/create/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(5000);
  }

  await page.screenshot({ path: "fb-debug.png", fullPage: true });
  console.log("\n📸 บันทึก screenshot: fb-debug.png");

  // Dump all clickable elements and their text
  const buttons = await page.evaluate(() => {
    const results = [];
    const selectors = [
      "button",
      "div[role='button']",
      "a[role='button']",
      "span[role='button']",
      "[aria-label]",
    ];
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.top < 0 || rect.left < 0) continue;
        results.push({
          tag: el.tagName,
          role: el.getAttribute("role") || "",
          "aria-label": el.getAttribute("aria-label") || "",
          text: (el.textContent || "").trim().slice(0, 100),
          visible: rect.width > 0 && rect.height > 0,
          pos: `${Math.round(rect.left)},${Math.round(rect.top)}`,
        });
      }
    }
    return results;
  });

  // Remove duplicates
  const seen = new Set();
  const unique = buttons.filter(b => {
    const key = `${b.tag}|${b["aria-label"]}|${b.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log("\n=== ปุ่มทั้งหมดที่เจอบนหน้า ===");
  for (const b of unique) {
    console.log(`  <${b.tag}> role="${b.role}" aria-label="${b["aria-label"]}" text="${b.text}" pos=${b.pos}`);
  }

  console.log("\nแคปหน้าจอแล้วที่ fb-debug.png — ส่งมาให้ผมดูได้เลย");
  console.log("หรือ copy output ด้านบนมาให้ ผมจะหา selector ให้");

  await page.waitForTimeout(60000);
  await context.close();
}

main().catch(e => { console.error(e); process.exit(1); });
