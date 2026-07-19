# KamTape Ripper
# Tip Jar $ https://buymeacoffee.com/ghostbyte
Chrome / Brave extension that downloads videos from [kamtape.com](https://www.kamtape.com/) as **MP4**, the **original FLV**, or rips the audio to **MP3**.

## Features

- **Download button under the player** on any KamTape watch page, a green **Download ▾** button appears below the video. Its dropdown lists every format: MP4 (source quality), FLV (original file) with real file sizes, and MP3 at 320 / 192 / 128 kbps with estimated sizes.
- **MP3 ripping** decodes the video's audio track in the browser and encodes it to MP3 at your chosen bitrate (via the bundled [lamejs](https://github.com/zhuker/lamejs) encoder). No server involved; progress shows on the button.
- **Toolbar popup** click the extension icon on a watch page to see the video title and grab any of the three formats.
- Files are named after the video title automatically.

## How it works

KamTape serves videos from a simple endpoint:

```
https://www.kamtape.com/get_video?video_id=<ID>          → original FLV
https://www.kamtape.com/get_video?video_id=<ID>&webm=1   → MP4
```

The extension extracts the video ID from the watch page URL and hands the
matching URL to the browser's download manager (`chrome.downloads`).

For MP3, the content script fetches the MP4, decodes its audio track with the
Web Audio API (`decodeAudioData`), encodes the PCM to MP3 with lamejs, and
saves the result as `<title>.mp3`.

## Install (Chrome or Brave)

1. Open `chrome://extensions` (Brave: `brave://extensions`).
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this `KamTapeRipper` folder.
4. Visit any KamTape video page the rip bar appears under the player.

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Manifest V3 config |
| `background.js` | Service worker performs downloads |
| `content.js` / `content.css` | Injects the rip bar on watch pages; MP3 conversion |
| `lame.min.js` | Bundled lamejs MP3 encoder |
| `popup.html` / `popup.css` / `popup.js` | Toolbar popup UI |
| `icons/` | Extension icons (16–128px) |

## Note

Only download videos you have the right to save. Respect KamTape's Terms of Use.
