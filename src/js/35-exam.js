/* ==========================================================================
   SmartHire-style Round 1 simulation.

   Mirrors the mechanics of the real Unstop assessment window rather than a
   generic quiz: an instructions gate, fullscreen entry, a five-state question
   palette, Save & Next / Mark for Review & Next / Clear Response, sectional
   timers with auto-advance, tab-switch and fullscreen-exit logging, and a
   submit confirmation that shows the counts before you commit.

   Overrides ROUTES.mock defined earlier — this file sorts last on purpose.
   ========================================================================== */

const EX_MCQ_COUNT = 15;
const EX_MCQ_MS = 15 * 60 * 1000;
const EX_CODE_COUNT = 2;
const EX_CODE_MS = 45 * 60 * 1000;
const EX_VIOLATION_LIMIT = 3;

let EX = null;
let EX_TICK = null;

/* ---- Lifecycle ---------------------------------------------------------- */

function exStop() { if (EX_TICK) { clearInterval(EX_TICK); EX_TICK = null; } }

function exNew() {
  const byTopic = {};
  APP.mcq.forEach(function (q) { (byTopic[q.topic] = byTopic[q.topic] || []).push(q); });
  const seed = (Date.now() % 65521) + 3;

  // One per topic first so the paper spreads the way a real one does,
  // then fill the remainder at random.
  const picked = [];
  Object.keys(byTopic).forEach(function (t) {
    const pool = shuffle(byTopic[t], seed + t.length);
    if (pool.length) picked.push(pool[0]);
  });
  const rest = shuffle(APP.mcq.filter(function (q) { return picked.indexOf(q) === -1; }), seed);
  let i = 0;
  while (picked.length < EX_MCQ_COUNT && i < rest.length) picked.push(rest[i++]);

  // Two coding problems, easier one first, mirroring a sensible attempt order.
  const rank = { easy: 0, medium: 1, hard: 2 };
  const codePool = shuffle(APP.coding.slice(), seed + 41)
    .sort(function (a, b) { return (rank[a.difficulty] || 1) - (rank[b.difficulty] || 1); });
  const codeQs = codePool.slice(0, EX_CODE_COUNT);

  return {
    phase: 'instructions',
    agreed: false,
    mcqQs: shuffle(picked, seed + 11).slice(0, EX_MCQ_COUNT),
    cur: 0,
    picks: {},        // committed answers
    pending: {},      // selected but not yet saved
    visited: {},
    marked: {},
    codeQs: codeQs,
    codeCur: 0,
    code: {},         // idx -> { lang, source, saved }
    codeLang: 'python',
    violations: [],
    startedAt: 0,
    sectionEndsAt: 0,
    mcqElapsed: 0,
    codeElapsed: 0,
    warnOpen: false,
  };
}

function exStart() {
  EX.phase = 'mcq';
  EX.startedAt = Date.now();
  EX.sectionEndsAt = Date.now() + EX_MCQ_MS;
  EX.visited[0] = true;
  exRequestFullscreen();
  exAttachProctor();
  exStartTick();
  go('mock');
}

function exStartTick() {
  exStop();
  EX_TICK = setInterval(function () {
    if (!EX || (EX.phase !== 'mcq' && EX.phase !== 'coding')) { exStop(); return; }
    const left = EX.sectionEndsAt - Date.now();
    const clock = $('#shClock');
    if (clock) {
      clock.textContent = fmtClock(left);
      clock.className = 'sh-clock ' + (left <= 60000 ? 'danger' : left <= 120000 ? 'warn' : '');
    }
    if (left <= 0) {
      if (EX.phase === 'mcq') { toast('Section A time over — moving to coding'); exFinishMcq(true); }
      else { toast('Time over — submitted'); exFinishCoding(true); }
    }
  }, 250);
}

function exFinishMcq(auto) {
  EX.mcqElapsed = EX_MCQ_MS - Math.max(0, EX.sectionEndsAt - Date.now());
  // commit anything selected but not saved: the real platform evaluates a
  // selected-and-saved answer, so we only auto-commit on time-out to be kind.
  if (auto) {
    Object.keys(EX.pending).forEach(function (k) {
      if (EX.picks[k] === undefined) EX.picks[k] = EX.pending[k];
    });
  }
  EX.phase = 'coding';
  EX.sectionEndsAt = Date.now() + EX_CODE_MS;
  go('mock');
}

function exFinishCoding(auto) {
  EX.codeElapsed = EX_CODE_MS - Math.max(0, EX.sectionEndsAt - Date.now());
  exStop();
  exDetachProctor();
  exExitFullscreen();

  let score = 0;
  EX.mcqQs.forEach(function (q, i) {
    const p = EX.picks[i];
    const rec = mcqRec(q.id);
    rec.seen = (rec.seen || 0) + 1;
    if (p === q.answerIndex) { score++; rec.correct++; } else if (p !== undefined) { rec.wrong++; }
  });
  EX.score = score;
  STATE.mocks.push({
    at: Date.now(), score: score, total: EX_MCQ_COUNT,
    elapsedMs: EX.mcqElapsed, violations: EX.violations.length,
  });
  saveState();
  EX.phase = 'done';
  go('mock');
}

/* ---- Fullscreen + proctoring ------------------------------------------- */

function exRequestFullscreen() {
  const root = document.documentElement;
  const fn = root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen;
  if (fn) { try { fn.call(root); } catch (e) { /* user gesture may be required */ } }
}
function exExitFullscreen() {
  if (document.fullscreenElement && document.exitFullscreen) {
    try { document.exitFullscreen(); } catch (e) { /* ignore */ }
  }
}

function exLogViolation(type) {
  if (!EX || (EX.phase !== 'mcq' && EX.phase !== 'coding')) return;
  // One physical act (alt-tab) fires blur AND visibilitychange, and some
  // window managers fire blur spuriously. Collapse anything within 1.5s into
  // a single event so the count reflects real switches, not browser noise.
  const last = EX.violations[EX.violations.length - 1];
  if (last && Date.now() - last.at < 1500) return;
  EX.violations.push({ at: Date.now(), type: type });
  const badge = $('#shProctor');
  if (badge) {
    badge.className = 'sh-proctor alert';
    clear(badge);
    badge.appendChild(el('i', { class: 'dot' }));
    badge.appendChild(el('span', { text: EX.violations.length + ' flagged' }));
  }
  exShowViolation(type);
}

function exShowViolation(type) {
  if (EX.warnOpen) return;
  EX.warnOpen = true;
  const n = EX.violations.length;
  const back = el('div', { class: 'modal-back sh-violation-modal' });
  const m = el('div', { class: 'modal' });
  m.appendChild(el('h2', { text: 'Proctoring event logged' }));
  const what = type === 'tab' ? 'You switched away from the test tab.'
    : type === 'blur' ? 'The test window lost focus.'
    : 'You left fullscreen.';
  m.appendChild(el('p', { text: what + ' Event ' + n + ' of ' + EX_VIOLATION_LIMIT + ' before the real platform would escalate.' }));
  m.appendChild(el('p', {
    class: 'lede', style: 'font-size:.85rem',
    text: n >= EX_VIOLATION_LIMIT
      ? 'On the real assessment this many events can auto-submit your paper or flag it for review. Treat the tab as locked.'
      : 'Unstop logs every fullscreen exit and window switch with a timestamp. Practise as if the tab is locked.',
  }));
  const btn = el('button', {
    class: 'btn btn-primary', text: 'Back to the test',
    onclick: function () {
      back.remove(); EX.warnOpen = false;
      if (EX.phase === 'mcq' || EX.phase === 'coding') exRequestFullscreen();
    },
  });
  m.appendChild(btn);
  back.appendChild(m);
  document.body.appendChild(back);
  setTimeout(function () { btn.focus(); }, 20);
}

function exOnVisibility() { if (document.hidden) exLogViolation('tab'); }
function exOnBlur() { if (!document.hidden) exLogViolation('blur'); }
function exOnFsChange() { if (!document.fullscreenElement) exLogViolation('fullscreen'); }

function exAttachProctor() {
  document.addEventListener('visibilitychange', exOnVisibility);
  window.addEventListener('blur', exOnBlur);
  document.addEventListener('fullscreenchange', exOnFsChange);
}
function exDetachProctor() {
  document.removeEventListener('visibilitychange', exOnVisibility);
  window.removeEventListener('blur', exOnBlur);
  document.removeEventListener('fullscreenchange', exOnFsChange);
}

/* ---- Palette state ------------------------------------------------------ */

function exStatus(i) {
  const saved = EX.picks[i] !== undefined;
  const marked = !!EX.marked[i];
  if (marked && saved) return 'ansmarked';
  if (marked) return 'marked';
  if (saved) return 'answered';
  if (EX.visited[i]) return 'notans';
  return 'notvisited';
}

function exCounts() {
  const c = { answered: 0, notans: 0, marked: 0, ansmarked: 0, notvisited: 0 };
  for (let i = 0; i < EX_MCQ_COUNT; i++) c[exStatus(i)]++;
  return c;
}

/* ---- Chrome ------------------------------------------------------------- */

function exTopBar(sectionLabel) {
  const bar = el('div', { class: 'sh-top' });
  const brand = el('div', { class: 'sh-brand' });
  brand.appendChild(el('span', { class: 'glyph', text: 'A' }));
  brand.appendChild(el('span', { text: 'Adobe University Hackathon 2026 — Online Assessment' }));
  bar.appendChild(brand);
  bar.appendChild(el('span', { class: 'spacer' }));

  const proctor = el('div', { class: 'sh-proctor' + (EX.violations.length ? ' alert' : ''), id: 'shProctor' });
  proctor.appendChild(el('i', { class: 'dot' }));
  proctor.appendChild(el('span', { text: EX.violations.length ? EX.violations.length + ' flagged' : 'Proctoring on' }));
  bar.appendChild(proctor);

  const box = el('div', { class: 'sh-clock-box' });
  box.appendChild(el('span', { class: 'lbl', text: sectionLabel + ' left' }));
  box.appendChild(el('span', { class: 'sh-clock', id: 'shClock', text: fmtClock(EX.sectionEndsAt - Date.now()) }));
  bar.appendChild(box);
  return bar;
}

function exSectionTabs(active) {
  const tabs = el('div', { class: 'sh-sections' });
  [['A', 'Section A · 15 MCQs · 15 min', 'mcq'], ['B', 'Section B · 2 Coding · 45 min', 'coding']].forEach(function (s) {
    tabs.appendChild(el('button', {
      class: 'sh-section-tab', type: 'button', disabled: true,
      'aria-current': active === s[2] ? 'true' : 'false',
      'data-done': (active === 'coding' && s[2] === 'mcq') || active === 'done' ? 'true' : 'false',
      text: s[1],
    }));
  });
  return tabs;
}

/* ---- Instructions ------------------------------------------------------- */

function exInstructions() {
  const wrap = el('div', { class: 'sh-instructions' });
  const card = el('div', { class: 'sh-inst-card' });
  card.appendChild(el('h1', { text: 'General instructions' }));
  card.appendChild(el('p', { class: 'lede', text: 'Read this the way you would on the day. The real window opens with a screen like this and a checkbox you cannot skip.' }));

  card.appendChild(mdBlock([
    '### The paper',
    '',
    '| Section | Contents | Time |',
    '|---|---|---|',
    '| A | 15 multiple-choice questions | 15 minutes |',
    '| B | 2 coding challenges | 45 minutes |',
    '',
    'Total duration **60 minutes**. The section timer runs down independently and **auto-advances** — time left over in Section A is not carried into Section B.',
    '',
    '### Answering and navigation',
    '',
    '- Selecting an option does **not** save it. You must press **Save & Next**. This is how the real platform behaves and it is the single most common way candidates lose marks.',
    '- **Mark for Review & Next** saves your answer *and* flags it. A marked question that has an answer is still evaluated.',
    '- **Clear Response** removes your answer for the current question.',
    '- You may move between questions freely using the palette on the right.',
    '',
    '### Marking',
    '',
    '- 1 mark per correct MCQ. No negative marking is applied in this simulation.',
    '- Your team score in the real event is the **average of all members**, so every member matters equally.',
    '',
    '### Proctoring',
    '',
    'Unstop logs fullscreen exits, window switches and tab switches with timestamps. This simulation does the same and shows you the count, so you can find out now whether you have a habit of glancing away.',
    '',
    '> This is practice. Nothing is uploaded anywhere and no camera or microphone is accessed — the browser only tracks whether this tab is focused.',
  ].join('\n')));

  const agree = el('label', { class: 'sh-agree' });
  const cb = el('input', { type: 'checkbox' });
  cb.checked = EX.agreed;
  cb.addEventListener('change', function () {
    EX.agreed = cb.checked;
    startBtn.disabled = !cb.checked;
  });
  agree.appendChild(cb);
  agree.appendChild(el('span', { text: 'I have read and understood the instructions. I understand that selecting an option does not save it, and that leaving fullscreen is logged.' }));
  card.appendChild(agree);

  const row = el('div', { style: 'display:flex;gap:9px;margin-top:18px;flex-wrap:wrap' });
  const startBtn = el('button', {
    class: 'btn btn-primary btn-lg', text: 'Start the assessment',
    disabled: !EX.agreed, onclick: exStart,
  });
  row.appendChild(startBtn);
  row.appendChild(el('button', { class: 'btn', text: 'Back', onclick: function () { EX = null; go('dashboard'); } }));
  card.appendChild(row);

  wrap.appendChild(card);
  return wrap;
}

/* ---- Section A ---------------------------------------------------------- */

function exMcqView() {
  const shell = el('div', { class: 'sh-shell' });
  shell.appendChild(exTopBar('Section A'));
  shell.appendChild(exSectionTabs('mcq'));

  const body = el('div', { class: 'sh-body' });
  const main = el('div', { class: 'sh-main' });
  const side = el('div', { class: 'sh-side' });
  body.appendChild(main);
  body.appendChild(side);
  shell.appendChild(body);

  function repaint() { clear(main); clear(side); paintMain(); paintSide(); }

  function paintMain() {
    const i = EX.cur;
    const q = EX.mcqQs[i];
    EX.visited[i] = true;

    const head = el('div', { class: 'sh-qhead' });
    head.appendChild(el('span', { class: 'sh-qno', text: 'Question ' + (i + 1) }));
    head.appendChild(el('span', { class: 'sh-marks', text: 'Marks: +1' }));
    head.appendChild(el('span', { style: 'flex:1' }));
    head.appendChild(el('span', { class: 'chip', text: topicLabel(q.topic) }));
    main.appendChild(head);

    main.appendChild(mdBlock(q.question, 'q-stem'));

    const opts = el('div', { class: 'sh-opts' });
    const chosen = EX.pending[i] !== undefined ? EX.pending[i] : EX.picks[i];
    q.options.forEach(function (o, oi) {
      const b = el('button', {
        class: 'sh-opt', type: 'button', role: 'radio',
        'aria-checked': chosen === oi ? 'true' : 'false',
        onclick: function () { EX.pending[i] = oi; repaint(); },
      });
      b.appendChild(el('span', { class: 'radio' }));
      b.appendChild(el('span', { class: 'txt', html: inlineMd(o) }));
      opts.appendChild(b);
    });
    main.appendChild(opts);

    if (EX.pending[i] !== undefined && EX.picks[i] !== EX.pending[i]) {
      main.appendChild(el('div', {
        class: 'sh-note', style: 'margin-top:14px',
        text: 'Selected but not saved. Press Save & Next or Mark for Review & Next to record it.',
      }));
    }

    const foot = el('div', { class: 'sh-footer' });
    foot.appendChild(el('button', {
      class: 'btn', text: 'Clear Response',
      onclick: function () { delete EX.pending[i]; delete EX.picks[i]; repaint(); },
    }));
    foot.appendChild(el('button', {
      class: 'btn', text: 'Mark for Review & Next',
      onclick: function () {
        if (EX.pending[i] !== undefined) EX.picks[i] = EX.pending[i];
        EX.marked[i] = true;
        EX.cur = Math.min(i + 1, EX_MCQ_COUNT - 1);
        repaint();
      },
    }));
    foot.appendChild(el('span', { class: 'spacer' }));
    foot.appendChild(el('button', {
      class: 'btn', text: '← Previous', disabled: i === 0,
      onclick: function () { EX.cur = i - 1; repaint(); },
    }));
    foot.appendChild(el('button', {
      class: 'btn btn-primary', text: 'Save & Next',
      onclick: function () {
        if (EX.pending[i] !== undefined) EX.picks[i] = EX.pending[i];
        EX.marked[i] = false;
        if (i === EX_MCQ_COUNT - 1) { repaint(); exConfirmSection(); }
        else { EX.cur = i + 1; repaint(); }
      },
    }));
    main.appendChild(foot);
  }

  function paintSide() {
    const legend = el('div', { class: 'sh-legend' });
    const c = exCounts();
    [['answered', 'Answered', c.answered], ['notans', 'Not answered', c.notans],
     ['marked', 'Marked for review', c.marked], ['ansmarked', 'Answered & marked', c.ansmarked],
     ['notvisited', 'Not visited', c.notvisited]].forEach(function (l) {
      const row = el('div', { class: 'sh-legend-row' });
      row.appendChild(el('span', { class: 'sh-swatch ' + l[0], text: String(l[2]) }));
      row.appendChild(el('span', { text: l[1] }));
      legend.appendChild(row);
    });
    side.appendChild(legend);

    side.appendChild(el('div', { class: 'sh-pal-title', text: 'Question palette' }));
    const pal = el('div', { class: 'sh-pal' });
    for (let i = 0; i < EX_MCQ_COUNT; i++) {
      (function (idx) {
        pal.appendChild(el('button', {
          type: 'button', text: String(idx + 1), 'data-s': exStatus(idx),
          'aria-current': idx === EX.cur ? 'true' : 'false',
          onclick: function () { EX.cur = idx; repaint(); },
        }));
      })(i);
    }
    side.appendChild(pal);

    side.appendChild(el('button', {
      class: 'btn btn-primary', style: 'width:100%;margin-top:18px',
      text: 'Submit Section A', onclick: exConfirmSection,
    }));
  }

  repaint();
  return shell;
}

function exConfirmSection() {
  const c = exCounts();
  const back = el('div', { class: 'modal-back' });
  const m = el('div', { class: 'modal' });
  m.appendChild(el('h2', { text: 'Submit Section A?' }));
  m.appendChild(mdBlock([
    '| Status | Count |',
    '|---|---|',
    '| Answered | ' + (c.answered + c.ansmarked) + ' |',
    '| Not answered | ' + c.notans + ' |',
    '| Marked for review | ' + (c.marked + c.ansmarked) + ' |',
    '| Not visited | ' + c.notvisited + ' |',
  ].join('\n')));
  if (c.notans + c.notvisited > 0) {
    m.appendChild(el('div', {
      class: 'sh-note',
      text: (c.notans + c.notvisited) + ' question(s) have no saved answer. There is no negative marking here — a guess is strictly better than a blank.',
    }));
  }
  const row = el('div', { style: 'display:flex;gap:9px;flex-wrap:wrap' });
  row.appendChild(el('button', {
    class: 'btn btn-primary', text: 'Submit and start Section B',
    onclick: function () { back.remove(); exFinishMcq(false); },
  }));
  row.appendChild(el('button', { class: 'btn', text: 'Keep working', onclick: function () { back.remove(); } }));
  m.appendChild(row);
  back.appendChild(m);
  document.body.appendChild(back);
}

/* ---- Section B ---------------------------------------------------------- */

function exCodeRec(i) {
  if (!EX.code[i]) EX.code[i] = { lang: EX.codeLang, source: '', saved: false };
  return EX.code[i];
}

function exCodingView() {
  const shell = el('div', { class: 'sh-shell' });
  shell.appendChild(exTopBar('Section B'));
  shell.appendChild(exSectionTabs('coding'));

  const grid = el('div', { class: 'sh-code-grid' });
  const left = el('div', { class: 'sh-code-left' });
  const right = el('div', { class: 'sh-code-right' });
  grid.appendChild(left);
  grid.appendChild(right);
  shell.appendChild(grid);

  function repaint() { clear(left); clear(right); paintLeft(); paintRight(); }

  function paintLeft() {
    const p = EX.codeQs[EX.codeCur];
    const tabs = el('div', { style: 'display:flex;gap:7px;margin-bottom:14px;flex-wrap:wrap' });
    EX.codeQs.forEach(function (cq, i) {
      tabs.appendChild(el('button', {
        class: 'btn btn-sm' + (i === EX.codeCur ? ' btn-primary' : ''),
        text: 'Problem ' + (i + 1) + (EX.code[i] && EX.code[i].saved ? ' ✓' : ''),
        onclick: function () { EX.codeCur = i; repaint(); },
      }));
    });
    left.appendChild(tabs);

    const head = el('div', { class: 'sh-qhead' });
    head.appendChild(el('span', { class: 'sh-qno', text: p.title }));
    head.appendChild(el('span', { class: 'chip ' + p.difficulty, text: p.difficulty }));
    left.appendChild(head);

    left.appendChild(mdBlock(p.statement));

    if (p.examples && p.examples.length) {
      left.appendChild(el('div', { class: 'section-label', style: 'margin:18px 0 8px', text: 'Sample test cases' }));
      p.examples.forEach(function (ex, i) {
        const tc = el('div', { class: 'sh-testcase', style: 'margin-bottom:8px' });
        tc.appendChild(el('div', { class: 'tc-label', text: 'Input ' + (i + 1) }));
        tc.appendChild(el('div', { text: ex.input }));
        tc.appendChild(el('div', { class: 'tc-label', style: 'margin-top:8px', text: 'Expected output' }));
        tc.appendChild(el('div', { text: ex.output }));
        left.appendChild(tc);
      });
    }
    if (p.constraints && p.constraints.length) {
      left.appendChild(el('div', { class: 'section-label', style: 'margin:18px 0 8px', text: 'Constraints' }));
      left.appendChild(mdBlock(p.constraints.map(function (c) { return '- ' + c; }).join('\n')));
    }
  }

  function paintRight() {
    const i = EX.codeCur;
    const rec = exCodeRec(i);

    const bar = el('div', { class: 'sh-editor-bar' });
    const sel = el('select', {
      class: 'field',
      onchange: function (e) { rec.lang = e.target.value; EX.codeLang = e.target.value; },
    });
    [['python', 'Python 3'], ['java', 'Java'], ['cpp', 'C++']].forEach(function (l) {
      sel.appendChild(el('option', { value: l[0], text: l[1], selected: rec.lang === l[0] }));
    });
    bar.appendChild(sel);
    bar.appendChild(el('span', { style: 'flex:1' }));
    bar.appendChild(el('button', {
      class: 'btn btn-sm', text: rec.saved ? 'Saved ✓' : 'Save code',
      onclick: function () { rec.saved = true; toast('Code saved'); repaint(); },
    }));
    right.appendChild(bar);

    const ta = el('textarea', {
      class: 'sh-editor', spellcheck: 'false',
      placeholder: '# Write your solution here.\n# Same as the real thing: no autocomplete, no AI, and a clock.',
    });
    ta.value = rec.source;
    ta.addEventListener('input', function () { rec.source = ta.value; rec.saved = false; });
    // Tab should indent, not move focus out of the editor.
    ta.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + '    ' + ta.value.slice(en);
      ta.selectionStart = ta.selectionEnd = s + 4;
      rec.source = ta.value;
    });
    right.appendChild(ta);

    right.appendChild(el('div', {
      class: 'sh-note',
      text: 'Code is not executed here — this is a browser page with no compiler. Dry-run against the sample cases by hand, exactly as you should before hitting submit on the real platform. Full solutions unlock after you submit.',
    }));

    const foot = el('div', { style: 'display:flex;gap:9px;flex-wrap:wrap;margin-top:4px' });
    if (EX.codeCur < EX.codeQs.length - 1) {
      foot.appendChild(el('button', {
        class: 'btn', text: 'Next problem →',
        onclick: function () { EX.codeCur++; repaint(); },
      }));
    }
    foot.appendChild(el('span', { style: 'flex:1' }));
    foot.appendChild(el('button', {
      class: 'btn btn-primary', text: 'Submit assessment',
      onclick: function () {
        const unsaved = EX.codeQs.filter(function (_, k) { return !(EX.code[k] && EX.code[k].saved); }).length;
        if (unsaved && !confirm(unsaved + ' problem(s) have unsaved code. Submit anyway?')) return;
        if (!confirm('Submit the whole assessment? This ends the simulation.')) return;
        exFinishCoding(false);
      },
    }));
    right.appendChild(foot);
  }

  repaint();
  return shell;
}

/* ---- Report ------------------------------------------------------------- */

function exReport() {
  const wrap = el('div', { class: 'sh-report' });
  const pct = Math.round(EX.score / EX_MCQ_COUNT * 100);

  wrap.appendChild(pageHead('Assessment complete', 'Your result',
    'Section A is auto-marked. Section B is self-marked against the model solutions below — be strict with yourself.'));

  const hero = el('div', { class: 'score-hero', style: 'margin-bottom:18px' });
  hero.appendChild(ring(pct, EX.score + '/' + EX_MCQ_COUNT, 'section A'));
  const side = el('div', { style: 'flex:1;min-width:220px;display:flex;flex-direction:column;gap:12px' });
  const tiles = el('div', { class: 'tiles' });
  tiles.appendChild(tile('Accuracy', pct + '%', '', pct >= 70 ? 'var(--ok)' : pct >= 47 ? 'var(--warn)' : 'var(--bad)'));
  tiles.appendChild(tile('Section A time', fmtClock(EX.mcqElapsed), 'of 15:00'));
  tiles.appendChild(tile('Section B time', fmtClock(EX.codeElapsed), 'of 45:00'));
  tiles.appendChild(tile('Proctoring flags', String(EX.violations.length), EX.violations.length ? 'tab or fullscreen' : 'clean run',
    EX.violations.length ? 'var(--bad)' : 'var(--ok)'));
  side.appendChild(tiles);
  side.appendChild(el('p', {
    class: 'lede',
    text: pct >= 73 ? 'Shortlist range on Section A. Put your remaining time into the coding half.'
      : pct >= 47 ? 'Borderline. The gap is usually one or two topics rather than general weakness — see the breakdown.'
      : 'Below the line. Drill the red topics before your next attempt.',
  }));
  hero.appendChild(side);
  wrap.appendChild(hero);

  // Per-topic
  const per = {};
  EX.mcqQs.forEach(function (q, i) {
    if (!per[q.topic]) per[q.topic] = { n: 0, ok: 0 };
    per[q.topic].n++;
    if (EX.picks[i] === q.answerIndex) per[q.topic].ok++;
  });
  const bd = el('div', { class: 'card card-pad', style: 'margin-bottom:18px' });
  bd.appendChild(el('h2', { text: 'Section A by topic' }));
  const rows = el('div', { class: 'bar-rows', style: 'margin-top:12px' });
  Object.keys(per).sort(function (a, b) { return (per[a].ok / per[a].n) - (per[b].ok / per[b].n); }).forEach(function (t) {
    const p = per[t], q = Math.round(p.ok / p.n * 100);
    rows.appendChild(barRow(topicLabel(t), q, p.ok + '/' + p.n,
      q >= 70 ? 'var(--ok)' : q >= 40 ? 'var(--warn)' : 'var(--bad)'));
  });
  bd.appendChild(rows);
  wrap.appendChild(bd);

  // Proctoring log
  if (EX.violations.length) {
    const v = el('div', { class: 'card card-pad', style: 'margin-bottom:18px' });
    v.appendChild(el('h2', { text: 'Proctoring log' }));
    v.appendChild(el('p', { class: 'lede', style: 'font-size:.85rem;margin:6px 0 12px', text: 'Every one of these would have been timestamped and attached to your submission on the real platform.' }));
    const lines = EX.violations.map(function (x, i) {
      const d = new Date(x.at);
      const label = x.type === 'tab' ? 'Tab switch' : x.type === 'blur' ? 'Window lost focus' : 'Left fullscreen';
      return '| ' + (i + 1) + ' | ' + d.toLocaleTimeString() + ' | ' + label + ' |';
    });
    v.appendChild(mdBlock(['| # | Time | Event |', '|---|---|---|'].concat(lines).join('\n')));
    wrap.appendChild(v);
  }

  const actions = el('div', { style: 'display:flex;gap:9px;margin-bottom:22px;flex-wrap:wrap' });
  actions.appendChild(el('button', { class: 'btn btn-primary', text: 'New attempt', onclick: function () { EX = exNew(); go('mock'); } }));
  actions.appendChild(el('button', { class: 'btn', text: 'Back to dashboard', onclick: function () { EX = null; go('dashboard'); } }));
  wrap.appendChild(actions);

  // Section B self-marking
  wrap.appendChild(el('h2', { text: 'Section B — your code vs the model solution', style: 'margin-bottom:12px' }));
  EX.codeQs.forEach(function (p, i) {
    const rec = EX.code[i] || { source: '', lang: 'python' };
    const d = el('details', { class: 'card', style: 'margin-bottom:10px' });
    const sum = el('summary', { class: 'disclose-btn' });
    sum.appendChild(icon('chevron', 'caret'));
    sum.appendChild(el('strong', { text: 'Problem ' + (i + 1) + ' · ' + p.title }));
    sum.appendChild(el('span', {
      class: 'chip' + (rec.source.trim() ? ' ok' : ''), style: 'margin-left:auto',
      text: rec.source.trim() ? 'attempted' : 'blank',
    }));
    d.appendChild(sum);
    const body = el('div', { style: 'padding:0 16px 16px' });
    if (rec.source.trim()) {
      body.appendChild(el('div', { class: 'section-label', style: 'margin-bottom:8px', text: 'What you wrote' }));
      body.appendChild(codeBlock(rec.source, rec.lang));
    }
    body.appendChild(el('div', { class: 'section-label', style: 'margin:16px 0 8px', text: 'Model solution' }));
    body.appendChild(codeBlock(p.solutions[rec.lang] || p.solutions.python, rec.lang));
    body.appendChild(el('div', { class: 'section-label', style: 'margin:16px 0 8px', text: 'Approach' }));
    body.appendChild(mdBlock('**Optimal:** ' + p.optimal.idea + '\n\nTime ' + p.optimal.time + ', space ' + p.optimal.space));
    body.appendChild(el('button', {
      class: 'btn btn-sm', style: 'margin-top:12px',
      text: 'Open full problem with hints and dry run',
      onclick: function () { EX = null; go('coding', { id: p.id }); },
    }));
    d.appendChild(body);
    wrap.appendChild(d);
  });

  // Full MCQ review
  wrap.appendChild(el('h2', { text: 'Section A — full review', style: 'margin:22px 0 12px' }));
  EX.mcqQs.forEach(function (q, i) {
    const pick = EX.picks[i];
    const right = pick === q.answerIndex;
    const d = el('details', { class: 'card', style: 'margin-bottom:9px' });
    const sum = el('summary', { class: 'disclose-btn' });
    sum.appendChild(icon('chevron', 'caret'));
    sum.appendChild(el('span', { class: 'q-idx', text: 'Q' + (i + 1) }));
    sum.appendChild(el('span', {
      text: right ? 'Correct' : pick === undefined ? 'Not answered' : 'Wrong',
      style: 'color:' + (right ? 'var(--ok)' : pick === undefined ? 'var(--text-faint)' : 'var(--bad)'),
    }));
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
    const v = el('div', { style: 'margin-top:14px;display:flex;flex-direction:column;gap:12px' });
    v.appendChild(mdBlock(q.explanation));
    if (q.takeaway) {
      const t = el('div', { class: 'takeaway' });
      t.appendChild(icon('bulb'));
      t.appendChild(el('span', { html: inlineMd(q.takeaway) }));
      v.appendChild(t);
    }
    body.appendChild(v);
    d.appendChild(body);
    wrap.appendChild(d);
  });

  return wrap;
}

/* ---- Route -------------------------------------------------------------- */

ROUTES.mock = function (params) {
  if (!EX || params.restart) { exStop(); EX = exNew(); }
  if (EX.phase === 'instructions') return exInstructions();
  if (EX.phase === 'mcq') { exStartTick(); return exMcqView(); }
  if (EX.phase === 'coding') { exStartTick(); return exCodingView(); }
  return exReport();
};
