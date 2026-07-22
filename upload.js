import { chromium } from "playwright";
import "dotenv/config";
import { readFileSync, existsSync } from "fs";
import path from "path";

const {
  YT_EMAIL,
  YT_PASSWORD,
  VIDEO_PATH,
  VIDEO_TITLE,
  VIDEO_DESCRIPTION,
  VIDEO_TAGS,
  PUBLISH_AT,
} = process.env;

if (!YT_EMAIL || !YT_PASSWORD) {
  console.error("Missing YT_EMAIL or YT_PASSWORD in .env");
  process.exit(1);
}

if (!VIDEO_PATH || !existsSync(VIDEO_PATH)) {
  console.error("VIDEO_PATH not found:", VIDEO_PATH);
  process.exit(1);
}

const videoPath = path.resolve(VIDEO_PATH);
const title = VIDEO_TITLE || "Untitled Video";
const description = VIDEO_DESCRIPTION || "";
const tags = VIDEO_TAGS ? VIDEO_TAGS.split(",").map((t) => t.trim()) : [];
const publishAt = PUBLISH_AT ? new Date(PUBLISH_AT) : null;

if (publishAt && isNaN(publishAt.getTime())) {
  console.error("Invalid PUBLISH_AT date format. Use ISO 8601 (e.g. 2026-07-25T14:00:00Z)");
  process.exit(1);
}

async function uploadToYouTube() {
  const { firefox } = await import("playwright");

  const browser = await firefox.launch({ headless: false });
  const context = await browser.newContext({
    locale: "en-US",
    timezoneId: "America/New_York",
  });
  const page = await context.newPage();

  try {
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
    const titleInput = page.locator("#title-textarea");
    await titleInput.click();
    await titleInput.fill(title);

    // 8. Fill description
    const descInput = page.locator("#description-textarea");
    await descInput.click();
    await descInput.fill(description);

    // 9. Add tags if provided
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

    // 10. Set visibility
    await page.waitForTimeout(2000);
    const visibilitySection = page.locator("ytkc-made-for-kids-select");
    await page.waitForSelector("ytcp-visibility-select", { timeout: 15000 });

    if (PUBLISH_AT) {
      // Schedule
      const scheduleRadio = page.locator("tp-yt-paper-radio-button[name='SCHEDULE']");
      await scheduleRadio.click();
      await page.waitForTimeout(1000);

      // Set date/time
      const dateInput = page.locator("#schedule-date");
      await dateInput.click();
      const d = new Date(PUBLISH_AT);
      const dateStr = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
      await dateInput.fill(dateStr);
      await dateInput.press("Tab");

      const timeInput = page.locator("#schedule-time");
      await timeInput.click();
      const timeStr = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      await timeInput.fill(timeStr);
      await timeInput.press("Tab");
      console.log(`Scheduled for: ${PUBLISH_AT}`);
    } else {
      // Public immediately
      const publicRadio = page.locator("tp-yt-paper-radio-button[name='PUBLIC']");
      await publicRadio.click();
    }

    // 11. Handle "Made for Kids" — select "No"
    await page.waitForTimeout(1000);
    const notForKids = page.locator("tp-yt-paper-radio-button[name='NOT_MADE_FOR_KIDS']");
    if (await notForKids.isVisible()) {
      await notForKids.click();
    }

    // 12. Click NEXT through the panels
    for (const label of ["Next", "Next", "Next"]) {
      await page.waitForTimeout(1000);
      const nextBtn = page.locator("ytcp-button:has-text('Next')");
      if (await nextBtn.isVisible()) {
        await nextBtn.click();
      }
    }

    // 13. Set visibility and confirm
    await page.waitForTimeout(2000);
    if (PUBLISH_AT) {
      const scheduleRadio = page.locator("tp-yt-paper-radio-button[name='SCHEDULE']");
      await scheduleRadio.click();
      await page.waitForTimeout(1000);
    } else {
      const publicRadio = page.locator("tp-yt-paper-radio-button[name='PUBLIC']");
      await publicRadio.click();
      await page.waitForTimeout(1000);
    }

    // 14. Click DONE / PUBLISH
    const doneBtn = page.locator("ytcp-button:has-text('Done')");
    await doneBtn.click();

    await page.waitForTimeout(5000);
    console.log("Video uploaded successfully!");
  } catch (err) {
    console.error("Upload failed:", err);
    await page.screenshot({ path: "error.png" });
    process.exit(1);
  } finally {
    await browser.close();
  }
}

uploadToYouTube();
