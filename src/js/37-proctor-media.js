/* ==========================================================================
   Proctor preview — local camera view, microphone level meter, and a set of
   frame heuristics that approximate what a real proctoring system reacts to.

   Everything stays in the browser: the stream feeds a <video>, an
   AnalyserNode and an offscreen <canvas>. Nothing is recorded, nothing is
   uploaded, and there is no network call anywhere in this file.

   HONEST SCOPE — read this before trusting the warnings.
   This is not machine learning and it does not identify objects. It cannot
   tell a phone from a mug. What it measures is:
     - overall brightness              -> "too dark to verify your face"
     - texture inside the frame guide  -> "nothing there, you may be out of shot"
     - sudden movement in that region  -> "something moved in front of your face"
   That last one is the useful proxy: the guidelines warn that resting a hand
   near your face can trigger a "mobile phone detected" violation, and the
   physical event behind it is exactly an occlusion of the face region.
   Deliberately no skin-tone detection — the usual RGB rules are markedly less
   reliable on darker skin, and luma texture works for everyone.
   ========================================================================== */

const MEDIA = {
  stream: null,
  audioCtx: null, analyser: null, data: null,
  raf: null, panel: null, collapsed: false,
  noiseEvents: 0, loudSince: 0, peak: 0,
  error: '',
  // vision
  canvas: null, cctx: null, prev: null,
  baseline: null,          // { luma, texture } captured by Calibrate
  lastVisionAt: 0,
  darkEvents: 0, absentEvents: 0, occlusionEvents: 0,
  cooldown: { dark: 0, absent: 0, occlusion: 0 },
  status: { dark: false, absent: false, occlusion: false },
  occludeSince: 0,
};

const MEDIA_NOISE_THRESHOLD = 0.11;
const MEDIA_LOUD_MS = 400;
const VISION_W = 96, VISION_H = 72;
const VISION_INTERVAL_MS = 160;          // ~6 fps is plenty and costs little
const DARK_LUMA = 46;
const TEXTURE_ABSENT = 11;
const OCCLUSION_DIFF = 17;
const OCCLUSION_MS = 280;
const EVENT_COOLDOWN_MS = 2500;

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

  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    MEDIA.audioCtx = new Ctx();
    if (MEDIA.audioCtx.state === 'suspended') await MEDIA.audioCtx.resume();
    const source = MEDIA.audioCtx.createMediaStreamSource(MEDIA.stream);
    MEDIA.analyser = MEDIA.audioCtx.createAnalyser();
    MEDIA.analyser.fftSize = 1024;
    MEDIA.analyser.smoothingTimeConstant = 0.6;
    source.connect(MEDIA.analyser);   // NOT connected to destination — no feedback loop
    MEDIA.data = new Uint8Array(MEDIA.analyser.fftSize);
  } catch (e) {
    MEDIA.analyser = null;
  }

  MEDIA.canvas = document.createElement('canvas');
  MEDIA.canvas.width = VISION_W;
  MEDIA.canvas.height = VISION_H;
  MEDIA.cctx = MEDIA.canvas.getContext('2d', { willReadFrequently: true });
  MEDIA.prev = null;
  MEDIA.baseline = null;
  MEDIA.noiseEvents = MEDIA.darkEvents = MEDIA.absentEvents = MEDIA.occlusionEvents = 0;
  MEDIA.peak = 0;

  mediaRender();
  mediaLoop();
}

function mediaStop() {
  if (MEDIA.raf) { cancelAnimationFrame(MEDIA.raf); MEDIA.raf = null; }
  if (MEDIA.stream) { MEDIA.stream.getTracks().forEach(function (t) { t.stop(); }); MEDIA.stream = null; }
  if (MEDIA.audioCtx) { try { MEDIA.audioCtx.close(); } catch (e) {} MEDIA.audioCtx = null; }
  MEDIA.analyser = null;
  MEDIA.canvas = MEDIA.cctx = MEDIA.prev = null;
  MEDIA.loudSince = 0;
  MEDIA.status = { dark: false, absent: false, occlusion: false };
  mediaRender();
}

/* ---- Audio -------------------------------------------------------------- */

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

/* ---- Vision heuristics -------------------------------------------------- */

// Returns { luma, texture, motion } for the frame-guide region, or null.
function mediaAnalyseFrame(video) {
  if (!MEDIA.cctx || !video || video.readyState < 2) return null;
  try {
    MEDIA.cctx.drawImage(video, 0, 0, VISION_W, VISION_H);
  } catch (e) { return null; }

  const img = MEDIA.cctx.getImageData(0, 0, VISION_W, VISION_H).data;
  const luma = new Uint8Array(VISION_W * VISION_H);
  let total = 0;
  for (let i = 0, p = 0; i < img.length; i += 4, p++) {
    // Rec. 601 luma, integer-ish for speed
    const y = (img[i] * 77 + img[i + 1] * 150 + img[i + 2] * 29) >> 8;
    luma[p] = y;
    total += y;
  }
  const meanLuma = total / luma.length;

  // Frame-guide region, matching the dashed overlay in the CSS.
  const x0 = Math.floor(VISION_W * 0.22), x1 = Math.floor(VISION_W * 0.78);
  const y0 = Math.floor(VISION_H * 0.12), y1 = Math.floor(VISION_H * 0.82);

  let sum = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) { sum += luma[y * VISION_W + x]; n++; }
  }
  const regionMean = sum / n;

  // Texture = mean absolute deviation. A face has structure; a blank wall does not.
  let dev = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) dev += Math.abs(luma[y * VISION_W + x] - regionMean);
  }
  const texture = dev / n;

  // Motion = mean absolute difference against the previous sampled frame.
  let motion = 0;
  if (MEDIA.prev) {
    let d = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const idx = y * VISION_W + x;
        d += Math.abs(luma[idx] - MEDIA.prev[idx]);
      }
    }
    motion = d / n;
  }
  MEDIA.prev = luma;
  return { luma: meanLuma, texture: texture, motion: motion };
}

function mediaBump(kind, counterKey) {
  const now = Date.now();
  if (now < MEDIA.cooldown[kind]) return;
  MEDIA.cooldown[kind] = now + EVENT_COOLDOWN_MS;
  MEDIA[counterKey]++;
  const node = $('#pm-' + kind);
  if (node) node.textContent = String(MEDIA[counterKey]);
}

function mediaVision(video) {
  const now = Date.now();
  if (now - MEDIA.lastVisionAt < VISION_INTERVAL_MS) return;
  MEDIA.lastVisionAt = now;

  const f = mediaAnalyseFrame(video);
  if (!f) return;

  const darkLimit = MEDIA.baseline ? Math.min(DARK_LUMA, MEDIA.baseline.luma * 0.55) : DARK_LUMA;
  const textureLimit = MEDIA.baseline ? MEDIA.baseline.texture * 0.45 : TEXTURE_ABSENT;

  MEDIA.status.dark = f.luma < darkLimit;
  MEDIA.status.absent = f.texture < textureLimit;

  if (f.motion > OCCLUSION_DIFF) {
    if (!MEDIA.occludeSince) MEDIA.occludeSince = now;
    else if (now - MEDIA.occludeSince > OCCLUSION_MS) { MEDIA.status.occlusion = true; }
  } else {
    MEDIA.occludeSince = 0;
    MEDIA.status.occlusion = false;
  }

  if (MEDIA.status.dark) mediaBump('dark', 'darkEvents');
  if (MEDIA.status.absent) mediaBump('absent', 'absentEvents');
  if (MEDIA.status.occlusion) mediaBump('occlusion', 'occlusionEvents');

  const warn = $('#pmWarn');
  if (warn) {
    const msg = MEDIA.status.occlusion
      ? 'Something moved in front of your face — this is the hand-near-face pattern their system flags'
      : MEDIA.status.absent
      ? 'Nothing detected in the frame guide — you may be out of shot'
      : MEDIA.status.dark
      ? 'Too dark for a proctor to verify your face — add light in front of you'
      : '';
    warn.textContent = msg;
    warn.style.display = msg ? 'block' : 'none';
  }
}

function mediaCalibrate(video) {
  const f = mediaAnalyseFrame(video);
  if (!f) { toast('Could not read the camera yet — try again in a second'); return; }
  MEDIA.baseline = { luma: f.luma, texture: f.texture };
  MEDIA.darkEvents = MEDIA.absentEvents = MEDIA.occlusionEvents = 0;
  toast('Calibrated to how you are sitting now');
  mediaRender();
}

/* ---- Loop --------------------------------------------------------------- */

function mediaLoop() {
  MEDIA.raf = requestAnimationFrame(mediaLoop);
  if (!MEDIA.stream) return;

  const rms = mediaLevel();
  const pct = Math.min(100, rms * 320);
  MEDIA.peak = Math.max(MEDIA.peak * 0.94, pct);

  const fill = $('#pmFill'), peak = $('#pmPeak'), state = $('#pmState');
  if (fill) {
    fill.style.width = pct + '%';
    fill.dataset.loud = rms > MEDIA_NOISE_THRESHOLD ? 'true' : 'false';
  }
  if (peak) peak.style.left = MEDIA.peak + '%';

  const now = Date.now();
  if (rms > MEDIA_NOISE_THRESHOLD) {
    if (!MEDIA.loudSince) MEDIA.loudSince = now;
    else if (now - MEDIA.loudSince > MEDIA_LOUD_MS) {
      MEDIA.loudSince = now + 900;
      MEDIA.noiseEvents++;
      const c = $('#pm-noise');
      if (c) c.textContent = String(MEDIA.noiseEvents);
    }
  } else {
    MEDIA.loudSince = 0;
  }
  if (state) {
    const loud = rms > MEDIA_NOISE_THRESHOLD;
    state.textContent = loud ? 'Noise a proctor would flag' : 'Quiet';
    state.className = 'pm-state' + (loud ? ' loud' : '');
  }

  const v = $('#pmVideo');
  if (v) mediaVision(v);
}

/* ---- Panel -------------------------------------------------------------- */

function mediaEnsurePanel() {
  if (MEDIA.panel && document.body.contains(MEDIA.panel)) return MEDIA.panel;
  const p = el('div', { class: 'pm-panel', id: 'pmPanel' });
  document.body.appendChild(p);
  MEDIA.panel = p;
  return p;
}

function mediaStat(kind, label, count) {
  const s = el('div', { class: 'pm-stat' });
  s.appendChild(el('span', { class: 'pm-stat-label', text: label }));
  s.appendChild(el('span', { class: 'pm-count', id: 'pm-' + kind, text: String(count) }));
  return s;
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
      text: 'See what the proctor would see and hear. Runs entirely in this browser — nothing is recorded, nothing is sent anywhere.',
    }));
    if (MEDIA.error) body.appendChild(el('p', { class: 'pm-err', text: MEDIA.error }));
    body.appendChild(el('button', {
      class: 'btn btn-sm btn-primary', style: 'width:100%',
      text: 'Turn on camera and mic', onclick: function () { mediaStart(); },
    }));
    p.appendChild(body);
    return;
  }

  const vidWrap = el('div', { class: 'pm-video-wrap' });
  const v = el('video', { class: 'pm-video', id: 'pmVideo', autoplay: true, playsinline: true, muted: true });
  v.muted = true;
  v.srcObject = MEDIA.stream;
  vidWrap.appendChild(v);
  vidWrap.appendChild(el('div', { class: 'pm-frame-guide' }));
  body.appendChild(vidWrap);

  body.appendChild(el('div', { class: 'pm-warn', id: 'pmWarn', style: 'display:none' }));

  body.appendChild(el('div', { class: 'pm-label', text: 'Microphone level' }));
  const meter = el('div', { class: 'pm-meter' });
  meter.appendChild(el('i', { class: 'pm-fill', id: 'pmFill' }));
  meter.appendChild(el('i', { class: 'pm-threshold' }));
  meter.appendChild(el('i', { class: 'pm-peak', id: 'pmPeak' }));
  body.appendChild(meter);
  body.appendChild(el('span', { class: 'pm-state', id: 'pmState', text: 'Quiet' }));

  body.appendChild(el('div', { class: 'pm-label', style: 'margin-top:2px', text: 'Flags so far' }));
  const stats = el('div', { class: 'pm-stats' });
  stats.appendChild(mediaStat('noise', 'Noise', MEDIA.noiseEvents));
  stats.appendChild(mediaStat('occlusion', 'Face blocked', MEDIA.occlusionEvents));
  stats.appendChild(mediaStat('absent', 'Out of shot', MEDIA.absentEvents));
  stats.appendChild(mediaStat('dark', 'Too dark', MEDIA.darkEvents));
  body.appendChild(stats);

  const btns = el('div', { style: 'display:flex;gap:6px' });
  btns.appendChild(el('button', {
    class: 'btn btn-sm', style: 'flex:1',
    text: MEDIA.baseline ? 'Recalibrate' : 'Calibrate',
    title: 'Sit as you will during the test, then press this to set the baseline',
    onclick: function () { mediaCalibrate($('#pmVideo')); },
  }));
  btns.appendChild(el('button', { class: 'btn btn-sm', style: 'flex:1', text: 'Turn off', onclick: function () { mediaStop(); } }));
  body.appendChild(btns);

  body.appendChild(el('p', {
    class: 'pm-note',
    text: MEDIA.baseline
      ? 'Calibrated. Warnings are now measured against how you were sitting.'
      : 'Press Calibrate while sitting normally — the warnings get much more accurate once they have a baseline.',
  }));
  body.appendChild(el('p', {
    class: 'pm-note', style: 'opacity:.8',
    text: 'Heuristics, not object recognition: brightness, texture in the guide, and movement in front of your face. It cannot tell a phone from a mug — it tells you when your face gets blocked, which is what their rule fires on.',
  }));

  p.appendChild(body);
}

function mediaShow() { mediaEnsurePanel().style.display = 'flex'; mediaRender(); }
function mediaHide() { if (MEDIA.panel) MEDIA.panel.style.display = 'none'; }

function mediaSync(route) {
  if (route === 'mock' || route === 'r2sim') mediaShow();
  else { if (MEDIA.stream) mediaStop(); mediaHide(); }
}

const goWithoutMedia = go;
go = function (route, params) {
  goWithoutMedia(route, params);
  mediaSync(route);
};
