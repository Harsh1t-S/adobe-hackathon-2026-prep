/* ==========================================================================
   Round 1 simulation — built to the OFFICIAL Unstop SmartHire guidelines for
   this assessment, not to the generic palette-style exam most people picture.

   The mechanics that actually matter, straight from the guidelines:
     - 17 questions, 1 hour, "Time per Question: 00:01:00", auto-advance.
     - "You won't be able to browse through the questions. If you either skip
       your question or submit your answer, it is marked and stored, and cannot
       be altered."
     - Marks are split between ACCURACY and SPEED, where speed marks scale with
       the percentage of the question's time still remaining.
     - Sections can be switched from a section tab; once a section's time is
       over you cannot answer any more of its questions.

   Overrides ROUTES.mock defined earlier — this file sorts last on purpose.
   ========================================================================== */

const EX_MCQ_COUNT = 15;
const EX_CODE_COUNT = 2;
const EX_MCQ_PER_Q_MS = 60 * 1000;          // "Time per Question: 00:01:00"
const EX_CODE_PER_Q_MS = 22 * 60 * 1000 + 30 * 1000;  // 45 min across 2 problems
const EX_MARKS_PER_Q = 4;                   // matches the worked example in the guidelines
const EX_VIOLATION_LIMIT = 3;

let EX = null;
let EX_TICK = null;

function exStop() { if (EX_TICK) { clearInterval(EX_TICK); EX_TICK = null; } }

/* In-app confirm. Native confirm()/alert() blur the window, which the proctor
   listener then reports as a violation — the dialog would flag you for using
   the dialog. This one never leaves the document. */
function exConfirm(message, onYes) {
  exSuppressProctor(1200);
  const back = el('div', { class: 'modal-back' });
  const close = function () { back.remove(); exSuppressProctor(600); };
  const m = el('div', { class: 'modal' });
  m.appendChild(el('h2', { text: 'Confirm' }));
  m.appendChild(el('p', { text: message }));
  const row = el('div', { style: 'display:flex;gap:9px;flex-wrap:wrap' });
  const yes = el('button', { class: 'btn btn-primary', text: 'Yes, continue', onclick: function () { close(); onYes(); } });
  row.appendChild(yes);
  row.appendChild(el('button', { class: 'btn', text: 'Cancel', onclick: close }));
  m.appendChild(row);
  back.appendChild(m);
  back.addEventListener('click', function (e) { if (e.target === back) close(); });
  document.body.appendChild(back);
  setTimeout(function () { yes.focus(); }, 20);
}

// Brief window in which focus changes are ours, not the candidate's.
function exSuppressProctor(ms) {
  if (EX) EX.suppressUntil = Date.now() + (ms || 800);
}

/* ---- Setup -------------------------------------------------------------- */

function exNew() {
  const byTopic = {};
  APP.mcq.forEach(function (q) { (byTopic[q.topic] = byTopic[q.topic] || []).push(q); });
  const seed = (Date.now() % 65521) + 3;

  const picked = [];
  Object.keys(byTopic).forEach(function (t) {
    const pool = shuffle(byTopic[t], seed + t.length);
    if (pool.length) picked.push(pool[0]);
  });
  const rest = shuffle(APP.mcq.filter(function (q) { return picked.indexOf(q) === -1; }), seed);
  let i = 0;
  while (picked.length < EX_MCQ_COUNT && i < rest.length) picked.push(rest[i++]);

  const rank = { easy: 0, medium: 1, hard: 2 };
  const codeQs = shuffle(APP.coding.slice(), seed + 41)
    .sort(function (a, b) { return (rank[a.difficulty] || 1) - (rank[b.difficulty] || 1); })
    .slice(0, EX_CODE_COUNT);

  return {
    phase: 'instructions',
    agreed: false,
    section: 'A',
    mcqQs: shuffle(picked, seed + 11).slice(0, EX_MCQ_COUNT),
    codeQs: codeQs,
    // per-question records: { answer, correct, msUsed, submitted, skipped }
    recA: {},
    recB: {},
    curA: 0,
    curB: 0,
    qStartedAt: 0,
    sectionAEndsAt: 0,
    sectionBEndsAt: 0,
    codeLang: 'python',
    violations: [],
    warnOpen: false,
    startedAt: 0,
  };
}

function exSectionDone(s) {
  if (s === 'A') return EX.curA >= EX_MCQ_COUNT;
  return EX.curB >= EX_CODE_COUNT;
}
function exAllDone() { return exSectionDone('A') && exSectionDone('B'); }

function exPerQMs() { return EX.section === 'A' ? EX_MCQ_PER_Q_MS : EX_CODE_PER_Q_MS; }
function exCur() { return EX.section === 'A' ? EX.curA : EX.curB; }
function exRec() { return EX.section === 'A' ? EX.recA : EX.recB; }

function exStart() {
  EX.phase = 'live';
  EX.startedAt = Date.now();
  EX.sectionAEndsAt = Date.now() + EX_MCQ_COUNT * EX_MCQ_PER_Q_MS;
  EX.sectionBEndsAt = Date.now() + EX_MCQ_COUNT * EX_MCQ_PER_Q_MS + EX_CODE_COUNT * EX_CODE_PER_Q_MS;
  EX.qStartedAt = Date.now();
  exRequestFullscreen();
  exAttachProctor();
  go('mock');
}

/* ---- Commit and advance ------------------------------------------------- */

// The single irreversible action. Once this runs for a question, that question
// is closed forever — exactly as the guidelines describe.
function exCommit(answer, skipped) {
  const idx = exCur();
  const rec = exRec();
  if (rec[idx] && rec[idx].submitted) return;

  const perQ = exPerQMs();
  const msUsed = Math.min(perQ, Date.now() - EX.qStartedAt);
  const remainingFrac = Math.max(0, (perQ - msUsed) / perQ);

  let correct = false;
  if (EX.section === 'A' && !skipped && answer !== undefined && answer !== null) {
    correct = answer === EX.mcqQs[idx].answerIndex;
  }

  // Accuracy is half the marks; speed is the other half, scaled by the time
  // left. Speed is only credited on a correct answer — the guidelines show the
  // worked example only for a correct answer, and any other reading would make
  // instant wrong guessing optimal, which no assessment would intend.
  const accuracyMarks = correct ? EX_MARKS_PER_Q / 2 : 0;
  const speedMarks = correct ? (EX_MARKS_PER_Q / 2) * remainingFrac : 0;

  rec[idx] = {
    answer: skipped ? null : answer,
    correct: correct,
    msUsed: msUsed,
    remainingFrac: remainingFrac,
    accuracyMarks: accuracyMarks,
    speedMarks: speedMarks,
    submitted: true,
    skipped: !!skipped,
  };

  if (EX.section === 'A') EX.curA++; else EX.curB++;
  EX.qStartedAt = Date.now();

  if (exAllDone()) { exFinish(); return; }
  if (exSectionDone(EX.section)) {
    EX.section = EX.section === 'A' ? 'B' : 'A';
    toast('Section complete — moving to Section ' + EX.section);
  }
  go('mock');
}

function exSwitchSection(to) {
  if (to === EX.section || exSectionDone(to)) return;
  // Switching mid-question forfeits the elapsed time on the current one, the
  // same way it would on the real platform. Warn, do not silently absorb it.
  exConfirm('Switch to Section ' + to + '? The time already spent on this question is not returned.', function () {
    EX.section = to;
    EX.qStartedAt = Date.now();
    go('mock');
  });
}

function exFinish() {
  exStop();
  exDetachProctor();
  exExitFullscreen();

  let acc = 0, spd = 0, right = 0;
  EX.mcqQs.forEach(function (q, i) {
    const r = EX.recA[i];
    const mrec = mcqRec(q.id);
    mrec.seen = (mrec.seen || 0) + 1;
    if (!r) return;
    acc += r.accuracyMarks; spd += r.speedMarks;
    if (r.correct) { right++; mrec.correct++; } else if (!r.skipped) { mrec.wrong++; }
  });
  EX.accuracyMarks = acc;
  EX.speedMarks = spd;
  EX.rightCount = right;
  EX.maxMarks = EX_MCQ_COUNT * EX_MARKS_PER_Q;

  STATE.mocks.push({
    at: Date.now(), score: right, total: EX_MCQ_COUNT,
    elapsedMs: Date.now() - EX.startedAt,
    marks: Math.round((acc + spd) * 10) / 10,
    violations: EX.violations.length,
  });
  saveState();
  EX.phase = 'done';
  go('mock');
}

/* ---- Proctoring --------------------------------------------------------- */

function exRequestFullscreen() {
  const root = document.documentElement;
  const fn = root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen;
  if (fn) { try { fn.call(root); } catch (e) { /* needs a user gesture */ } }
}
function exExitFullscreen() {
  if (document.fullscreenElement && document.exitFullscreen) {
    try { document.exitFullscreen(); } catch (e) { /* ignore */ }
  }
}

function exLogViolation(type) {
  if (!EX || EX.phase !== 'live') return;
  if (EX.suppressUntil && Date.now() < EX.suppressUntil) return;   // our own dialog
  const last = EX.violations[EX.violations.length - 1];
  if (last && Date.now() - last.at < 1500) return;   // one act, one event
  EX.violations.push({ at: Date.now(), type: type });
  const badge = $('#shProctor');
  if (badge) {
    badge.className = 'sh-proctor alert';
    clear(badge);
    badge.appendChild(el('i', { class: 'dot' }));
    badge.appendChild(el('span', { text: EX.violations.length + ' violation' + (EX.violations.length > 1 ? 's' : '') }));
  }
  exShowViolation(type);
}

function exShowViolation(type) {
  if (EX.warnOpen) return;
  EX.warnOpen = true;
  const n = EX.violations.length;
  const back = el('div', { class: 'modal-back sh-violation-modal' });
  const m = el('div', { class: 'modal' });
  m.appendChild(el('h2', { text: 'Proctoring violation' }));
  m.appendChild(el('p', {
    text: (type === 'tab' ? 'You switched away from the assessment.'
      : type === 'blur' ? 'The assessment window lost focus.'
      : 'You exited fullscreen.') + ' Violation ' + n + '.',
  }));
  m.appendChild(el('p', {
    class: 'lede', style: 'font-size:.86rem',
    text: n >= EX_VIOLATION_LIMIT
      ? 'The official guidelines state that exiting fullscreen, switching tabs or minimising "may lead to warnings and eventually termination of your assessment." At this point a real attempt could be terminated.'
      : 'Official wording: exiting fullscreen, switching tabs or minimising the window "may lead to warnings and eventually termination of your assessment."',
  }));
  m.appendChild(el('p', {
    class: 'lede', style: 'font-size:.86rem',
    text: 'The clock on your current question did not stop while this was open.',
  }));
  const btn = el('button', {
    class: 'btn btn-primary', text: 'Return to the assessment',
    onclick: function () { back.remove(); EX.warnOpen = false; if (EX.phase === 'live') exRequestFullscreen(); },
  });
  m.appendChild(btn);
  back.appendChild(m);
  document.body.appendChild(back);
  setTimeout(function () { btn.focus(); }, 20);
}

function exOnVisibility() { if (document.hidden) exLogViolation('tab'); }
function exOnFsChange() { if (!document.fullscreenElement) exLogViolation('fullscreen'); }

// Deliberately NOT listening to window blur. Blur fires for in-page dialogs,
// iframe focus changes and devtools, none of which are the candidate leaving
// the test — in an embedded viewer it produced constant false violations.
// visibilitychange is the reliable "you actually left" signal.
function exAttachProctor() {
  document.addEventListener('visibilitychange', exOnVisibility);
  document.addEventListener('fullscreenchange', exOnFsChange);
}
function exDetachProctor() {
  document.removeEventListener('visibilitychange', exOnVisibility);
  document.removeEventListener('fullscreenchange', exOnFsChange);
}

/* ---- Instructions ------------------------------------------------------- */

function exInstructions() {
  const wrap = el('div', { class: 'sh-instructions' });
  const card = el('div', { class: 'sh-inst-card' });
  card.appendChild(el('h1', { text: 'Assessment guidelines' }));
  card.appendChild(el('p', { class: 'lede', text: 'Taken from the official guidelines on the Unstop listing for this assessment. The rules below are what make this paper different from a normal exam.' }));

  card.appendChild(mdBlock([
    '### Timelines and questions',
    '',
    '| | |',
    '|---|---|',
    '| Assessment window | 09 Aug 26, 02:00 PM IST → 10 Aug 26, 02:00 PM IST |',
    '| Assessment duration | 01:00:00 |',
    '| Total questions | 17 (15 MCQ + 2 coding) |',
    '| Time per question | 00:01:00 |',
    '',
    'You may start any time inside the window, but to get the **complete duration you must start by 10 Aug 26, 02:00 PM IST**. Once you start, the timer does not stop.',
    '',
    '### The three rules that decide your score',
    '',
    '**1. You cannot go back.** *"You won\'t be able to browse through the questions. If you either skip your question or submit your answer, it is marked and stored, and cannot be altered."* There is no review, no palette, no changing your mind.',
    '',
    '**2. You must submit each answer.** *"You have to submit answers/code/solutions to all the questions individually. Otherwise your response will NOT be recorded."* Selecting an option is not submitting it.',
    '',
    '**3. Speed is marked, not just accuracy.** From the official example: a 4-mark question with a 120-second timer, answered correctly in 30 seconds, scores **2 for accuracy and 1.5 for speed = 3.5**, because 75% of the time remained. Sitting on a question you have already solved actively costs you marks.',
    '',
    '### Sections',
    '',
    'You can switch section from the section tab above the questions. Once a section\'s time is over you cannot answer any more of its questions.',
    '',
    '### Proctoring — the real assessment',
    '',
    '- Runs **only in the Unstop SmartHire app**, on a **desktop or laptop**. Phones and tablets are not supported.',
    '- **Fullscreen is mandatory.** Exiting it, switching tabs or minimising "may lead to warnings and eventually termination of your assessment."',
    '- **Webcam and microphone required.** Audio is monitored constantly — background noise, multiple voices or disturbances count as violations.',
    '- **No external displays.** No screen sharing. Keep the window maximised.',
    '- **No WhatsApp, Discord, Chrome, ChatGPT or similar open** — this causes an automatic exit and is flagged.',
    '- Avoid clothing with images or logos. **Do not rest your hand on your face** — it can trigger a "mobile phone detected" violation.',
    '',
    '**Check your setup now.** The *Proctor preview* panel in the bottom-right corner turns on your camera and microphone so you can see your framing and watch the noise level before it matters. It is opt-in, runs entirely in this browser, records nothing and uploads nothing — use it to find out that your room is too loud *now* rather than at question 6.',
    '',
    '> This simulation reproduces the timing, the no-going-back rule and the speed marking, and it logs tab switches and fullscreen exits. The camera preview is optional and local; nothing leaves your browser.',
  ].join('\n')));

  const agree = el('label', { class: 'sh-agree' });
  const cb = el('input', { type: 'checkbox' });
  cb.checked = EX.agreed;
  cb.addEventListener('change', function () { EX.agreed = cb.checked; startBtn.disabled = !cb.checked; });
  agree.appendChild(cb);
  agree.appendChild(el('span', { text: 'I understand that I cannot return to a question once I submit or skip it, that I must submit every answer, and that answering faster earns more marks.' }));
  card.appendChild(agree);

  const row = el('div', { style: 'display:flex;gap:9px;margin-top:18px;flex-wrap:wrap' });
  const startBtn = el('button', { class: 'btn btn-primary btn-lg', text: 'Start the assessment', disabled: !EX.agreed, onclick: exStart });
  row.appendChild(startBtn);
  row.appendChild(el('button', { class: 'btn', text: 'Back', onclick: function () { EX = null; go('dashboard'); } }));
  card.appendChild(row);

  wrap.appendChild(card);
  return wrap;
}

/* ---- Live assessment ---------------------------------------------------- */

function exLiveView() {
  const shell = el('div', { class: 'sh-shell' });

  // --- top bar
  const bar = el('div', { class: 'sh-top' });
  const brand = el('div', { class: 'sh-brand' });
  brand.appendChild(el('span', { class: 'glyph', text: 'A' }));
  brand.appendChild(el('span', { text: 'Online Assessment — Adobe University Hackathon 2026' }));
  bar.appendChild(brand);
  bar.appendChild(el('span', { class: 'spacer' }));

  const proctor = el('div', { class: 'sh-proctor' + (EX.violations.length ? ' alert' : ''), id: 'shProctor' });
  proctor.appendChild(el('i', { class: 'dot' }));
  proctor.appendChild(el('span', { text: EX.violations.length ? EX.violations.length + ' violation' + (EX.violations.length > 1 ? 's' : '') : 'Proctoring on' }));
  bar.appendChild(proctor);

  const totalBox = el('div', { class: 'sh-clock-box' });
  totalBox.appendChild(el('span', { class: 'lbl', text: 'Section left' }));
  // Paint the initial values here rather than waiting for the first tick,
  // so the clocks are never blank on the frame the question appears.
  totalBox.appendChild(el('span', {
    class: 'sh-clock', id: 'shSectionClock', style: 'font-size:1rem',
    text: fmtClock((EX.section === 'A' ? EX.sectionAEndsAt : EX.sectionBEndsAt) - Date.now()),
  }));
  bar.appendChild(totalBox);

  const qBox = el('div', { class: 'sh-clock-box', style: 'border-color:var(--accent-line);background:var(--accent-soft)' });
  qBox.appendChild(el('span', { class: 'lbl', text: 'This question' }));
  qBox.appendChild(el('span', {
    class: 'sh-clock', id: 'shQClock',
    text: fmtClock(exPerQMs() - (Date.now() - EX.qStartedAt)),
  }));
  bar.appendChild(qBox);

  // Way out. The real platform has no exit, but this is practice — being
  // trapped for 17 questions with no escape is a bug, not realism.
  bar.appendChild(el('button', {
    class: 'btn btn-sm btn-ghost', title: 'Abandon this attempt', text: 'Exit',
    onclick: function () {
      exConfirm('Abandon this attempt? Your answers so far are discarded and nothing is saved.', function () {
        exStop(); exDetachProctor(); exExitFullscreen();
        EX = null; go('dashboard');
      });
    },
  }));
  shell.appendChild(bar);

  // --- section tabs (switchable, per the guidelines)
  const tabs = el('div', { class: 'sh-sections' });
  [['A', 'Section A · MCQ · ' + EX.curA + '/' + EX_MCQ_COUNT], ['B', 'Section B · Coding · ' + EX.curB + '/' + EX_CODE_COUNT]].forEach(function (s) {
    const done = exSectionDone(s[0]);
    tabs.appendChild(el('button', {
      class: 'sh-section-tab', type: 'button',
      'aria-current': EX.section === s[0] ? 'true' : 'false',
      'data-done': done ? 'true' : 'false',
      text: s[1] + (done ? ' ✓' : ''),
      style: done || EX.section === s[0] ? 'cursor:default' : 'cursor:pointer',
      onclick: function () { exSwitchSection(s[0]); },
    }));
  });
  shell.appendChild(tabs);

  // --- question drain bar
  const drain = el('div', { class: 'exam-drain', id: 'shDrain' });
  drain.appendChild(el('i', { id: 'shDrainFill', style: 'width:100%' }));
  shell.appendChild(drain);

  const main = el('div', { class: 'sh-main', style: 'max-width:980px;margin:0 auto;width:100%' });
  shell.appendChild(main);

  if (EX.section === 'A') exPaintMcq(main); else exPaintCode(main);

  exStartTick();
  return shell;
}

function exProgressStrip(total, cur, rec) {
  // Read-only. The guidelines forbid navigating between questions, so this
  // must not be clickable — showing a clickable palette would teach a habit
  // the real platform will not allow.
  const strip = el('div', { class: 'sh-strip' });
  for (let i = 0; i < total; i++) {
    const r = rec[i];
    strip.appendChild(el('span', {
      class: 'sh-strip-cell',
      'data-s': r ? (r.skipped ? 'skipped' : 'locked') : (i === cur ? 'current' : 'pending'),
      title: 'Question ' + (i + 1) + (r ? ' — submitted, locked' : i === cur ? ' — current' : ' — not reached'),
    }));
  }
  return strip;
}

function exPaintMcq(main) {
  const i = EX.curA;
  const q = EX.mcqQs[i];

  const head = el('div', { class: 'sh-qhead' });
  head.appendChild(el('span', { class: 'sh-qno', text: 'Question ' + (i + 1) + ' of ' + EX_MCQ_COUNT }));
  head.appendChild(el('span', { class: 'sh-marks', text: EX_MARKS_PER_Q + ' marks — ' + (EX_MARKS_PER_Q / 2) + ' accuracy + up to ' + (EX_MARKS_PER_Q / 2) + ' speed' }));
  head.appendChild(el('span', { style: 'flex:1' }));
  head.appendChild(el('span', { class: 'chip', text: topicLabel(q.topic) }));
  main.appendChild(head);

  main.appendChild(exProgressStrip(EX_MCQ_COUNT, i, EX.recA));
  main.appendChild(mdBlock(q.question, 'q-stem'));

  let chosen = null;
  const opts = el('div', { class: 'sh-opts' });
  const buttons = [];
  q.options.forEach(function (o, oi) {
    const b = el('button', { class: 'sh-opt', type: 'button', role: 'radio', 'aria-checked': 'false' });
    b.appendChild(el('span', { class: 'radio' }));
    b.appendChild(el('span', { class: 'txt', html: inlineMd(o) }));
    b.addEventListener('click', function () {
      chosen = oi;
      buttons.forEach(function (x, xi) { x.setAttribute('aria-checked', xi === oi ? 'true' : 'false'); });
      submitBtn.disabled = false;
    });
    buttons.push(b);
    opts.appendChild(b);
  });
  main.appendChild(opts);

  const foot = el('div', { class: 'sh-footer' });
  foot.appendChild(el('div', {
    class: 'sh-note', style: 'border:0;padding:0;flex:1;min-width:220px',
    text: 'Submitting is final — you cannot return to this question. Answering sooner earns more speed marks.',
  }));
  foot.appendChild(el('button', {
    class: 'btn', text: 'Skip',
    onclick: function () {
      exConfirm('Skip this question? It is marked as attempted-and-skipped and cannot be returned to.', function () { exCommit(null, true); });
    },
  }));
  const submitBtn = el('button', { class: 'btn btn-primary', text: 'Submit answer', disabled: true, onclick: function () { exCommit(chosen, false); } });
  foot.appendChild(submitBtn);
  main.appendChild(foot);
}

function exPaintCode(main) {
  const i = EX.curB;
  const p = EX.codeQs[i];
  if (!EX._codeDraft) EX._codeDraft = {};

  const head = el('div', { class: 'sh-qhead' });
  head.appendChild(el('span', { class: 'sh-qno', text: 'Coding ' + (i + 1) + ' of ' + EX_CODE_COUNT + ' — ' + p.title }));
  head.appendChild(el('span', { class: 'chip ' + p.difficulty, text: p.difficulty }));
  main.appendChild(head);
  main.appendChild(exProgressStrip(EX_CODE_COUNT, i, EX.recB));

  const grid = el('div', { class: 'sh-code-grid', style: 'border-top:1px solid var(--line);margin-top:14px' });
  const left = el('div', { class: 'sh-code-left' });
  const right = el('div', { class: 'sh-code-right' });

  left.appendChild(mdBlock(p.statement));
  if (p.examples && p.examples.length) {
    left.appendChild(el('div', { class: 'section-label', style: 'margin:16px 0 8px', text: 'Sample test cases' }));
    p.examples.forEach(function (ex, k) {
      const tc = el('div', { class: 'sh-testcase', style: 'margin-bottom:8px' });
      tc.appendChild(el('div', { class: 'tc-label', text: 'Input ' + (k + 1) }));
      tc.appendChild(el('div', { text: ex.input }));
      tc.appendChild(el('div', { class: 'tc-label', style: 'margin-top:8px', text: 'Expected output' }));
      tc.appendChild(el('div', { text: ex.output }));
      left.appendChild(tc);
    });
  }
  if (p.constraints && p.constraints.length) {
    left.appendChild(el('div', { class: 'section-label', style: 'margin:16px 0 8px', text: 'Constraints' }));
    left.appendChild(mdBlock(p.constraints.map(function (c) { return '- ' + c; }).join('\n')));
  }

  const barTop = el('div', { class: 'sh-editor-bar' });
  const sel = el('select', { class: 'field', onchange: function (e) { EX.codeLang = e.target.value; } });
  [['python', 'Python 3'], ['java', 'Java'], ['cpp', 'C++']].forEach(function (l) {
    sel.appendChild(el('option', { value: l[0], text: l[1], selected: EX.codeLang === l[0] }));
  });
  barTop.appendChild(sel);
  right.appendChild(barTop);

  const ta = el('textarea', { class: 'sh-editor', spellcheck: 'false', placeholder: '# Your solution. No autocomplete, no AI, and the clock is running.' });
  ta.value = EX._codeDraft[i] || '';
  ta.addEventListener('input', function () { EX._codeDraft[i] = ta.value; });
  ta.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const s = ta.selectionStart, en = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + '    ' + ta.value.slice(en);
    ta.selectionStart = ta.selectionEnd = s + 4;
    EX._codeDraft[i] = ta.value;
  });
  right.appendChild(ta);
  right.appendChild(el('div', {
    class: 'sh-note',
    text: 'Code is not executed here — this page has no compiler. Dry-run against the samples by hand, which is what you should do on the real platform before submitting anyway. Submitting is final.',
  }));

  const foot = el('div', { style: 'display:flex;gap:9px;flex-wrap:wrap;margin-top:4px' });
  foot.appendChild(el('span', { style: 'flex:1' }));
  foot.appendChild(el('button', {
    class: 'btn', text: 'Skip',
    onclick: function () {
      exConfirm('Skip this problem? You cannot return to it.', function () { exCommit(null, true); });
    },
  }));
  foot.appendChild(el('button', {
    class: 'btn btn-primary', text: 'Submit solution',
    onclick: function () {
      const empty = !(EX._codeDraft[i] || '').trim();
      exConfirm(empty
        ? 'Submit an empty solution? You cannot return to this problem.'
        : 'Submit? You cannot return to this problem.',
        function () { exCommit(EX._codeDraft[i] || '', false); });
    },
  }));
  right.appendChild(foot);

  grid.appendChild(left);
  grid.appendChild(right);
  main.appendChild(grid);
}

function exStartTick() {
  exStop();
  EX_TICK = setInterval(function () {
    if (!EX || EX.phase !== 'live') { exStop(); return; }
    const perQ = exPerQMs();
    const qLeft = perQ - (Date.now() - EX.qStartedAt);
    const secEnd = EX.section === 'A' ? EX.sectionAEndsAt : EX.sectionBEndsAt;
    const secLeft = secEnd - Date.now();

    const qc = $('#shQClock');
    if (qc) {
      qc.textContent = fmtClock(qLeft);
      qc.className = 'sh-clock ' + (qLeft <= 10000 ? 'danger' : qLeft <= 20000 ? 'warn' : '');
    }
    const sc = $('#shSectionClock');
    if (sc) sc.textContent = fmtClock(secLeft);

    const fill = $('#shDrainFill'), drain = $('#shDrain');
    if (fill) {
      const pct = Math.max(0, qLeft / perQ * 100);
      fill.style.width = pct + '%';
      drain.className = 'exam-drain ' + (qLeft <= 10000 ? 'danger' : qLeft <= 20000 ? 'warn' : '');
    }

    if (qLeft <= 0) {
      toast('Time up on that question — moved on');
      exCommit(EX.section === 'B' ? (EX._codeDraft || {})[exCur()] || '' : null, true);
    }
  }, 200);
}

/* ---- Report ------------------------------------------------------------- */

function exReport() {
  const wrap = el('div', { class: 'sh-report' });
  const total = EX.accuracyMarks + EX.speedMarks;
  const pctMarks = Math.round(total / EX.maxMarks * 100);

  wrap.appendChild(pageHead('Assessment complete', 'Your result',
    'Scored the way the official guidelines describe: half the marks for being right, half for how much of each question\'s minute you had left when you answered.'));

  const hero = el('div', { class: 'score-hero', style: 'margin-bottom:18px' });
  hero.appendChild(ring(pctMarks, total.toFixed(1), 'of ' + EX.maxMarks));
  const side = el('div', { style: 'flex:1;min-width:240px;display:flex;flex-direction:column;gap:12px' });
  const tiles = el('div', { class: 'tiles' });
  tiles.appendChild(tile('Correct', EX.rightCount + ' / ' + EX_MCQ_COUNT, 'accuracy marks ' + EX.accuracyMarks.toFixed(1)));
  tiles.appendChild(tile('Speed marks', EX.speedMarks.toFixed(1), 'of ' + (EX.maxMarks / 2) + ' possible',
    EX.speedMarks > EX.maxMarks / 4 ? 'var(--ok)' : 'var(--warn)'));
  const answered = Object.keys(EX.recA).filter(function (k) { return !EX.recA[k].skipped; }).length;
  const avgMs = answered ? Object.keys(EX.recA).reduce(function (s, k) { return s + EX.recA[k].msUsed; }, 0) / EX_MCQ_COUNT : 0;
  tiles.appendChild(tile('Avg time / MCQ', fmtClock(avgMs), 'of 1:00 allowed'));
  tiles.appendChild(tile('Violations', String(EX.violations.length), EX.violations.length ? 'would be flagged' : 'clean run',
    EX.violations.length ? 'var(--bad)' : 'var(--ok)'));
  side.appendChild(tiles);

  // The insight the speed rule makes possible
  const wasted = EX.mcqQs.reduce(function (s, q, i) {
    const r = EX.recA[i];
    return s + (r && r.correct ? (EX_MARKS_PER_Q / 2) * (1 - r.remainingFrac) : 0);
  }, 0);
  side.appendChild(el('p', {
    class: 'lede',
    text: 'You lost ' + wasted.toFixed(1) + ' marks to the clock on questions you got right. That is pure speed cost — the answers were correct, they just took time. Being 15 seconds quicker on each would have recovered about ' + (EX_MCQ_COUNT * (EX_MARKS_PER_Q / 2) * 0.25).toFixed(1) + ' marks.',
  }));
  hero.appendChild(side);
  wrap.appendChild(hero);

  // per-question table
  const tbl = el('div', { class: 'card card-pad', style: 'margin-bottom:18px' });
  tbl.appendChild(el('h2', { text: 'Question by question' }));
  const rows = EX.mcqQs.map(function (q, i) {
    const r = EX.recA[i];
    const verdict = !r ? 'not reached' : r.skipped ? 'skipped' : r.correct ? 'correct' : 'wrong';
    const marks = r ? (r.accuracyMarks + r.speedMarks).toFixed(1) : '0.0';
    return '| ' + (i + 1) + ' | ' + topicLabel(q.topic) + ' | ' + verdict + ' | ' + (r ? fmtClock(r.msUsed) : '—') + ' | ' + marks + ' |';
  });
  tbl.appendChild(mdBlock(['| # | Topic | Result | Time | Marks |', '|---|---|---|---|---|'].concat(rows).join('\n')));
  wrap.appendChild(tbl);

  if (EX.violations.length) {
    const v = el('div', { class: 'card card-pad', style: 'margin-bottom:18px' });
    v.appendChild(el('h2', { text: 'Proctoring log' }));
    v.appendChild(el('p', { class: 'lede', style: 'font-size:.85rem;margin:6px 0 12px', text: 'On the real assessment each of these is timestamped, and enough of them terminate the attempt.' }));
    v.appendChild(mdBlock(['| # | Time | Event |', '|---|---|---|'].concat(EX.violations.map(function (x, i) {
      return '| ' + (i + 1) + ' | ' + new Date(x.at).toLocaleTimeString() + ' | ' +
        (x.type === 'tab' ? 'Tab switch' : x.type === 'blur' ? 'Window lost focus' : 'Left fullscreen') + ' |';
    })).join('\n')));
    wrap.appendChild(v);
  }

  const actions = el('div', { style: 'display:flex;gap:9px;margin-bottom:22px;flex-wrap:wrap' });
  actions.appendChild(el('button', { class: 'btn btn-primary', text: 'New attempt', onclick: function () { EX = exNew(); go('mock'); } }));
  actions.appendChild(el('button', { class: 'btn', text: 'Back to dashboard', onclick: function () { EX = null; go('dashboard'); } }));
  wrap.appendChild(actions);

  wrap.appendChild(el('h2', { text: 'Section B — your code vs the model solution', style: 'margin-bottom:12px' }));
  EX.codeQs.forEach(function (p, i) {
    const src = (EX._codeDraft || {})[i] || '';
    const d = el('details', { class: 'card', style: 'margin-bottom:10px' });
    const sum = el('summary', { class: 'disclose-btn' });
    sum.appendChild(icon('chevron', 'caret'));
    sum.appendChild(el('strong', { text: 'Problem ' + (i + 1) + ' · ' + p.title }));
    sum.appendChild(el('span', { class: 'chip' + (src.trim() ? ' ok' : ''), style: 'margin-left:auto', text: src.trim() ? 'attempted' : 'blank' }));
    d.appendChild(sum);
    const body = el('div', { style: 'padding:0 16px 16px' });
    if (src.trim()) {
      body.appendChild(el('div', { class: 'section-label', style: 'margin-bottom:8px', text: 'What you wrote' }));
      body.appendChild(codeBlock(src, EX.codeLang));
    }
    body.appendChild(el('div', { class: 'section-label', style: 'margin:16px 0 8px', text: 'Model solution' }));
    body.appendChild(codeBlock(p.solutions[EX.codeLang] || p.solutions.python, EX.codeLang));
    body.appendChild(mdBlock('**Optimal:** ' + p.optimal.idea + '\n\nTime ' + p.optimal.time + ', space ' + p.optimal.space));
    if (p.practice && p.practice.links && p.practice.links.length) {
      body.appendChild(practiceBox(p.practice));
    }
    body.appendChild(el('button', {
      class: 'btn btn-sm', style: 'margin-top:12px', text: 'Open full problem with hints and dry run',
      onclick: function () { EX = null; go('coding', { id: p.id }); },
    }));
    d.appendChild(body);
    wrap.appendChild(d);
  });

  wrap.appendChild(el('h2', { text: 'Section A — full review', style: 'margin:22px 0 12px' }));
  EX.mcqQs.forEach(function (q, i) {
    const r = EX.recA[i];
    const pick = r && !r.skipped ? r.answer : undefined;
    const d = el('details', { class: 'card', style: 'margin-bottom:9px' });
    const sum = el('summary', { class: 'disclose-btn' });
    sum.appendChild(icon('chevron', 'caret'));
    sum.appendChild(el('span', { class: 'q-idx', text: 'Q' + (i + 1) }));
    sum.appendChild(el('span', {
      text: r && r.correct ? 'Correct' : pick === undefined ? 'Skipped' : 'Wrong',
      style: 'color:' + (r && r.correct ? 'var(--ok)' : pick === undefined ? 'var(--text-faint)' : 'var(--bad)'),
    }));
    if (r) sum.appendChild(el('span', { class: 'chip', text: fmtClock(r.msUsed) }));
    sum.appendChild(el('span', { class: 'chip', style: 'margin-left:auto', text: topicLabel(q.topic) }));
    d.appendChild(sum);
    const body = el('div', { style: 'padding:0 16px 16px' });
    body.appendChild(mdBlock(q.question, 'q-stem'));
    const ol = el('div', { class: 'opts' });
    q.options.forEach(function (o, oi) {
      const st = oi === q.answerIndex ? 'correct' : (oi === pick ? 'wrong' : '');
      const b = el('div', { class: 'opt', 'data-state': st });
      b.appendChild(el('span', { class: 'key', text: 'ABCD'[oi] }));
      b.appendChild(el('span', { class: 'txt', html: inlineMd(o) }));
      ol.appendChild(b);
    });
    body.appendChild(ol);
    body.appendChild(el('div', { style: 'margin-top:14px' }, mdBlock(q.explanation)));
    if (q.takeaway) {
      const t = el('div', { class: 'takeaway', style: 'margin-top:12px' });
      t.appendChild(icon('bulb'));
      t.appendChild(el('span', { html: inlineMd(q.takeaway) }));
      body.appendChild(t);
    }
    d.appendChild(body);
    wrap.appendChild(d);
  });

  return wrap;
}

/* ---- Route -------------------------------------------------------------- */

ROUTES.mock = function (params) {
  if (!EX || params.restart) { exStop(); EX = exNew(); }
  if (EX.phase === 'instructions') return exInstructions();
  if (EX.phase === 'live') return exLiveView();
  return exReport();
};
