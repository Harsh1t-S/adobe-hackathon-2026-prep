/* ==========================================================================
   Proctor preview — a local camera view and a live microphone level meter,
   so you can see what the real proctor would see and hear before it costs you.

   Everything here stays in the browser: the stream is attached to a <video>
   element and an AnalyserNode and never leaves the page. Nothing is recorded,
   nothing is uploaded, there is no network call anywhere in this file.

   It is strictly opt-in — the camera is only requested when the button is
   pressed, and the tracks are stopped the moment you leave the mock.
   ========================================================================== */

const MEDIA = {
  stream: null,
  audioCtx: null,
  analyser: null,
  data: null,
  raf: null,
  panel: null,
  collapsed: false,
  noiseEvents: 0,
  loudSince: 0,
  peak: 0,
  error: '',
};

// RMS above this counts as "loud enough that a real proctor would notice".
// Tuned so normal room tone sits well below it and speech clearly crosses it.
const MEDIA_NOISE_THRESHOLD = 0.11;
const MEDIA_LOUD_MS = 400;

function mediaSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

async function mediaStart() {
  MEDIA.error = '';
  mediaRender();
  if (!mediaSupported()) {
    MEDIA.error = 'This browser exposes no camera or microphone API.';
    mediaRender();
    return;
  }
  try {
    MEDIA.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (err) {
    const name = (err && err.name) || '';
    MEDIA.error =
      name === 'NotAllowedError'
        ? 'Permission denied. Allow camera and microphone for this page, then try again.'
        : name === 'NotFoundError' || name === 'OverconstrainedError'
        ? 'No camera or microphone found on this device.'
        : name === 'NotReadableError'
        ? 'Another app is already using the camera. Close it and try again.'
        : 'Could not start the preview: ' + (name || 'unknown error') +
          '. If this page is embedded in another site, open it in its own tab instead.';
    mediaRender();
    return;
  }

  // Audio analysis. No processing of the signal, just a level read.
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    MEDIA.audioCtx = new Ctx();
    if (MEDIA.audioCtx.state === 'suspended') await MEDIA.audioCtx.resume();
    const source = MEDIA.audioCtx.createMediaStreamSource(MEDIA.stream);
    MEDIA.analyser = MEDIA.audioCtx.createAnalyser();
    MEDIA.analyser.fftSize = 1024;
    MEDIA.analyser.smoothingTimeConstant = 0.6;
    source.connect(MEDIA.analyser);   // deliberately NOT connected to destination — no feedback loop
    MEDIA.data = new Uint8Array(MEDIA.analyser.fftSize);
  } catch (e) {
    MEDIA.analyser = null;   // video still works without the meter
  }

  MEDIA.noiseEvents = 0;
  MEDIA.peak = 0;
  mediaRender();
  mediaLoop();
}

function mediaStop() {
  if (MEDIA.raf) { cancelAnimationFrame(MEDIA.raf); MEDIA.raf = null; }
  if (MEDIA.stream) {
    MEDIA.stream.getTracks().forEach(function (t) { t.stop(); });
    MEDIA.stream = null;
  }
  if (MEDIA.audioCtx) {
    try { MEDIA.audioCtx.close(); } catch (e) { /* already closed */ }
    MEDIA.audioCtx = null;
  }
  MEDIA.analyser = null;
  MEDIA.loudSince = 0;
  mediaRender();
}

function mediaLevel() {
  if (!MEDIA.analyser) return 0;
  MEDIA.analyser.getByteTimeDomainData(MEDIA.data);
  let sum = 0;
  for (let i = 0; i < MEDIA.data.length; i++) {
    const v = (MEDIA.data[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / MEDIA.data.length);
}

function mediaLoop() {
  MEDIA.raf = requestAnimationFrame(mediaLoop);
  if (!MEDIA.stream) return;

  const rms = mediaLevel();
  const pct = Math.min(100, rms * 320);          // headroom so speech lands mid-scale
  MEDIA.peak = Math.max(MEDIA.peak * 0.94, pct); // decaying peak hold

  const fill = $('#pmFill'), peak = $('#pmPeak'), count = $('#pmNoiseCount'), state = $('#pmState');
  if (fill) {
    fill.style.width = pct + '%';
    fill.dataset.loud = rms > MEDIA_NOISE_THRESHOLD ? 'true' : 'false';
  }
  if (peak) peak.style.left = MEDIA.peak + '%';

  // Sustained loudness, not a single spike — a cough should not count.
  const now = Date.now();
  if (rms > MEDIA_NOISE_THRESHOLD) {
    if (!MEDIA.loudSince) MEDIA.loudSince = now;
    else if (now - MEDIA.loudSince > MEDIA_LOUD_MS) {
      MEDIA.noiseEvents++;
      MEDIA.loudSince = now + 900;   // debounce before it can count again
      if (count) count.textContent = String(MEDIA.noiseEvents);
    }
  } else {
    MEDIA.loudSince = 0;
  }
  if (state) {
    const loud = rms > MEDIA_NOISE_THRESHOLD;
    state.textContent = loud ? 'Noise a proctor would flag' : 'Quiet';
    state.className = 'pm-state' + (loud ? ' loud' : '');
  }
}

/* ---- Panel -------------------------------------------------------------- */

function mediaEnsurePanel() {
  if (MEDIA.panel && document.body.contains(MEDIA.panel)) return MEDIA.panel;
  const p = el('div', { class: 'pm-panel', id: 'pmPanel' });
  document.body.appendChild(p);
  MEDIA.panel = p;
  return p;
}

function mediaRender() {
  const p = mediaEnsurePanel();
  clear(p);
  p.dataset.collapsed = MEDIA.collapsed ? 'true' : 'false';

  const head = el('div', { class: 'pm-head' });
  head.appendChild(el('span', { class: 'pm-dot', 'data-on': MEDIA.stream ? 'true' : 'false' }));
  head.appendChild(el('strong', { text: 'Proctor preview' }));
  head.appendChild(el('span', { style: 'flex:1' }));
  head.appendChild(el('button', {
    class: 'pm-icon', type: 'button', title: MEDIA.collapsed ? 'Expand' : 'Collapse',
    text: MEDIA.collapsed ? '▢' : '—',
    onclick: function () { MEDIA.collapsed = !MEDIA.collapsed; mediaRender(); },
  }));
  head.appendChild(el('button', {
    class: 'pm-icon', type: 'button', title: 'Turn off and hide', text: '✕',
    onclick: function () { mediaStop(); mediaHide(); },
  }));
  p.appendChild(head);

  if (MEDIA.collapsed) return;

  const body = el('div', { class: 'pm-body' });

  if (!MEDIA.stream) {
    body.appendChild(el('p', {
      class: 'pm-note',
      text: 'See exactly what the proctor would see and hear. Runs entirely in this browser — nothing is recorded and nothing is sent anywhere.',
    }));
    if (MEDIA.error) body.appendChild(el('p', { class: 'pm-err', text: MEDIA.error }));
    body.appendChild(el('button', {
      class: 'btn btn-sm btn-primary', style: 'width:100%',
      text: 'Turn on camera and mic',
      onclick: function () { mediaStart(); },
    }));
  } else {
    const vidWrap = el('div', { class: 'pm-video-wrap' });
    const v = el('video', { class: 'pm-video', autoplay: true, playsinline: true, muted: true });
    v.muted = true;                     // attribute alone is unreliable across browsers
    v.srcObject = MEDIA.stream;
    vidWrap.appendChild(v);
    vidWrap.appendChild(el('div', { class: 'pm-frame-guide' }));
    body.appendChild(vidWrap);

    body.appendChild(el('div', { class: 'pm-label', text: 'Microphone level' }));
    const meter = el('div', { class: 'pm-meter' });
    meter.appendChild(el('i', { class: 'pm-fill', id: 'pmFill' }));
    meter.appendChild(el('i', { class: 'pm-threshold' }));
    meter.appendChild(el('i', { class: 'pm-peak', id: 'pmPeak' }));
    body.appendChild(meter);

    const row = el('div', { class: 'pm-row' });
    row.appendChild(el('span', { class: 'pm-state', id: 'pmState', text: 'Quiet' }));
    row.appendChild(el('span', { style: 'flex:1' }));
    row.appendChild(el('span', { class: 'pm-note', style: 'margin:0', text: 'Noise events' }));
    row.appendChild(el('span', { class: 'pm-count', id: 'pmNoiseCount', text: String(MEDIA.noiseEvents) }));
    body.appendChild(row);

    body.appendChild(el('p', {
      class: 'pm-note',
      text: 'Keep your face inside the guide, both hands off your face, and the bar below the marked line. Sustained noise past that line is what the real system logs.',
    }));
    body.appendChild(el('button', {
      class: 'btn btn-sm', style: 'width:100%', text: 'Turn off',
      onclick: function () { mediaStop(); },
    }));
  }
  p.appendChild(body);
}

function mediaShow() { mediaEnsurePanel().style.display = 'flex'; mediaRender(); }
function mediaHide() { if (MEDIA.panel) MEDIA.panel.style.display = 'none'; }

// Show only where it is relevant, and cut the camera the moment you leave.
function mediaSync(route) {
  if (route === 'mock' || route === 'r2sim') mediaShow();
  else { if (MEDIA.stream) mediaStop(); mediaHide(); }
}

// Wrap the router so the panel follows navigation without touching go() itself.
const goWithoutMedia = go;
go = function (route, params) {
  goWithoutMedia(route, params);
  mediaSync(route);
};
