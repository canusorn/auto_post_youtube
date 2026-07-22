# Auto Post YouTube

Upload videos to YouTube and schedule publishing time using Playwright + Firefox.

## Setup

```bash
# Install dependencies
npm install
```

## Configuration

Copy `.env.example` to `.env` and fill in your details:

```env
YT_EMAIL=your-google-email@gmail.com
YT_PASSWORD=your-google-password
VIDEO_PATH=./video.mp4
VIDEO_TITLE=My Video Title
VIDEO_DESCRIPTION=Video description here
VIDEO_TAGS=tag1,tag2,tag3
PUBLISH_AT=2026-07-25T14:00:00Z
```

| Variable | Description |
|---|---|
| `YT_EMAIL` | Your Google account email |
| `YT_PASSWORD` | Your Google account password |
| `VIDEO_PATH` | Path to the video file |
| `VIDEO_TITLE` | Title of the video |
| `VIDEO_DESCRIPTION` | Description text |
| `VIDEO_TAGS` | Comma-separated tags |
| `PUBLISH_AT` | ISO 8601 date to schedule publish. Leave empty to publish immediately. |

## Usage

```bash
npm run upload
```

The script will open Firefox, sign into Google, upload the video, fill metadata, and set visibility to **Public** or **Scheduled** based on `PUBLISH_AT`.

## Notes

- First run requires you to complete login manually (2FA, phone verification, etc.)
- YouTube Studio UI changes may break selectors — check `upload.js` if something fails
- Keep `headless: false` to monitor the process
