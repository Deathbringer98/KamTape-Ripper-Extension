// KamTape Ripper — content script.
// On watch pages: injects a "Download" dropdown button under the player and
// answers the popup's requests for video info.

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

  function getDuration() {
    const video = document.querySelector('video');
    return video && isFinite(video.duration) ? video.duration : null;
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

  async function ripMp3(bitrate, onProgress) {
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

      const encoder = new lamejs.Mp3Encoder(channels, audio.sampleRate, bitrate);
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
      a.download = `${sanitizeFilename(getTitle())} (${bitrate}kbps).mp3`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return true;
    } finally {
      mp3InProgress = false;
    }
  }

  function requestVideoDownload(format) {
    const videoId = getVideoId();
    if (!videoId) return;
    setMainStatus('Starting…');
    chrome.runtime.sendMessage(
      { type: 'kamtape-download', videoId, title: getTitle(), format },
      (res) => {
        setMainStatus(res && res.ok ? 'Started ✓' : 'Failed ✕', 2000);
      }
    );
  }

  function requestMp3(bitrate) {
    if (mp3InProgress) return;
    const btn = document.querySelector('#ktr-bar .ktr-main');
    if (btn) btn.disabled = true;
    ripMp3(bitrate, (msg) => setMainStatus(msg))
      .then((ok) => setMainStatus(ok ? 'Saved ✓' : 'Failed ✕', 2500))
      .catch(() => setMainStatus('Failed ✕', 2500))
      .then(() => {
        if (btn) setTimeout(() => (btn.disabled = false), 2500);
      });
  }

  const MAIN_LABEL = 'Download ▾';

  function setMainStatus(text, resetAfterMs) {
    const btn = document.querySelector('#ktr-bar .ktr-main');
    if (!btn) return;
    btn.textContent = text;
    if (resetAfterMs) {
      setTimeout(() => {
        btn.textContent = MAIN_LABEL;
      }, resetAfterMs);
    }
  }

  function makeItem(label, sub, onClick) {
    const item = document.createElement('button');
    item.className = 'ktr-item';
    const main = document.createElement('span');
    main.textContent = label;
    item.appendChild(main);
    if (sub) {
      const s = document.createElement('span');
      s.className = 'ktr-item-sub';
      s.textContent = sub;
      item.appendChild(s);
    }
    item.addEventListener('click', () => {
      closeMenu();
      onClick();
    });
    return item;
  }

  function closeMenu() {
    const menu = document.querySelector('#ktr-bar .ktr-menu');
    if (menu) menu.classList.remove('open');
  }

  function injectBar() {
    if (document.getElementById('ktr-bar')) return;
    const videoId = getVideoId();
    if (!videoId) return;
    const player = document.querySelector('.vlPlayer') || document.querySelector('video');
    if (!player) return;

    const bar = document.createElement('div');
    bar.id = 'ktr-bar';

    const main = document.createElement('button');
    main.className = 'ktr-main';
    main.textContent = MAIN_LABEL;
    bar.appendChild(main);

    const menu = document.createElement('div');
    menu.className = 'ktr-menu';

    const headerVideo = document.createElement('div');
    headerVideo.className = 'ktr-header';
    headerVideo.textContent = 'Video';
    menu.appendChild(headerVideo);

    const mp4Item = makeItem('MP4', 'Source quality', () => requestVideoDownload('mp4'));
    const flvItem = makeItem('FLV', 'Original file', () => requestVideoDownload('flv'));
    menu.appendChild(mp4Item);
    menu.appendChild(flvItem);

    const headerAudio = document.createElement('div');
    headerAudio.className = 'ktr-header';
    headerAudio.textContent = 'MP3 (audio only)';
    menu.appendChild(headerAudio);

    const mp3Items = [
      { kbps: 320, label: 'MP3 · 320 kbps', sub: 'Best quality' },
      { kbps: 192, label: 'MP3 · 192 kbps', sub: 'Standard' },
      { kbps: 128, label: 'MP3 · 128 kbps', sub: 'Small file' }
    ];
    for (const { kbps, label, sub } of mp3Items) {
      const item = makeItem(label, sub, () => requestMp3(kbps));
      item.dataset.kbps = String(kbps);
      menu.appendChild(item);
    }

    bar.appendChild(menu);
    player.insertAdjacentElement('afterend', bar);

    main.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!bar.contains(e.target)) closeMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
    });

    // Fill in real / estimated file sizes once known.
    fetchSize(videoId, '&webm=1').then((size) => {
      if (size) mp4Item.querySelector('.ktr-item-sub').textContent = `Source quality · ${formatBytes(size)}`;
    });
    fetchSize(videoId, '').then((size) => {
      if (size) flvItem.querySelector('.ktr-item-sub').textContent = `Original file · ${formatBytes(size)}`;
    });
    const fillMp3Sizes = () => {
      const duration = getDuration();
      if (!duration) return false;
      for (const item of menu.querySelectorAll('[data-kbps]')) {
        const kbps = Number(item.dataset.kbps);
        const est = (kbps * 1000 * duration) / 8;
        const base = item.dataset.kbps === '320' ? 'Best quality' : item.dataset.kbps === '192' ? 'Standard' : 'Small file';
        item.querySelector('.ktr-item-sub').textContent = `${base} · ~${formatBytes(est)}`;
      }
      return true;
    };
    if (!fillMp3Sizes()) {
      const video = document.querySelector('video');
      if (video) video.addEventListener('loadedmetadata', fillMp3Sizes, { once: true });
    }
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
      const bitrate = Number(msg.bitrate) || 192;
      if (mp3InProgress) {
        sendResponse({ ok: false, error: 'A conversion is already running' });
        return;
      }
      if (document.querySelector('#ktr-bar .ktr-main')) {
        requestMp3(bitrate); // progress shows on the in-page button
        sendResponse({ ok: true });
      } else {
        // No bar (e.g. layout changed) — run it headless.
        ripMp3(bitrate, () => {})
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
