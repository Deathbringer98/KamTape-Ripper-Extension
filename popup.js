// KamTape Ripper — popup.
// Asks the content script on the active tab for video info; if the tab is a
// KamTape watch page, shows the title and download buttons.

const stateIdle = document.getElementById('state-idle');
const stateLoading = document.getElementById('state-loading');
const stateVideo = document.getElementById('state-video');
const titleEl = document.getElementById('video-title');
const statusEl = document.getElementById('status');
const btnMp4 = document.getElementById('dl-mp4');
const btnFlv = document.getElementById('dl-flv');
const btnMp3 = document.getElementById('dl-mp3');

function show(el) {
  for (const s of [stateIdle, stateLoading, stateVideo]) {
    s.classList.toggle('hidden', s !== el);
  }
}

function download(info, format, button) {
  button.disabled = true;
  statusEl.textContent = 'Starting download…';
  statusEl.classList.remove('error');
  chrome.runtime.sendMessage(
    { type: 'kamtape-download', videoId: info.videoId, title: info.title, format },
    (res) => {
      button.disabled = false;
      if (res && res.ok) {
        statusEl.textContent = 'Download started — check your downloads.';
      } else {
        statusEl.textContent = `Download failed${res && res.error ? `: ${res.error}` : ''}`;
        statusEl.classList.add('error');
      }
    }
  );
}

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab) {
    show(stateIdle);
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: 'kamtape-get-info' }, (info) => {
    if (chrome.runtime.lastError || !info || !info.ok) {
      show(stateIdle);
      return;
    }
    titleEl.textContent = info.title;
    if (info.mp4Size) btnMp4.textContent = `Download MP4 (${info.mp4Size})`;
    if (info.flvSize) btnFlv.textContent = `Download FLV (${info.flvSize})`;
    btnMp4.addEventListener('click', () => download(info, 'mp4', btnMp4));
    btnFlv.addEventListener('click', () => download(info, 'flv', btnFlv));
    btnMp3.addEventListener('click', () => {
      btnMp3.disabled = true;
      statusEl.textContent = 'Converting audio — progress shows on the page.';
      statusEl.classList.remove('error');
      chrome.tabs.sendMessage(tab.id, { type: 'kamtape-rip-mp3', bitrate: 192 }, (res) => {
        btnMp3.disabled = false;
        if (!res || !res.ok) {
          statusEl.textContent = `MP3 rip failed${res && res.error ? `: ${res.error}` : ''}`;
          statusEl.classList.add('error');
        }
      });
    });
    show(stateVideo);
  });
});
