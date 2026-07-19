// KamTape Ripper — content script.
// On watch pages: injects a "Rip" bar under the player and answers the
// popup's requests for video info.

(() => {
  function getVideoId() {
    const params = new URLSearchParams(window.location.search);
    if (window.location.pathname === '/watch' && params.get('v')) {
      return params.get('v');
    }
    // Fallback: read the id straight out of the <video> source.
    const video = document.querySelector('video');
    const src = video && (video.src || video.currentSrc);
    if (src) {
      const m = src.match(/[?&]video_id=([^&]+)/);
      if (m) return decodeURIComponent(m[1]);
    }
    return null;
  }

  function getTitle() {
    const h1 = document.querySelector('h1');
    if (h1 && h1.textContent.trim()) return h1.textContent.trim();
    return document.title.replace(/^KamTape\s*-\s*/i, '').trim();
  }

  function fetchSize(videoId, param) {
    return fetch(`https://www.kamtape.com/get_video?video_id=${encodeURIComponent(videoId)}${param}`, { method: 'HEAD' })
      .then((r) => (r.ok ? Number(r.headers.get('content-length')) || null : null))
      .catch(() => null);
  }

  function formatBytes(bytes) {
    if (!bytes) return '';
    const mb = bytes / (1024 * 1024);
    return mb >= 1000 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
  }

  function sanitizeFilename(name) {
    return (
      name
        .replace(/[\\/:*?"<>|]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120) || 'kamtape_video'
    );
  }

  function floatTo16(channel) {
    const out = new Int16Array(channel.length);
    for (let i = 0; i < channel.length; i++) {
      const s = Math.max(-1, Math.min(1, channel[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  let mp3InProgress = false;

  async function ripMp3(onProgress) {
    const videoId = getVideoId();
    if (!videoId || mp3InProgress) return false;
    mp3InProgress = true;
    try {
      onProgress('Fetching…');
      const resp = await fetch(
        `https://www.kamtape.com/get_video?video_id=${encodeURIComponent(videoId)}&webm=1`
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.arrayBuffer();

      onProgress('Decoding…');
      const ctx = new AudioContext();
      let audio;
      try {
        audio = await ctx.decodeAudioData(data);
      } finally {
        ctx.close();
      }

      const channels = Math.min(audio.numberOfChannels, 2);
      const left = floatTo16(audio.getChannelData(0));
      const right = channels === 2 ? floatTo16(audio.getChannelData(1)) : null;

      const encoder = new lamejs.Mp3Encoder(channels, audio.sampleRate, 192);
      const chunks = [];
      const blockSize = 1152 * 20;
      for (let i = 0; i < left.length; i += blockSize) {
        const l = left.subarray(i, i + blockSize);
        const out =
          channels === 2
            ? encoder.encodeBuffer(l, right.subarray(i, i + blockSize))
            : encoder.encodeBuffer(l);
        if (out.length) chunks.push(out);
        if (i % (blockSize * 10) === 0) {
          onProgress(`Encoding ${Math.round((i / left.length) * 100)}%`);
          // Yield so the page stays responsive during long encodes.
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      const tail = encoder.flush();
      if (tail.length) chunks.push(tail);

      const blob = new Blob(chunks, { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sanitizeFilename(getTitle())}.mp3`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return true;
    } finally {
      mp3InProgress = false;
    }
  }

  function requestMp3(button) {
    const original = button.textContent;
    button.disabled = true;
    ripMp3((msg) => (button.textContent = msg))
      .then((ok) => {
        button.textContent = ok ? 'Saved ✓' : 'Failed ✕';
      })
      .catch(() => {
        button.textContent = 'Failed ✕';
      })
      .then(() => {
        setTimeout(() => {
          button.textContent = original;
          button.disabled = false;
        }, 2500);
      });
  }

  function requestDownload(format, button) {
    const videoId = getVideoId();
    if (!videoId) return;
    const original = button.textContent;
    button.textContent = 'Ripping…';
    button.disabled = true;
    chrome.runtime.sendMessage(
      { type: 'kamtape-download', videoId, title: getTitle(), format },
      (res) => {
        button.textContent = res && res.ok ? 'Started ✓' : 'Failed ✕';
        setTimeout(() => {
          button.textContent = original;
          button.disabled = false;
        }, 2000);
      }
    );
  }

  function injectBar() {
    if (document.getElementById('ktr-bar')) return;
    const videoId = getVideoId();
    if (!videoId) return;
    const player = document.querySelector('.vlPlayer') || document.querySelector('video');
    if (!player) return;

    const bar = document.createElement('div');
    bar.id = 'ktr-bar';

    const label = document.createElement('span');
    label.className = 'ktr-label';
    label.textContent = 'KamTape Ripper';
    bar.appendChild(label);

    const buttons = [
      { format: 'mp4', text: 'Download MP4', param: '&webm=1' },
      { format: 'flv', text: 'Download FLV', param: '' }
    ];

    for (const { format, text, param } of buttons) {
      const btn = document.createElement('button');
      btn.className = 'ktr-btn';
      btn.textContent = text;
      btn.addEventListener('click', () => requestDownload(format, btn));
      bar.appendChild(btn);
      fetchSize(videoId, param).then((size) => {
        if (size) btn.textContent = `${text} (${formatBytes(size)})`;
      });
    }

    const mp3Btn = document.createElement('button');
    mp3Btn.className = 'ktr-btn ktr-btn-mp3';
    mp3Btn.textContent = 'Rip MP3';
    mp3Btn.title = 'Extract the audio track and convert it to MP3 (192 kbps)';
    mp3Btn.addEventListener('click', () => requestMp3(mp3Btn));
    bar.appendChild(mp3Btn);

    player.insertAdjacentElement('afterend', bar);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'kamtape-get-info') {
      const videoId = getVideoId();
      if (!videoId) {
        sendResponse({ ok: false });
        return;
      }
      const title = getTitle();
      Promise.all([fetchSize(videoId, '&webm=1'), fetchSize(videoId, '')]).then(
        ([mp4Size, flvSize]) => {
          sendResponse({
            ok: true,
            videoId,
            title,
            mp4Size: formatBytes(mp4Size),
            flvSize: formatBytes(flvSize)
          });
        }
      );
      return true; // async response
    }
    if (msg && msg.type === 'kamtape-rip-mp3') {
      const barBtn = document.querySelector('#ktr-bar .ktr-btn-mp3');
      if (barBtn && !barBtn.disabled) {
        requestMp3(barBtn); // progress shows on the in-page button
        sendResponse({ ok: true });
      } else if (mp3InProgress) {
        sendResponse({ ok: false, error: 'A conversion is already running' });
      } else {
        // No bar (e.g. layout changed) — run it headless.
        ripMp3(() => {})
          .then((ok) => sendResponse({ ok }))
          .catch((e) => sendResponse({ ok: false, error: String(e) }));
        return true; // async response
      }
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectBar);
  } else {
    injectBar();
  }
})();
