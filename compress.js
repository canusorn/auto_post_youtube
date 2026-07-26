import { existsSync, readdirSync } from "fs";
import path from "path";
import { execSync } from "child_process";

const UPLOAD_DIR = path.resolve("upload");
const videoExts = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv"]);

if (!existsSync(UPLOAD_DIR)) {
  console.error("upload folder not found");
  process.exit(1);
}

const files = readdirSync(UPLOAD_DIR)
  .filter((f) => videoExts.has(path.extname(f).toLowerCase()))
  .filter((f) => !f.startsWith("compressed_") && !f.startsWith("_"))
  .sort();

if (files.length === 0) {
  console.log("No video files to compress.");
  process.exit(0);
}

for (const file of files) {
  const input = path.join(UPLOAD_DIR, file);
  const parsed = path.parse(file);
  const output = path.join(UPLOAD_DIR, `compressed_${parsed.name}.mp4`);

  if (existsSync(output)) {
    console.log(`  SKIP ${file} → compressed_${parsed.name}.mp4 (already exists)`);
    continue;
  }

  console.log(`\nCompressing: ${file}`);
  const cmd = `ffmpeg -y -i "${input}" -vf "scale=720:1280" -c:v libx264 -preset fast -crf 28 -c:a aac -b:a 96k "${output}"`;
  try {
    execSync(cmd, { stdio: "inherit", timeout: 600000 });
    console.log(`  ✓ ${output}`);
  } catch {
    console.error(`  ✗ Failed to compress ${file}`);
  }
}
