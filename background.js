// KamTape Ripper — service worker.
// Receives download requests from the content script / popup and hands them
// to chrome.downloads so the file gets a proper name and shows in the shelf.

const FORMATS = {
  mp4: { param: '&webm=1', ext: 'mp4' },
  flv: { param: '', ext: 'flv' }
};

function sanitizeFilename(name) {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'kamtape_video'
  );
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'kamtape-download') {
    const format = FORMATS[msg.format] || FORMATS.mp4;
    const url = `https://www.kamtape.com/get_video?video_id=${encodeURIComponent(msg.videoId)}${format.param}`;
    const filename = `${sanitizeFilename(msg.title || msg.videoId)}.${format.ext}`;

    chrome.downloads.download({ url, filename }, (downloadId) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ ok: true, downloadId });
      }
    });
    return true; // keep the message channel open for the async response
  }
});
