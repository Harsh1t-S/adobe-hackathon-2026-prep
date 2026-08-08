/* ==========================================================================
   Timed modes (Round 1 mock, Round 2 case sim), reading views, progress.
   ========================================================================== */

/* ---- Timer -------------------------------------------------------------- */

let TIMER = null;
function stopTimer() { if (TIMER) { clearInterval(TIMER); TIMER = null; } }

function examBar(title, totalMs, onExpire, onQuit) {
  const bar = el('div', { class: 'exam-bar' });
  const t = el('div', { class: 'exam-title' });
  t.appendChild(icon('timer'));
  t.appendChild(el('span', { text: title }));
  bar.appendChild(t);
  bar.appendChild(el('span', { class: 'spacer' }));
  const clock = el('div', { class: 'exam-clock', text: fmtClock(totalMs) });
  bar.appendChild(clock);
  bar.appendChild(el('button', { class: 'btn btn-sm btn-ghost', text: 'Quit', onclick: onQuit }));

  const drain = el('div', { class: 'exam-drain' });
  const fill = el('i', { style: 'width:100%' });
  drain.appendChild(fill);

  const started = Date.now();
  stopTimer();
  TIMER = setInterval(function () {
    const left = totalMs - (Date.now() - started);
    clock.textContent = fmtClock(left);
    const pct = Math.max(0, left / totalMs * 100);
    fill.style.width = pct + '%';
    const cls = left <= 60000 ? 'danger' : left <= totalMs * 0.2 ? 'warn' : '';
    clock.className = 'exam-clock ' + cls;
    drain.className = 'exam-drain ' + cls;
    if (left <= 0) { stopTimer(); onExpire(); }
  }, 250);

  return { bar: bar, drain: drain, startedAt: started };
}

/* ---- Round 1 mock ------------------------------------------------------- */

const MOCK_N = 15;
const MOCK_MS = 15 * 60 * 1000;

let mock = null;

function newMockSet() {
  // One from each topic, then fill by weakest-accuracy first — mirrors a real
  // paper's spread instead of dumping 15 questions from one chapter.
  const byTopic = {};
  APP.mcq.forEach(function (q) { (byTopic[q.topic] = byTopic[q.topic] || []).push(q); });
  const seed = (Date.now() % 65521) + 3;
  const picked = [];
  const topics = Object.keys(byTopic);
  topics.forEach(function (t) {
    const pool = shuffle(byTopic[t], seed + t.length);
    if (pool.length) picked.push(pool[0]);
  });
  const rest = shuffle(APP.mcq.filter(function (q) { return picked.indexOf(q) === -1; }), seed);
  let i = 0;
  while (picked.length < MOCK_N && i < rest.length) picked.push(rest[i++]);
  return shuffle(picked, seed + 11).slice(0, MOCK_N);
}

ROUTES.mock = function (params) {
  const box = el('div');

  if (!mock || params.restart) {
    mock = { qs: newMockSet(), picks: {}, flags: {}, cur: 0, done: false, startedAt: Date.now() };
  }

  if (mock.done) { box.appendChild(mockReport()); return box; }

  function finish() {
    stopTimer();
    mock.done = true;
    mock.elapsed = Date.now() - mock.startedAt;
    let score = 0;
    mock.qs.forEach(function (q, i) {
      const p = mock.picks[i];
      const rec = mcqRec(q.id);
      rec.seen = (rec.seen || 0) + 1;
      if (p === q.answerIndex) { score++; rec.correct++; } else if (p !== undefined) { rec.wrong++; }
    });
    mock.score = score;
    STATE.mocks.push({ at: Date.now(), score: score, total: MOCK_N, elapsedMs: mock.elapsed });
    saveState();
    go('mock');
  }

  const timer = examBar('Round 1 mock · Section A', MOCK_MS, function () { toast('Time up — submitted'); finish(); },
    function () { if (confirm('Quit the mock? Your answers are discarded.')) { stopTimer(); mock = null; go('dashboard'); } });
  box.appendChild(timer.bar);
  box.appendChild(timer.drain);

  const view = el('div', { class: 'view narrow' });

  const pal = el('div', { class: 'card card-pad', style: 'margin-bottom:16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap' });
  pal.appendChild(el('span', { class: 'section-label', text: 'Questions' }));
  const palRow = el('div', { class: 'palette' });
  function paintPalette() {
    clear(palRow);
    mock.qs.forEach(function (q, i) {
      const st = mock.flags[i] ? 'flagged' : (mock.picks[i] !== undefined ? 'answered' : '');
      palRow.appendChild(el('button', {
        class: 'pal-btn', 'data-s': st, text: String(i + 1),
        'aria-current': i === mock.cur ? 'true' : 'false',
        onclick: function () { mock.cur = i; paint(); },
      }));
    });
  }
  pal.appendChild(palRow);
  pal.appendChild(el('span', { style: 'flex:1' }));
  pal.appendChild(el('button', { class: 'btn btn-primary btn-sm', text: 'Submit now', onclick: function () { if (confirm('Submit? You cannot change answers after this.')) finish(); } }));
  view.appendChild(pal);

  const holder = el('div');
  view.appendChild(holder);
  box.appendChild(view);

  function paint() {
    paintPalette();
    clear(holder);
    const i = mock.cur;
    const q = mock.qs[i];
    const card = el('div', { class: 'card card-pad q-card' });
    card.appendChild(el('i', { class: 'q-stripe', style: 'background:' + topicHue(q.topic) }));

    const meta = el('div', { class: 'q-meta' });
    meta.appendChild(el('span', { class: 'q-idx', text: 'Q' + (i + 1) + ' of ' + MOCK_N }));
    meta.appendChild(el('span', { class: 'chip', html: '<i class="chip-dot" style="background:' + topicHue(q.topic) + '"></i>' + esc(topicLabel(q.topic)) }));
    meta.appendChild(el('span', { class: 'spacer' }));
    const fb = el('button', { class: 'icon-btn ' + (mock.flags[i] ? 'is-on' : ''), type: 'button', title: 'Flag for review (F)' });
    fb.appendChild(icon('flag'));
    fb.addEventListener('click', function () { mock.flags[i] = !mock.flags[i]; paint(); });
    meta.appendChild(fb);
    card.appendChild(meta);

    card.appendChild(mdBlock(q.question, 'q-stem'));

    const opts = el('div', { class: 'opts' });
    ['A', 'B', 'C', 'D'].forEach(function (K, oi) {
      const b = el('button', { class: 'opt', type: 'button', 'data-state': mock.picks[i] === oi ? 'picked' : '' });
      b.appendChild(el('span', { class: 'key', text: K }));
      b.appendChild(el('span', { class: 'txt', html: inlineMd(q.options[oi]) }));
      b.addEventListener('click', function () {
        mock.picks[i] = mock.picks[i] === oi ? undefined : oi;
        if (mock.picks[i] === undefined) delete mock.picks[i];
        paint();
      });
      opts.appendChild(b);
    });
    card.appendChild(opts);

    const nav = el('div', { style: 'display:flex;gap:9px;margin-top:18px;flex-wrap:wrap' });
    nav.appendChild(el('button', { class: 'btn', text: '← Previous', disabled: i === 0, onclick: function () { mock.cur--; paint(); } }));
    if (i < MOCK_N - 1) nav.appendChild(el('button', { class: 'btn btn-primary', text: 'Next →', onclick: function () { mock.cur++; paint(); } }));
    else nav.appendChild(el('button', { class: 'btn btn-primary', text: 'Submit', onclick: function () { if (confirm('Submit?')) finish(); } }));
    nav.appendChild(el('span', { style: 'flex:1' }));
    nav.appendChild(el('span', { class: 'chip', text: Object.keys(mock.picks).length + ' answered' }));
    card.appendChild(nav);

    holder.appendChild(card);
  }
  paint();
  return box;
};

function mockReport() {
  const view = el('div', { class: 'view narrow' });
  const pct = Math.round(mock.score / MOCK_N * 100);
  view.appendChild(pageHead('Round 1 mock', 'Your result',
    'Team score is the average of every member, so compare these across the team — the lowest one is the number that matters.'));

  const hero = el('div', { class: 'score-hero', style: 'margin-bottom:18px' });
  hero.appendChild(ring(pct, mock.score + '/' + MOCK_N, 'score'));
  const side = el('div', { style: 'flex:1;min-width:220px;display:flex;flex-direction:column;gap:12px' });
  const stats = el('div', { class: 'tiles' });
  stats.appendChild(tile('Accuracy', pct + '%', '', pct >= 70 ? 'var(--ok)' : pct >= 47 ? 'var(--warn)' : 'var(--bad)'));
  stats.appendChild(tile('Time used', fmtClock(mock.elapsed), 'of 15:00'));
  stats.appendChild(tile('Per question', fmtClock(Math.round(mock.elapsed / MOCK_N)), 'target 1:00'));
  side.appendChild(stats);
  const verdict = pct >= 73 ? 'Shortlist range. Hold this and spend your time on the coding half.'
    : pct >= 47 ? 'Borderline. The gap is usually one or two topics, not general weakness — see the breakdown.'
    : 'Below the line. Drill the red topics below before taking another mock.';
  side.appendChild(el('p', { class: 'lede', text: verdict }));
  hero.appendChild(side);
  view.appendChild(hero);

  // topic breakdown for this attempt
  const per = {};
  mock.qs.forEach(function (q, i) {
    if (!per[q.topic]) per[q.topic] = { n: 0, ok: 0 };
    per[q.topic].n++;
    if (mock.picks[i] === q.answerIndex) per[q.topic].ok++;
  });
  const bd = el('div', { class: 'card card-pad', style: 'margin-bottom:18px' });
  bd.appendChild(el('h2', { text: 'By topic, this attempt' }));
  const rows = el('div', { class: 'bar-rows', style: 'margin-top:12px' });
  Object.keys(per).sort(function (a, b) { return (per[a].ok / per[a].n) - (per[b].ok / per[b].n); }).forEach(function (t) {
    const p = per[t], q = Math.round(p.ok / p.n * 100);
    rows.appendChild(barRow(topicLabel(t), q, p.ok + '/' + p.n,
      q >= 70 ? 'var(--ok)' : q >= 40 ? 'var(--warn)' : 'var(--bad)'));
  });
  bd.appendChild(rows);
  view.appendChild(bd);

  const actions = el('div', { style: 'display:flex;gap:9px;margin-bottom:18px;flex-wrap:wrap' });
  actions.appendChild(el('button', { class: 'btn btn-primary', text: 'New mock', onclick: function () { go('mock', { restart: true }); } }));
  actions.appendChild(el('button', { class: 'btn', text: 'Back to dashboard', onclick: function () { mock = null; go('dashboard'); } }));
  view.appendChild(actions);

  view.appendChild(el('h2', { text: 'Full review', style: 'margin-bottom:12px' }));
  mock.qs.forEach(function (q, i) {
    const pick = mock.picks[i];
    const right = pick === q.answerIndex;
    const d = el('details', { class: 'card', style: 'margin-bottom:9px' });
    const sum = el('summary', { class: 'disclose-btn' });
    sum.appendChild(icon('chevron', 'caret'));
    sum.appendChild(el('span', { class: 'q-idx', text: 'Q' + (i + 1) }));
    sum.appendChild(el('span', { text: right ? 'Correct' : pick === undefined ? 'Skipped' : 'Wrong', style: 'color:' + (right ? 'var(--ok)' : pick === undefined ? 'var(--text-faint)' : 'var(--bad)') }));
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
    const v = el('div', { class: 'verdict-body', style: 'padding-left:0;padding-right:0' });
    v.appendChild(mdBlock(q.explanation));
    if (q.takeaway) {
      const t = el('div', { class: 'takeaway' });
      t.appendChild(icon('bulb'));
      t.appendChild(el('span', { html: inlineMd(q.takeaway) }));
      v.appendChild(t);
    }
    body.appendChild(v);
    d.appendChild(body);
    view.appendChild(d);
  });

  return view;
}

/* ---- Round 2: case studio ---------------------------------------------- */

const caseState = { openId: null, timed: false };

ROUTES.cases = function (params) {
  const wrap = el('div', { class: 'view' });

  if (params.id || caseState.openId) {
    const id = params.id || caseState.openId;
    const c = APP.cases.filter(function (x) { return x.id === id; })[0];
    if (c) { caseState.openId = id; wrap.appendChild(caseDetail(c, false)); return wrap; }
  }
  caseState.openId = null;

  wrap.appendChild(pageHead('Round 2 · 16 Aug, 12:00–16:00 IST', 'Case studio: brand visibility',
    'Forty-five minutes, one sitting, one attempt, marked on analytical thinking, strategic approach and actionable insight. The case itself is unseen — so drill the method, then the cases.'));

  const method = el('div', { class: 'card card-pad', style: 'margin-bottom:18px' });
  method.appendChild(el('h2', { text: 'The method — learn this first' }));
  method.appendChild(el('p', { class: 'lede', style: 'font-size:.875rem;margin:6px 0 14px', text: 'You cannot memorise the case. You can memorise the shape of a full-marks answer.' }));
  (APP.caseMethod || []).forEach(function (s) {
    const d = el('details', { class: 'disclose' });
    const sum = el('summary', { class: 'disclose-btn' });
    sum.appendChild(icon('chevron', 'caret'));
    sum.appendChild(el('span', { text: s.title }));
    d.appendChild(sum);
    const body = el('div', { class: 'disclose-body' });
    body.appendChild(mdBlock(s.body));
    if (s.checklist && s.checklist.length) {
      body.appendChild(el('div', { class: 'section-label', style: 'margin:14px 0 7px', text: 'Checklist' }));
      body.appendChild(mdBlock(s.checklist.map(function (x) { return '- ' + x; }).join('\n')));
    }
    d.appendChild(body);
    method.appendChild(d);
  });
  wrap.appendChild(method);

  wrap.appendChild(el('h2', { text: 'Practice cases', style: 'margin-bottom:4px' }));
  wrap.appendChild(el('p', { class: 'lede', style: 'margin-bottom:12px;font-size:.875rem', text: 'Each one runs on a real 45-minute clock if you want it to. Write your answer first, then open the model answer and score yourself against the evaluator checklist.' }));

  const listEl = el('div', { class: 'list' });
  APP.cases.forEach(function (c, i) {
    const rec = STATE.cases[c.id];
    const answered = rec ? Object.keys(rec.answers || {}).length : 0;
    const row = el('button', { class: 'list-row', type: 'button', onclick: function () { go('cases', { id: c.id }); } });
    row.appendChild(el('span', { class: 'lr-num', text: String(i + 1).padStart(2, '0') }));
    const main = el('div', { class: 'lr-main' });
    main.appendChild(el('span', { class: 'lr-title', text: c.title }));
    main.appendChild(el('span', { class: 'lr-sub', text: c.industry + ' · ' + (c.questions || []).length + ' questions' }));
    row.appendChild(main);
    if (answered) row.appendChild(el('span', { class: 'chip ok', text: answered + ' answered' }));
    row.appendChild(el('span', { class: 'chip ' + (c.difficulty || 'medium'), text: c.difficulty || 'medium' }));
    listEl.appendChild(row);
  });
  wrap.appendChild(listEl);
  return wrap;
};

ROUTES.r2sim = function (params) {
  const c = APP.cases.filter(function (x) { return x.id === params.id; })[0] || APP.cases[0];
  const box = el('div');
  const timer = examBar('Round 2 sim · ' + c.title, 45 * 60 * 1000,
    function () { toast('45 minutes up — stop typing'); },
    function () { stopTimer(); go('cases', { id: c.id }); });
  box.appendChild(timer.bar);
  box.appendChild(timer.drain);
  const view = el('div', { class: 'view' });
  view.appendChild(caseDetail(c, true));
  box.appendChild(view);
  return box;
};

function caseDetail(c, timed) {
  const rec = caseRec(c.id);
  const box = el('div');

  if (!timed) {
    const top = el('div', { style: 'display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-bottom:14px' });
    top.appendChild(el('button', { class: 'btn btn-sm btn-ghost', text: '← All cases', onclick: function () { caseState.openId = null; go('cases'); } }));
    top.appendChild(el('span', { style: 'flex:1' }));
    const startBtn = el('button', { class: 'btn btn-primary btn-sm', onclick: function () { go('r2sim', { id: c.id }); } });
    startBtn.appendChild(icon('timer'));
    startBtn.appendChild(document.createTextNode('Run it on the 45-minute clock'));
    top.appendChild(startBtn);
    box.appendChild(top);
  }

  const head = el('div', { class: 'page-head' });
  head.appendChild(el('div', { class: 'eyebrow', text: c.industry }));
  head.appendChild(el('h1', { text: c.title }));
  if (c.timeAllocation) head.appendChild(el('p', { class: 'lede', text: c.timeAllocation }));
  box.appendChild(head);

  const scenario = el('div', { class: 'card card-pad' });
  scenario.appendChild(el('div', { class: 'section-label', style: 'margin-bottom:9px', text: 'The brief' }));
  scenario.appendChild(mdBlock(c.scenario, 'prose-serif'));
  if (c.data) {
    scenario.appendChild(el('div', { class: 'section-label', style: 'margin:18px 0 9px', text: 'The numbers you were given' }));
    scenario.appendChild(mdBlock(c.data));
  }
  box.appendChild(scenario);

  (c.questions || []).forEach(function (q, qi) {
    const grid = el('div', { class: 'case-grid', style: 'margin-top:18px' });

    const left = el('div', { class: 'card card-pad' });
    const qh = el('div', { style: 'display:flex;gap:9px;align-items:baseline;flex-wrap:wrap;margin-bottom:9px' });
    qh.appendChild(el('span', { class: 'q-idx', text: 'Q' + (qi + 1) }));
    if (q.suggestedMinutes) qh.appendChild(el('span', { class: 'chip', text: '~' + q.suggestedMinutes + ' min' }));
    left.appendChild(qh);
    left.appendChild(el('h3', { text: q.q }));
    if (q.whatTheyAreTesting) {
      left.appendChild(el('p', { class: 'lede', style: 'font-size:.83rem;margin-top:7px', text: 'Testing: ' + q.whatTheyAreTesting }));
    }

    const reveal = el('details', { class: 'disclose', style: 'margin-top:14px' });
    const rsum = el('summary', { class: 'disclose-btn' });
    rsum.appendChild(icon('chevron', 'caret'));
    rsum.appendChild(el('span', { text: 'Model answer + evaluator checklist' }));
    rsum.appendChild(el('span', { class: 'chip accent', style: 'margin-left:auto', text: 'write yours first' }));
    reveal.appendChild(rsum);
    const rbody = el('div', { class: 'disclose-body' });
    rbody.appendChild(mdBlock(q.modelAnswer, 'prose-serif'));
    if (q.scoringPoints && q.scoringPoints.length) {
      rbody.appendChild(el('div', { class: 'section-label', style: 'margin:16px 0 8px', text: 'Score yourself — tick what your answer actually contained' }));
      const sc = el('div', { class: 'score-check' });
      q.scoringPoints.forEach(function (pt, pi) {
        const lab = el('label');
        const cb = el('input', { type: 'checkbox' });
        if (rec.scored[qi] && rec.scored[qi][pi]) cb.checked = true;
        cb.addEventListener('change', function () {
          if (!rec.scored[qi]) rec.scored[qi] = [];
          rec.scored[qi][pi] = cb.checked;
          saveState();
        });
        lab.appendChild(cb);
        lab.appendChild(el('span', { html: inlineMd(pt) }));
        sc.appendChild(lab);
      });
      rbody.appendChild(sc);
    }
    reveal.appendChild(rbody);
    left.appendChild(reveal);
    grid.appendChild(left);

    const pad = el('div', { class: 'answer-pad' });
    const padCard = el('div', { class: 'card card-pad' });
    padCard.appendChild(el('div', { class: 'section-label', style: 'margin-bottom:8px', text: 'Your answer' }));
    const ta = el('textarea', {
      class: 'field', style: 'width:100%',
      placeholder: 'Structure it: what is happening → why → what you would do → how you would measure it → what could go wrong.',
    });
    ta.value = (rec.answers && rec.answers[qi]) || '';
    const wc = el('div', { class: 'word-count' });
    function countWords() {
      const n = ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0;
      wc.textContent = n + ' words' + (n < 90 ? ' — thin for a marked answer' : n > 400 ? ' — you are over-writing for the clock' : '');
    }
    ta.addEventListener('input', function () {
      rec.answers[qi] = ta.value; saveState(); countWords();
    });
    countWords();
    padCard.appendChild(ta);
    padCard.appendChild(wc);
    pad.appendChild(padCard);
    grid.appendChild(pad);

    box.appendChild(grid);
  });

  if (c.commonMistakes && c.commonMistakes.length) {
    const m = el('div', { class: 'card card-pad', style: 'margin-top:18px' });
    m.appendChild(el('h3', { text: 'What loses marks on this case' }));
    m.appendChild(mdBlock(c.commonMistakes.map(function (x) { return '- ' + x; }).join('\n')));
    box.appendChild(m);
  }
  return box;
}

/* ---- Reading views ------------------------------------------------------ */

function cardSections(items, opts) {
  const wrap = el('div');
  const sections = {};
  items.forEach(function (c) { (sections[c.section || 'General'] = sections[c.section || 'General'] || []).push(c); });
  Object.keys(sections).forEach(function (sec) {
    wrap.appendChild(el('h2', { text: sec, style: 'margin:26px 0 12px' }));
    const grid = el('div', { style: 'display:grid;gap:12px' });
    sections[sec].forEach(function (c) {
      const d = el('details', { class: 'card' });
      const sum = el('summary', { class: 'disclose-btn', style: 'padding:13px 16px' });
      sum.appendChild(icon('chevron', 'caret'));
      sum.appendChild(el('strong', { text: c.title }));
      if (STATE.read[c.id]) sum.appendChild(el('span', { class: 'chip ok', style: 'margin-left:auto', text: 'read' }));
      d.appendChild(sum);
      const body = el('div', { style: 'padding:0 16px 16px 42px' });
      body.appendChild(mdBlock(c.body));
      if (c.keyTerms && c.keyTerms.length) {
        body.appendChild(el('div', { class: 'section-label', style: 'margin:16px 0 8px', text: 'Key terms' }));
        body.appendChild(mdBlock(c.keyTerms.map(function (t) { return '- **' + t.term + '** — ' + t.definition; }).join('\n')));
      }
      if (c.whyItMatters) {
        const t = el('div', { class: 'takeaway', style: 'margin-top:14px' });
        t.appendChild(icon('bulb'));
        t.appendChild(el('span', { html: inlineMd(c.whyItMatters) }));
        body.appendChild(t);
      }
      if (c.examTie) {
        body.appendChild(el('p', { class: 'lede', style: 'font-size:.83rem;margin-top:12px', text: 'In the exam: ' + c.examTie }));
      }
      d.addEventListener('toggle', function () { if (d.open) { STATE.read[c.id] = true; saveState(); } });
      grid.appendChild(d);
    });
    wrap.appendChild(grid);
  });
  return wrap;
}

ROUTES.theme = function () {
  const wrap = el('div', { class: 'view narrow' });
  wrap.appendChild(pageHead('Theme brief', 'Speak to Agents',
    'The domain knowledge behind the theme. This is what turns a generic case-study answer into one that sounds like it came from someone who works on this.'));
  wrap.appendChild(cardSections(APP.theme));
  return wrap;
};

function playbookView(sections, eyebrow, title, lede) {
  const wrap = el('div', { class: 'view narrow' });
  wrap.appendChild(pageHead(eyebrow, title, lede));
  (sections || []).forEach(function (s) {
    const card = el('div', { class: 'card card-pad', style: 'margin-bottom:14px' });
    card.appendChild(el('h2', { text: s.title }));
    card.appendChild(el('div', { style: 'margin-top:10px' }, mdBlock(s.body)));
    if (s.checklist && s.checklist.length) {
      card.appendChild(el('div', { class: 'section-label', style: 'margin:16px 0 8px', text: 'Checklist' }));
      const sc = el('div', { class: 'score-check' });
      s.checklist.forEach(function (item, i) {
        const key = s.id + ':' + i;
        const lab = el('label');
        const cb = el('input', { type: 'checkbox' });
        cb.checked = !!STATE.read[key];
        cb.addEventListener('change', function () { STATE.read[key] = cb.checked; saveState(); });
        lab.appendChild(cb);
        lab.appendChild(el('span', { html: inlineMd(item) }));
        sc.appendChild(lab);
      });
      card.appendChild(sc);
    }
    wrap.appendChild(card);
  });
  return wrap;
}

ROUTES.strategy = function () {
  return playbookView(APP.strategy, 'Rounds 1 & 2', 'Exam strategy',
    'Fifteen questions in fifteen minutes and two problems in forty-five. Most marks are lost to clock management, not to not knowing the answer.');
};

ROUTES.dev = function () {
  return playbookView(APP.dev, 'Round 3 · 27 Aug – 13 Sep', 'Build guide',
    'The problem statement drops when the round opens. Everything here you can build, decide or write before that happens.');
};

/* ---- Flashcards --------------------------------------------------------- */

let flashDeck = null, flashIdx = 0, flashFlipped = false;

function buildDeck() {
  const cards = [];
  APP.mcq.forEach(function (q) {
    if (q.takeaway) cards.push({ key: 'm:' + q.id, front: q.subtopic || topicLabel(q.topic), back: q.takeaway, tag: topicLabel(q.topic) });
  });
  APP.coding.forEach(function (p) {
    if (p.patternTakeaway) cards.push({ key: 'c:' + p.id, front: p.title, back: p.patternTakeaway, tag: 'Coding pattern' });
  });
  (APP.theme || []).forEach(function (c) {
    (c.keyTerms || []).forEach(function (t, i) {
      cards.push({ key: 't:' + c.id + ':' + i, front: t.term, back: t.definition, tag: c.section });
    });
  });
  // Leitner: due boxes first, then unseen, then the rest.
  const now = Date.now();
  return cards.sort(function (a, b) {
    const ra = STATE.flash[a.key], rb = STATE.flash[b.key];
    const da = ra ? (ra.due <= now ? 0 : 2) : 1;
    const db = rb ? (rb.due <= now ? 0 : 2) : 1;
    return da - db;
  });
}

ROUTES.flash = function () {
  const wrap = el('div', { class: 'view narrow' });
  wrap.appendChild(pageHead('Rapid revision', 'Flashcards',
    'Every takeaway from the question bank, every coding pattern, every key term. Cards you get wrong come back sooner.'));

  if (!flashDeck) { flashDeck = buildDeck(); flashIdx = 0; }
  if (!flashDeck.length) { wrap.appendChild(el('div', { class: 'empty', text: 'No cards yet.' })); return wrap; }
  if (flashIdx >= flashDeck.length) flashIdx = 0;
  const card = flashDeck[flashIdx];

  const stage = el('div', { class: 'flash-stage' });
  const f = el('div', { class: 'flash', onclick: function () { flashFlipped = !flashFlipped; go('flash'); } });
  f.appendChild(el('div', { class: 'face-label', text: flashFlipped ? 'Answer' : 'Prompt · tap to flip' }));
  f.appendChild(el('div', { class: 'chip', style: 'position:absolute;top:11px;right:14px', text: card.tag }));
  if (!flashFlipped) {
    f.appendChild(el('div', { class: 'flash-q', html: inlineMd(card.front) }));
  } else {
    f.appendChild(el('div', { class: 'flash-q', html: inlineMd(card.front) }));
    f.appendChild(el('hr', { class: 'divider', style: 'margin:6px 0' }));
    f.appendChild(el('div', { class: 'flash-a', html: inlineMd(card.back) }));
  }
  stage.appendChild(f);
  wrap.appendChild(stage);

  function grade(box) {
    const days = [0, 1, 3, 7, 21][box] || 0;
    STATE.flash[card.key] = { box: box, due: Date.now() + days * 86400000 };
    saveState();
    flashFlipped = false;
    flashIdx++;
    if (flashIdx >= flashDeck.length) { flashDeck = buildDeck(); flashIdx = 0; toast('Deck reshuffled'); }
    go('flash');
  }

  const actions = el('div', { class: 'flash-actions' });
  if (flashFlipped) {
    actions.appendChild(el('button', { class: 'btn', style: 'border-color:var(--bad-line);color:var(--bad)', text: 'Missed it', onclick: function () { grade(1); } }));
    actions.appendChild(el('button', { class: 'btn', text: 'Shaky', onclick: function () { grade(2); } }));
    actions.appendChild(el('button', { class: 'btn', style: 'border-color:var(--ok-line);color:var(--ok)', text: 'Knew it', onclick: function () { grade(4); } }));
  } else {
    actions.appendChild(el('button', { class: 'btn btn-primary', text: 'Flip  (Space)', onclick: function () { flashFlipped = true; go('flash'); } }));
    actions.appendChild(el('button', { class: 'btn', text: 'Skip →', onclick: function () { flashIdx++; go('flash'); } }));
  }
  wrap.appendChild(actions);
  wrap.appendChild(el('p', { class: 'lede', style: 'text-align:center;margin-top:14px;font-size:.8rem', text: (flashIdx + 1) + ' of ' + flashDeck.length + ' in this pass' }));
  return wrap;
};

/* ---- Progress ----------------------------------------------------------- */

ROUTES.progress = function () {
  const wrap = el('div', { class: 'view narrow' });
  const ms = mcqStats(), cs = codeStats();
  wrap.appendChild(pageHead('Progress', 'Where the team stands',
    'Progress is stored in this browser only. Export it and send the file to a teammate to compare, or to move devices.'));

  const tiles = el('div', { class: 'tiles', style: 'margin-bottom:18px' });
  const acc = ms.attempts ? Math.round(ms.correct / ms.attempts * 100) : 0;
  tiles.appendChild(tile('Coverage', Math.round(ms.seen / ms.total * 100) + '%', ms.seen + ' of ' + ms.total + ' MCQs'));
  tiles.appendChild(tile('Accuracy', acc + '%', ms.correct + ' of ' + ms.attempts));
  tiles.appendChild(tile('Coding', cs.solved + '/' + cs.total, 'marked solved'));
  tiles.appendChild(tile('Starred', String(ms.starred), 'flagged to revisit'));
  wrap.appendChild(tiles);

  const bd = el('div', { class: 'card card-pad', style: 'margin-bottom:18px' });
  bd.appendChild(el('h2', { text: 'Topic by topic' }));
  const rows = el('div', { class: 'bar-rows', style: 'margin-top:12px' });
  Object.keys(TOPIC_META).forEach(function (t) {
    const p = ms.perTopic[t];
    if (!p) return;
    const a = p.attempts ? Math.round(p.correct / p.attempts * 100) : 0;
    rows.appendChild(barRow(topicLabel(t), p.attempts ? a : 0,
      p.attempts ? a + '%' : '—',
      !p.attempts ? 'var(--surface-3)' : a >= 70 ? 'var(--ok)' : a >= 50 ? 'var(--warn)' : 'var(--bad)'));
  });
  bd.appendChild(rows);
  wrap.appendChild(bd);

  if (STATE.mocks.length) {
    const mk = el('div', { class: 'card card-pad', style: 'margin-bottom:18px' });
    mk.appendChild(el('h2', { text: 'Mock history' }));
    const tbl = ['| When | Score | Time |', '|---|---|---|'].concat(
      STATE.mocks.slice().reverse().map(function (m) {
        const d = new Date(m.at);
        return '| ' + d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
          ' | ' + m.score + '/' + m.total + ' | ' + fmtClock(m.elapsedMs) + ' |';
      })
    ).join('\n');
    mk.appendChild(mdBlock(tbl));
    wrap.appendChild(mk);
  }

  const io = el('div', { class: 'card card-pad' });
  io.appendChild(el('h2', { text: 'Move your progress' }));
  io.appendChild(el('p', { class: 'lede', style: 'font-size:.87rem;margin:7px 0 13px', text: 'Nothing is sent anywhere — the export is a plain JSON file you control.' }));
  const btns = el('div', { style: 'display:flex;gap:9px;flex-wrap:wrap' });
  const exp = el('button', {
    class: 'btn', onclick: function () {
      const blob = new Blob([JSON.stringify(STATE, null, 2)], { type: 'application/json' });
      const a = el('a', { href: URL.createObjectURL(blob), download: 'adobe-prep-progress.json' });
      document.body.appendChild(a); a.click(); a.remove();
      toast('Exported');
    },
  });
  exp.appendChild(icon('download'));
  exp.appendChild(document.createTextNode('Export progress'));
  btns.appendChild(exp);

  const fileIn = el('input', {
    type: 'file', accept: 'application/json', style: 'display:none',
    onchange: function (e) {
      const f = e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = function () {
        try {
          STATE = Object.assign(defaultState(), JSON.parse(rd.result));
          saveState(); toast('Progress imported'); go('progress');
        } catch (err) { toast('That file did not parse'); }
      };
      rd.readAsText(f);
    },
  });
  btns.appendChild(fileIn);
  btns.appendChild(el('button', { class: 'btn', text: 'Import progress', onclick: function () { fileIn.click(); } }));
  const rst = el('button', {
    class: 'btn', style: 'color:var(--bad);border-color:var(--bad-line)',
    text: 'Reset everything',
    onclick: function () {
      if (confirm('Wipe all progress in this browser? This cannot be undone.')) {
        STATE = defaultState(); saveState(); toast('Reset'); go('progress');
      }
    },
  });
  btns.appendChild(rst);
  io.appendChild(btns);
  wrap.appendChild(io);
  return wrap;
};

/* ---- Search ------------------------------------------------------------- */

ROUTES.search = function (params) {
  const wrap = el('div', { class: 'view narrow' });
  wrap.appendChild(pageHead('Search', 'Find anything',
    'Searches every question, coding problem, case study and concept card.'));

  const input = el('input', { class: 'field', type: 'search', placeholder: 'e.g. topological sort, GEO, deadlock, share of voice', style: 'width:100%;padding:10px 13px;font-size:.95rem' });
  wrap.appendChild(input);
  const results = el('div', { style: 'margin-top:16px' });
  wrap.appendChild(results);

  function run() {
    const term = input.value.trim().toLowerCase();
    clear(results);
    if (term.length < 2) return;
    const hits = [];
    APP.mcq.forEach(function (q) {
      const hay = (q.question + ' ' + q.explanation + ' ' + q.takeaway + ' ' + (q.tags || []).join(' ')).toLowerCase();
      if (hay.indexOf(term) !== -1) hits.push({ kind: 'MCQ', title: q.subtopic || topicLabel(q.topic), sub: q.question.slice(0, 150).replace(/[#`]/g, ''), go: function () { practiceState.topic = 'all'; practiceState.pool = 'all'; practiceState.list = [q]; practiceState.idx = 0; go('practice'); } });
    });
    APP.coding.forEach(function (p) {
      const hay = (p.title + ' ' + p.statement + ' ' + (p.topics || []).join(' ') + ' ' + (p.patternTakeaway || '')).toLowerCase();
      if (hay.indexOf(term) !== -1) hits.push({ kind: 'Coding', title: p.title, sub: (p.topics || []).join(' · '), go: function () { go('coding', { id: p.id }); } });
    });
    (APP.theme || []).forEach(function (c) {
      const hay = (c.title + ' ' + c.body + ' ' + (c.keyTerms || []).map(function (t) { return t.term + ' ' + t.definition; }).join(' ')).toLowerCase();
      if (hay.indexOf(term) !== -1) hits.push({ kind: 'Concept', title: c.title, sub: c.section, go: function () { go('theme'); } });
    });
    APP.cases.forEach(function (c) {
      const hay = (c.title + ' ' + c.scenario + ' ' + (c.questions || []).map(function (q) { return q.q + ' ' + q.modelAnswer; }).join(' ')).toLowerCase();
      if (hay.indexOf(term) !== -1) hits.push({ kind: 'Case', title: c.title, sub: c.industry, go: function () { go('cases', { id: c.id }); } });
    });
    [].concat(APP.strategy || [], APP.dev || [], APP.caseMethod || []).forEach(function (s) {
      if ((s.title + ' ' + s.body).toLowerCase().indexOf(term) !== -1) {
        hits.push({ kind: 'Playbook', title: s.title, sub: '', go: function () { go(APP.dev.indexOf(s) !== -1 ? 'dev' : APP.strategy.indexOf(s) !== -1 ? 'strategy' : 'cases'); } });
      }
    });

    if (!hits.length) { results.appendChild(el('div', { class: 'empty', text: 'Nothing matched “' + term + '”.' })); return; }
    results.appendChild(el('p', { class: 'lede', style: 'margin-bottom:10px;font-size:.85rem', text: hits.length + ' matches' }));
    const list = el('div', { class: 'list' });
    hits.slice(0, 60).forEach(function (h) {
      const row = el('button', { class: 'list-row', type: 'button', onclick: h.go });
      row.appendChild(el('span', { class: 'chip', text: h.kind }));
      const main = el('div', { class: 'lr-main search-hit' });
      main.appendChild(el('span', { class: 'lr-title', text: h.title }));
      main.appendChild(el('span', { class: 'lr-sub', text: h.sub }));
      row.appendChild(main);
      list.appendChild(row);
    });
    results.appendChild(list);
  }
  input.addEventListener('input', run);
  setTimeout(function () { input.focus(); }, 30);
  if (params.q) { input.value = params.q; run(); }
  return wrap;
};
