/* ==========================================================================
   Proctor preview — local camera view, microphone meter, and frame heuristics
   that approximate what a real proctoring system reacts to.

   Everything stays in the browser: the stream feeds a <video>, an
   AnalyserNode and an offscreen <canvas>. Nothing is recorded, nothing is
   uploaded, and there is no network call anywhere in this file.

   HONEST SCOPE. This is not machine learning and it does not identify
   objects — it cannot tell a phone from a mug. What it measures is:
     - mean brightness                     -> too dark to verify your face
     - luma texture inside the frame guide -> nothing there, you are out of shot
     - deviation from your calibrated baseline -> the view changed and stayed
       changed, i.e. something is parked in front of your face
     - short-term motion                   -> something just moved there
   Deviation is the one that matters: a phone held still produces no motion at
   all, so a motion-only detector goes quiet exactly when the problem persists.
   Deliberately no skin-tone segmentation — the usual RGB rules are markedly
   less reliable on darker skin, and luma texture works regardless.
   ========================================================================== */

const MEDIA = {
  stream: null,
  audioCtx: null, analyser: null, data: null,
  raf: null, panel: null, collapsed: false, notesOpen: false,
  noiseEvents: 0, loudSince: 0, peak: 0,
  error: '',
  canvas: null, cctx: null, prev: null,
  baseline: null,          // { luma, texture }
  baselineFrame: null,     // Uint8Array luma of the calibrated frame
  lastVisionAt: 0,
  darkEvents: 0, absentEvents: 0, occlusionEvents: 0,
  cooldown: { dark: 0, absent: 0, occlusion: 0 },
  status: { dark: false, absent: false, occlusion: false },
  deviateSince: 0, motionSince: 0,
  pos: null,               // { left, top } once dragged
  drag: null,
};

const MEDIA_NOISE_THRESHOLD = 0.11;
const MEDIA_LOUD_MS = 400;
const VISION_W = 96, VISION_H = 72;
const VISION_INTERVAL_MS = 140;
const DARK_LUMA = 46;
const TEXTURE_ABSENT = 11;
const MOTION_DIFF = 17;
const MOTION_MS = 260;
const DEVIATION_DIFF = 20;     // vs the calibrated baseline frame
const DEVIATION_MS = 500;      // must persist — this is what catches a still phone
const EVENT_COOLDOWN_MS = 2500;
const SNAP_MARGIN = 12;

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
  MEDIA.prev = MEDIA.baselineFrame = MEDIA.baseline = null;
  MEDIA.noiseEvents = MEDIA.darkEvents = MEDIA.absentEvents = MEDIA.occlusionEvents = 0;
  MEDIA.peak = 0;

  mediaRender();
  mediaLoop();

  // Self-calibrate once the camera has settled. Requiring a button press to
  // make detection work at all is a trap: the panel looks live, reports zero,
  // and the user reasonably concludes it is broken.
  setTimeout(function () {
    if (MEDIA.stream && !MEDIA.baselineFrame) mediaCalibrate(true);
  }, 2500);
}

function mediaStop() {
  if (MEDIA.raf) { cancelAnimationFrame(MEDIA.raf); MEDIA.raf = null; }
  if (MEDIA.stream) { MEDIA.stream.getTracks().forEach(function (t) { t.stop(); }); MEDIA.stream = null; }
  if (MEDIA.audioCtx) { try { MEDIA.audioCtx.close(); } catch (e) {} MEDIA.audioCtx = null; }
  MEDIA.analyser = null;
  MEDIA.canvas = MEDIA.cctx = MEDIA.prev = MEDIA.baselineFrame = null;
  MEDIA.loudSince = MEDIA.deviateSince = MEDIA.motionSince = 0;
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

/* ---- Vision ------------------------------------------------------------- */

const REG = {
  x0: Math.floor(VISION_W * 0.22), x1: Math.floor(VISION_W * 0.78),
  y0: Math.floor(VISION_H * 0.12), y1: Math.floor(VISION_H * 0.82),
};

function mediaAnalyseFrame(video) {
  if (!MEDIA.cctx || !video) return null;
  try {
    MEDIA.cctx.drawImage(video, 0, 0, VISION_W, VISION_H);
  } catch (e) { return null; }

  const img = MEDIA.cctx.getImageData(0, 0, VISION_W, VISION_H).data;
  const luma = new Uint8Array(VISION_W * VISION_H);
  let total = 0;
  for (let i = 0, p = 0; i < img.length; i += 4, p++) {
    const y = (img[i] * 77 + img[i + 1] * 150 + img[i + 2] * 29) >> 8;
    luma[p] = y;
    total += y;
  }
  const meanLuma = total / luma.length;

  let sum = 0, n = 0;
  for (let y = REG.y0; y < REG.y1; y++) {
    for (let x = REG.x0; x < REG.x1; x++) { sum += luma[y * VISION_W + x]; n++; }
  }
  const regionMean = sum / n;

  let dev = 0, motion = 0, deviation = 0;
  for (let y = REG.y0; y < REG.y1; y++) {
    for (let x = REG.x0; x < REG.x1; x++) {
      const idx = y * VISION_W + x;
      dev += Math.abs(luma[idx] - regionMean);
      if (MEDIA.prev) motion += Math.abs(luma[idx] - MEDIA.prev[idx]);
      if (MEDIA.baselineFrame) deviation += Math.abs(luma[idx] - MEDIA.baselineFrame[idx]);
    }
  }

  const box = mediaSubjectBox(luma);

  MEDIA.prev = luma;
  return {
    luma: meanLuma,
    texture: dev / n,
    motion: MEDIA.prev ? motion / n : 0,
    deviation: MEDIA.baselineFrame ? deviation / n : 0,
    frame: luma,
    box: box,
    flatFraction: MEDIA.lastFlatFraction,
  };
}

/* Subject bounding box from edge density.

   NOT face landmark detection — there is no model here and it does not know
   what a face is. It finds where the structure in the picture is: a person in
   front of a wall produces a dense band of edges, a blank wall produces almost
   none. The 10th-90th percentile of that edge mass is a stable box around
   whatever the subject is, which is enough to judge framing and distance. */
function mediaSubjectBox(luma) {
  const gx = new Float32Array(VISION_W);
  const gy = new Float32Array(VISION_H);
  let totalEdge = 0;

  // Flatness inside the guide, measured independently of any baseline.
  // A face is never uniform — eyes, nostrils, lips and the hairline all
  // generate local gradient. The back of a phone, a book or a hand is.
  let flat = 0, flatN = 0;

  for (let y = 1; y < VISION_H - 1; y++) {
    for (let x = 1; x < VISION_W - 1; x++) {
      const i = y * VISION_W + x;
      const g = Math.abs(luma[i] - luma[i + 1]) + Math.abs(luma[i] - luma[i + VISION_W]);
      if (g > 14) { gx[x] += g; gy[y] += g; totalEdge += g; }
      if (x >= REG.x0 && x < REG.x1 && y >= REG.y0 && y < REG.y1) {
        flatN++;
        if (g < 8) flat++;
      }
    }
  }
  MEDIA.lastFlatFraction = flatN ? flat / flatN : 0;

  if (totalEdge < 2500) return null;   // essentially nothing in frame

  const bounds = function (hist, len) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += hist[i];
    const lo = sum * 0.10, hi = sum * 0.90;
    let run = 0, a = 0, b = len - 1, gotA = false;
    for (let i = 0; i < len; i++) {
      run += hist[i];
      if (!gotA && run >= lo) { a = i; gotA = true; }
      if (run >= hi) { b = i; break; }
    }
    return [a / len, b / len];
  };

  const bx = bounds(gx, VISION_W);
  const by = bounds(gy, VISION_H);
  const w = bx[1] - bx[0], h = by[1] - by[0];
  if (w <= 0.02 || h <= 0.02) return null;
  return { x0: bx[0], y0: by[0], x1: bx[1], y1: by[1], w: w, h: h };
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

  // Framing: where the subject is, and how much of the frame it fills.
  MEDIA.box = f.box;
  MEDIA.status.tooClose = MEDIA.status.tooFar = MEDIA.status.offCentre = false;
  if (f.box) {
    const area = f.box.w * f.box.h;
    MEDIA.status.tooClose = area > 0.62 || f.box.h > 0.86;
    MEDIA.status.tooFar = area < 0.10;
    const cx = (f.box.x0 + f.box.x1) / 2;
    MEDIA.status.offCentre = Math.abs(cx - 0.5) > 0.22;
  }
  mediaDrawBox(f.box);

  // Baseline-free check: a large flat, low-texture area filling the guide is
  // an object, not a face. This still fires when the baseline itself was
  // captured with something already in front of the camera — which is exactly
  // how a baseline-only detector reports nothing while a phone is held up.
  const flatBlocked = f.flatFraction > 0.82 && f.texture < 24;
  MEDIA.flatBlocked = flatBlocked;

  // Sustained deviation from the calibrated view. This is the signal that
  // survives a phone being held perfectly still.
  let occluded = flatBlocked;
  if (MEDIA.baselineFrame && f.deviation > DEVIATION_DIFF) {
    if (!MEDIA.deviateSince) MEDIA.deviateSince = now;
    else if (now - MEDIA.deviateSince > DEVIATION_MS) occluded = true;
  } else {
    MEDIA.deviateSince = 0;
  }

  // Short-term motion still counts, for the moment something swings in.
  if (f.motion > MOTION_DIFF) {
    if (!MEDIA.motionSince) MEDIA.motionSince = now;
    else if (now - MEDIA.motionSince > MOTION_MS) occluded = true;
  } else {
    MEDIA.motionSince = 0;
  }
  MEDIA.status.occlusion = occluded;

  if (MEDIA.status.dark) mediaBump('dark', 'darkEvents');
  if (MEDIA.status.absent) mediaBump('absent', 'absentEvents');
  if (MEDIA.status.occlusion) mediaBump('occlusion', 'occlusionEvents');

  const warn = $('#pmWarn');
  if (warn) {
    const msg = MEDIA.flatBlocked
      ? 'Something flat is covering your face — a phone, a hand or a book. This is what their hand-near-face rule fires on.'
      : MEDIA.status.occlusion
      ? (MEDIA.baselineFrame
          ? 'Your face is blocked or you have moved — this is the pattern behind their hand-near-face rule'
          : 'Movement in front of your face. Press Calibrate for reliable detection.')
      : MEDIA.status.absent
      ? 'Nothing detected in the frame guide — you may be out of shot'
      : MEDIA.status.dark
      ? 'Too dark for a proctor to verify your face — add light in front of you'
      : MEDIA.status.tooClose
      ? 'Too close — sit back so your head and shoulders both fit in frame'
      : MEDIA.status.tooFar
      ? 'Too far — move closer so your face fills more of the frame'
      : MEDIA.status.offCentre
      ? 'Off centre — move so you are in the middle of the frame'
      : '';
    warn.textContent = msg;
    warn.style.display = msg ? 'block' : 'none';
  }
}

/* Draws the subject box over the preview. The video is mirrored in CSS, so
   the overlay is mirrored the same way to stay aligned with what you see. */
function mediaDrawBox(box) {
  const svg = $('#pmBox');
  if (!svg) return;
  if (!box) { svg.style.display = 'none'; return; }
  svg.style.display = 'block';

  const bad = MEDIA.status.tooClose || MEDIA.status.tooFar || MEDIA.status.occlusion || MEDIA.status.offCentre;
  const x = (1 - box.x1) * 100, w = box.w * 100;      // mirrored horizontally
  const y = box.y0 * 100, h = box.h * 100;
  const r = svg.querySelector('rect');
  r.setAttribute('x', x); r.setAttribute('y', y);
  r.setAttribute('width', w); r.setAttribute('height', h);
  svg.dataset.bad = bad ? 'true' : 'false';

  const label = svg.querySelector('text');
  label.setAttribute('x', Math.min(x, 70));
  label.setAttribute('y', Math.max(y - 2, 5));
  label.textContent = MEDIA.status.tooClose ? 'too close'
    : MEDIA.status.tooFar ? 'too far'
    : MEDIA.status.offCentre ? 'off centre'
    : 'subject';
}

// Manual calibration counts down first, so the baseline cannot be captured
// while something is still in front of your face — which silently defeats
// every baseline-relative check afterwards.
function mediaCalibrateCountdown() {
  let n = 3;
  const warn = $('#pmWarn');
  const tick = function () {
    const w = $('#pmWarn');
    if (w) {
      w.style.display = 'block';
      w.textContent = 'Clear your face and look at the camera — capturing in ' + n + '…';
    }
    if (n === 0) { mediaCalibrate(false); return; }
    n--;
    setTimeout(tick, 800);
  };
  if (warn) warn.style.display = 'block';
  tick();
}

function mediaCalibrate(auto) {
  const video = $('#pmVideo');
  MEDIA.baselineFrame = null;          // measure the raw scene, not a delta
  const f = mediaAnalyseFrame(video);
  if (!f) {
    if (!auto) toast('Could not read the camera yet — try again in a second');
    else setTimeout(function () { if (MEDIA.stream && !MEDIA.baselineFrame) mediaCalibrate(true); }, 1500);
    return;
  }
  MEDIA.baseline = { luma: f.luma, texture: f.texture };
  MEDIA.baselineFrame = f.frame.slice(0);
  MEDIA.darkEvents = MEDIA.absentEvents = MEDIA.occlusionEvents = 0;
  MEDIA.deviateSince = MEDIA.motionSince = 0;
  toast(auto
    ? 'Baseline captured — try holding something in front of your face'
    : 'Recalibrated to how you are sitting now');
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

/* ---- Drag and snap ------------------------------------------------------ */

function mediaApplyPos() {
  const p = MEDIA.panel;
  if (!p || !MEDIA.pos) return;
  p.style.left = MEDIA.pos.left + 'px';
  p.style.top = MEDIA.pos.top + 'px';
  p.style.right = 'auto';
  p.style.bottom = 'auto';
}

function mediaClamp(left, top) {
  const p = MEDIA.panel;
  const w = p.offsetWidth, h = p.offsetHeight;
  return {
    left: Math.max(0, Math.min(left, window.innerWidth - w)),
    top: Math.max(0, Math.min(top, window.innerHeight - h)),
  };
}

// Magnet to whichever of the four edges is nearest.
function mediaSnap() {
  const p = MEDIA.panel;
  const r = p.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const d = { left: r.left, right: vw - r.right, top: r.top, bottom: vh - r.bottom };
  const nearest = Object.keys(d).reduce(function (a, b) { return d[b] < d[a] ? b : a; });

  let left = r.left, top = r.top;
  if (nearest === 'left') left = SNAP_MARGIN;
  else if (nearest === 'right') left = vw - r.width - SNAP_MARGIN;
  else if (nearest === 'top') top = SNAP_MARGIN;
  else top = vh - r.height - SNAP_MARGIN;

  MEDIA.pos = mediaClamp(left, top);
  p.dataset.snapping = 'true';
  mediaApplyPos();
  setTimeout(function () { if (MEDIA.panel) MEDIA.panel.dataset.snapping = 'false'; }, 200);

  STATE.mediaPos = MEDIA.pos;
  saveState();
}

function mediaDragStart(e) {
  if (e.target.closest('.pm-icon')) return;   // buttons stay buttons
  const p = MEDIA.panel;
  p.dataset.snapping = 'false';   // kill any in-flight snap so drag tracks the pointer
  const r = p.getBoundingClientRect();
  MEDIA.drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
  MEDIA.pos = { left: r.left, top: r.top };
  mediaApplyPos();
  p.dataset.dragging = 'true';
  try { e.target.setPointerCapture(e.pointerId); } catch (err) {}
  e.preventDefault();
}

function mediaDragMove(e) {
  if (!MEDIA.drag) return;
  MEDIA.pos = mediaClamp(e.clientX - MEDIA.drag.dx, e.clientY - MEDIA.drag.dy);
  mediaApplyPos();
}

function mediaDragEnd() {
  if (!MEDIA.drag) return;
  MEDIA.drag = null;
  if (MEDIA.panel) MEDIA.panel.dataset.dragging = 'false';
  mediaSnap();
}

window.addEventListener('pointermove', mediaDragMove);
window.addEventListener('pointerup', mediaDragEnd);
window.addEventListener('pointercancel', mediaDragEnd);
window.addEventListener('resize', function () {
  if (MEDIA.pos && MEDIA.panel) { MEDIA.pos = mediaClamp(MEDIA.pos.left, MEDIA.pos.top); mediaApplyPos(); }
});

/* ---- Panel -------------------------------------------------------------- */

function mediaEnsurePanel() {
  if (MEDIA.panel && document.body.contains(MEDIA.panel)) return MEDIA.panel;
  const p = el('div', { class: 'pm-panel', id: 'pmPanel' });
  document.body.appendChild(p);
  MEDIA.panel = p;
  if (!MEDIA.pos && STATE.mediaPos) MEDIA.pos = STATE.mediaPos;
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

  const head = el('div', { class: 'pm-head', title: 'Drag to move — releases snap to the nearest edge' });
  head.addEventListener('pointerdown', mediaDragStart);
  head.appendChild(el('span', { class: 'pm-grip', text: '⠿' }));
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
  if (MEDIA.pos) mediaApplyPos();
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

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('id', 'pmBox');
  svg.setAttribute('class', 'pm-box');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.display = 'none';
  const rect = document.createElementNS(svgNS, 'rect');
  rect.setAttribute('rx', '3');
  rect.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.appendChild(rect);
  const label = document.createElementNS(svgNS, 'text');
  label.setAttribute('class', 'pm-box-label');
  svg.appendChild(label);
  vidWrap.appendChild(svg);

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
    class: 'btn btn-sm' + (MEDIA.baselineFrame ? '' : ' btn-primary'), style: 'flex:1',
    text: MEDIA.baselineFrame ? 'Recalibrate' : 'Calibrate',
    title: 'Counts down, then captures a baseline of your clear face',
    onclick: mediaCalibrateCountdown,
  }));
  btns.appendChild(el('button', { class: 'btn btn-sm', style: 'flex:1', text: 'Turn off', onclick: function () { mediaStop(); } }));
  body.appendChild(btns);

  // Explanatory text, collapsed by default so the panel stays small.
  const notes = el('div', { class: 'pm-notes' });
  const toggle = el('button', {
    class: 'pm-notes-toggle', type: 'button',
    onclick: function () { MEDIA.notesOpen = !MEDIA.notesOpen; mediaRender(); },
  });
  toggle.appendChild(el('span', { class: 'pm-caret', text: MEDIA.notesOpen ? '▾' : '▸' }));
  toggle.appendChild(el('span', { text: MEDIA.notesOpen ? 'Hide details' : 'How this works' }));
  notes.appendChild(toggle);
  if (MEDIA.notesOpen) {
    notes.appendChild(el('p', {
      class: 'pm-note',
      text: MEDIA.baselineFrame
        ? 'Calibrated. Every frame is compared against how you were sitting, so something parked in front of your face is caught even when it is perfectly still.'
        : 'Press Calibrate while sitting normally. Without a baseline only movement is detectable — a phone held still registers nothing.',
    }));
    notes.appendChild(el('p', {
      class: 'pm-note',
      text: 'The green box is a subject outline built from edge density — where the structure in the picture is. It is not face-landmark tracking and there is no model here: it cannot tell a phone from a mug. What it does know is brightness, how much of the frame you fill, whether you are centred, and how far the view has drifted from your baseline. That last one is what catches something held still in front of your face.',
    }));
  }
  body.appendChild(notes);

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
