/* ==========================================================================
   Views: dashboard, MCQ practice, coding lab.
   ========================================================================== */

const ROUTES = {};
let CURRENT = 'dashboard';

function go(route, params) {
  CURRENT = route;
  const main = $('#viewport');
  clear(main);
  document.body.classList.toggle('exam-mode', route === 'mock' || route === 'r2sim');
  const fn = ROUTES[route] || ROUTES.dashboard;
  main.appendChild(fn(params || {}));
  $$('.nav-item').forEach(function (b) {
    b.setAttribute('aria-current', b.dataset.route === route ? 'true' : 'false');
  });
  window.scrollTo(0, 0);
  const crumb = $('#crumb');
  if (crumb) crumb.textContent = NAV_LABEL[route] || '';
}

const NAV_LABEL = {
  dashboard: 'Command centre', practice: 'MCQ practice', mock: 'Round 1 mock',
  coding: 'Coding lab', cases: 'Round 2 case studio', r2sim: 'Round 2 mock',
  theme: 'Theme brief', strategy: 'Exam strategy', dev: 'Round 3 build guide',
  flash: 'Flashcards', progress: 'Progress', search: 'Search',
};

/* ---- Shared bits -------------------------------------------------------- */

function pageHead(eyebrow, title, lede, actions) {
  const h = el('div', { class: 'page-head' });
  if (eyebrow) h.appendChild(el('div', { class: 'eyebrow', text: eyebrow }));
  const row = el('div', { style: 'display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap' });
  row.appendChild(el('h1', { text: title }));
  if (actions) {
    row.appendChild(el('div', { style: 'flex:1' }));
    row.appendChild(actions);
  }
  h.appendChild(row);
  if (lede) h.appendChild(el('p', { class: 'lede', text: lede }));
  return h;
}

function tile(label, value, note, railColor) {
  const t = el('div', { class: 'tile' });
  if (railColor) t.appendChild(el('i', { class: 't-rail', style: 'background:' + railColor }));
  t.appendChild(el('div', { class: 't-label', text: label }));
  t.appendChild(el('div', { class: 't-value', text: value }));
  if (note) t.appendChild(el('div', { class: 't-note', text: note }));
  return t;
}

function ring(pct, label, sub) {
  const R = 54, C = 2 * Math.PI * R;
  const wrap = el('div', { class: 'ring' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 128 128');
  svg.innerHTML =
    '<circle class="ring-bg" cx="64" cy="64" r="' + R + '" fill="none" stroke-width="11"/>' +
    '<circle class="ring-fg" cx="64" cy="64" r="' + R + '" fill="none" stroke-width="11" ' +
    'stroke-dasharray="' + (C * pct / 100) + ' ' + C + '"/>';
  wrap.appendChild(svg);
  const lab = el('div', { class: 'ring-label' });
  lab.appendChild(el('div', { class: 'ring-num', text: label }));
  lab.appendChild(el('div', { class: 'ring-sub', text: sub }));
  wrap.appendChild(lab);
  return wrap;
}

function barRow(label, pct, valueText, color) {
  const r = el('div', { class: 'bar-row' });
  r.appendChild(el('div', { class: 'bl', text: label, title: label }));
  const track = el('div', { class: 'bar-track' });
  track.appendChild(el('i', { style: 'width:' + Math.max(pct, 1.5) + '%;background:' + (color || 'var(--accent)') }));
  r.appendChild(track);
  r.appendChild(el('div', { class: 'bv', text: valueText }));
  return r;
}

/* ---- Stats -------------------------------------------------------------- */

function mcqStats() {
  const all = APP.mcq;
  let seen = 0, correct = 0, attempts = 0, starred = 0;
  const perTopic = {};
  all.forEach(function (q) {
    const r = STATE.mcq[q.id];
    if (!perTopic[q.topic]) perTopic[q.topic] = { total: 0, seen: 0, correct: 0, attempts: 0 };
    perTopic[q.topic].total++;
    if (!r) return;
    if (r.seen) { seen++; perTopic[q.topic].seen++; }
    correct += r.correct; attempts += r.correct + r.wrong;
    perTopic[q.topic].correct += r.correct;
    perTopic[q.topic].attempts += r.correct + r.wrong;
    if (r.starred) starred++;
  });
  return { total: all.length, seen: seen, correct: correct, attempts: attempts, starred: starred, perTopic: perTopic };
}

function codeStats() {
  let solved = 0;
  APP.coding.forEach(function (p) { if ((STATE.code[p.id] || {}).solved) solved++; });
  return { total: APP.coding.length, solved: solved };
}

/* ---- Countdown ---------------------------------------------------------- */

function roundState(r) {
  const now = Date.now();
  const s = Date.parse(r.startISO), e = Date.parse(r.endISO);
  if (now < s) return { phase: 'upcoming', ms: s - now };
  if (now <= e) return { phase: 'live', ms: e - now };
  return { phase: 'past', ms: 0 };
}

function nextRound() {
  const now = Date.now();
  for (let i = 0; i < APP.meta.rounds.length; i++) {
    const r = APP.meta.rounds[i];
    if (Date.parse(r.endISO) >= now) return r;
  }
  return APP.meta.rounds[APP.meta.rounds.length - 1];
}

/* ---- Dashboard ---------------------------------------------------------- */

ROUTES.dashboard = function () {
  const wrap = el('div', { class: 'view' });
  const ms = mcqStats(), cs = codeStats();
  const acc = ms.attempts ? Math.round(ms.correct / ms.attempts * 100) : 0;

  wrap.appendChild(pageHead(
    'Adobe University Hackathon 2026',
    'Speak to Agents: The New Language of Brand Visibility',
    'Everything this team needs for Round 1 (MCQ + coding) and Round 2 (brand-visibility case study), with worked explanations for every answer.'
  ));

  // Live countdown strip
  const strip = el('div', { class: 'card card-pad', style: 'margin-bottom:18px' });
  strip.appendChild(el('div', { class: 'section-label', text: 'Rounds', style: 'margin-bottom:10px' }));
  const tl = el('div', { class: 'timeline' });
  APP.meta.rounds.forEach(function (r) {
    const st = roundState(r);
    const row = el('div', { class: 'tl-row ' + (st.phase === 'live' ? 'is-now' : st.phase === 'past' ? 'is-done' : '') });
    row.appendChild(el('div', { class: 'tl-when', text: r.shortDate }));
    const body = el('div', { class: 'tl-body' });
    const title = el('div', { class: 'tl-title' });
    title.appendChild(el('span', { class: 'num', text: String(r.n) }));
    title.appendChild(el('strong', { text: r.title }));
    if (st.phase === 'live') title.appendChild(el('span', { class: 'chip ok', html: '<i class="chip-dot"></i>Live now' }));
    else if (st.phase === 'upcoming') title.appendChild(el('span', { class: 'chip', 'data-cd': r.startISO, text: 'in ' + fmtCountdown(st.ms) }));
    else title.appendChild(el('span', { class: 'chip', text: 'Closed' }));
    body.appendChild(title);
    body.appendChild(el('div', { class: 'tl-when', text: r.window, style: 'text-align:left;font-size:.72rem' }));
    if (r.quote) body.appendChild(el('div', { class: 'tl-quote', text: '“' + r.quote + '”' }));
    row.appendChild(body);
    tl.appendChild(row);
  });
  strip.appendChild(tl);
  wrap.appendChild(strip);

  // Tiles
  const tiles = el('div', { class: 'tiles', style: 'margin-bottom:18px' });
  tiles.appendChild(tile('MCQs attempted', ms.seen + ' / ' + ms.total, 'across 9 topics', 'var(--accent)'));
  tiles.appendChild(tile('Accuracy', acc + '%', ms.attempts + ' answers logged', acc >= 70 ? 'var(--ok)' : acc >= 50 ? 'var(--warn)' : 'var(--bad)'));
  tiles.appendChild(tile('Coding solved', cs.solved + ' / ' + cs.total, 'Round 1 section B', 'var(--t4)'));
  tiles.appendChild(tile('Mocks taken', String(STATE.mocks.length), STATE.mocks.length ? 'best ' + Math.max.apply(null, STATE.mocks.map(function (m) { return m.score; })) + '/15' : 'none yet', 'var(--t6)'));
  wrap.appendChild(tiles);

  // Start-here grid
  const grid = el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:14px;margin-bottom:18px' });
  const starts = [
    { r: 'mock', t: 'Take the Round 1 mock', d: '15 MCQs, 15 minutes, exam chrome and auto-submit. The fastest way to find out where you actually are.', icon: 'timer', primary: true },
    { r: 'practice', t: 'Drill MCQs by topic', d: ms.total + ' questions with a worked explanation, distractor analysis and a one-line takeaway on every single one.', icon: 'list' },
    { r: 'coding', t: 'Work the coding lab', d: cs.total + ' problems with progressive hints, a dry-run walkthrough and solutions in Python, Java and C++.', icon: 'code' },
    { r: 'cases', t: 'Prep Round 2', d: 'Full brand-visibility cases with model answers, plus the 45-minute method for a case you have never seen.', icon: 'brief' },
  ];
  starts.forEach(function (s) {
    const c = el('button', {
      class: 'card card-pad', style: 'text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:8px;align-items:flex-start',
      onclick: function () { go(s.r); },
    });
    const head = el('div', { style: 'display:flex;align-items:center;gap:9px' });
    const badge = el('span', {
      style: 'width:28px;height:28px;border-radius:6px;display:grid;place-items:center;background:' +
        (s.primary ? 'var(--accent)' : 'var(--surface-2)') + ';color:' + (s.primary ? 'var(--accent-ink)' : 'var(--text-dim)'),
    });
    badge.appendChild(icon(s.icon));
    head.appendChild(badge);
    head.appendChild(el('strong', { text: s.t }));
    c.appendChild(head);
    c.appendChild(el('div', { class: 'lede', style: 'font-size:.855rem', text: s.d }));
    grid.appendChild(c);
  });
  wrap.appendChild(grid);

  // Weakest topics
  const weak = Object.keys(ms.perTopic)
    .map(function (k) {
      const p = ms.perTopic[k];
      return { k: k, acc: p.attempts ? p.correct / p.attempts : -1, attempts: p.attempts, seen: p.seen, total: p.total };
    })
    .filter(function (x) { return x.attempts >= 3; })
    .sort(function (a, b) { return a.acc - b.acc; });

  const two = el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px' });

  const weakCard = el('div', { class: 'card card-pad' });
  weakCard.appendChild(el('h2', { text: 'Where you are losing marks' }));
  if (weak.length) {
    weakCard.appendChild(el('p', { class: 'lede', style: 'font-size:.85rem;margin:6px 0 14px', text: 'Ranked by accuracy. Team score is the average of all members, so the weakest topic across the team is the one that costs you.' }));
    const rows = el('div', { class: 'bar-rows' });
    weak.slice(0, 6).forEach(function (w) {
      const pct = Math.round(w.acc * 100);
      rows.appendChild(barRow(topicLabel(w.k), pct, pct + '%',
        pct >= 70 ? 'var(--ok)' : pct >= 50 ? 'var(--warn)' : 'var(--bad)'));
    });
    weakCard.appendChild(rows);
    weakCard.appendChild(el('button', {
      class: 'btn btn-sm', style: 'margin-top:14px', text: 'Drill the weakest topic',
      onclick: function () { go('practice', { topic: weak[0].k }); },
    }));
  } else {
    const e = el('div', { class: 'empty' });
    e.appendChild(el('div', { text: 'Answer a few questions and your weak topics show up here.' }));
    e.appendChild(el('button', { class: 'btn btn-primary btn-sm', text: 'Start drilling', onclick: function () { go('practice'); } }));
    weakCard.appendChild(e);
  }
  two.appendChild(weakCard);

  const factCard = el('div', { class: 'card card-pad' });
  factCard.appendChild(el('h2', { text: 'The rules that decide this' }));
  factCard.appendChild(mdBlock(APP.meta.rulesBrief));
  two.appendChild(factCard);

  wrap.appendChild(two);
  return wrap;
};

/* ---- MCQ practice ------------------------------------------------------- */

const practiceState = { topic: 'all', diff: 'all', pool: 'all', idx: 0, list: [], answered: null };

function buildPool() {
  let list = APP.mcq.slice();
  if (practiceState.topic !== 'all') list = list.filter(function (q) { return q.topic === practiceState.topic; });
  if (practiceState.diff !== 'all') list = list.filter(function (q) { return q.difficulty === practiceState.diff; });
  if (practiceState.pool === 'unseen') list = list.filter(function (q) { return !(STATE.mcq[q.id] || {}).seen; });
  if (practiceState.pool === 'wrong') list = list.filter(function (q) { const r = STATE.mcq[q.id]; return r && r.wrong > 0; });
  if (practiceState.pool === 'starred') list = list.filter(function (q) { return (STATE.mcq[q.id] || {}).starred; });
  return list;
}

ROUTES.practice = function (params) {
  const wrap = el('div', { class: 'view narrow' });
  if (params.topic) { practiceState.topic = params.topic; practiceState.idx = 0; }

  wrap.appendChild(pageHead('Round 1 · Section A', 'MCQ practice',
    'Every question carries the full reasoning, why each wrong option is tempting, and a one-line rule to bank. In the real thing you get 60 seconds each.'));

  const bar = el('div', { class: 'filters' });

  const topicSel = el('select', { class: 'field', onchange: function (e) { practiceState.topic = e.target.value; practiceState.idx = 0; practiceState.answered = null; go('practice'); } });
  topicSel.appendChild(el('option', { value: 'all', text: 'All topics' }));
  Object.keys(TOPIC_META).forEach(function (k) {
    const n = APP.mcq.filter(function (q) { return q.topic === k; }).length;
    if (!n) return;
    topicSel.appendChild(el('option', { value: k, text: topicLabel(k) + ' (' + n + ')', selected: practiceState.topic === k }));
  });
  bar.appendChild(topicSel);

  const diffSel = el('select', { class: 'field', onchange: function (e) { practiceState.diff = e.target.value; practiceState.idx = 0; practiceState.answered = null; go('practice'); } });
  [['all', 'Any difficulty'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']].forEach(function (d) {
    diffSel.appendChild(el('option', { value: d[0], text: d[1], selected: practiceState.diff === d[0] }));
  });
  bar.appendChild(diffSel);

  const poolSeg = el('div', { class: 'seg' });
  [['all', 'All'], ['unseen', 'Unseen'], ['wrong', 'Got wrong'], ['starred', 'Starred']].forEach(function (p) {
    poolSeg.appendChild(el('button', {
      type: 'button', text: p[1], 'aria-pressed': practiceState.pool === p[0] ? 'true' : 'false',
      onclick: function () { practiceState.pool = p[0]; practiceState.idx = 0; practiceState.answered = null; go('practice'); },
    }));
  });
  bar.appendChild(poolSeg);
  bar.appendChild(el('span', { class: 'grow' }));
  bar.appendChild(el('button', {
    class: 'btn btn-sm', text: 'Shuffle',
    onclick: function () { practiceState.list = shuffle(buildPool(), (Date.now() % 99991) + 7); practiceState.idx = 0; practiceState.answered = null; go('practice'); },
  }));
  wrap.appendChild(bar);

  const pool = buildPool();
  if (!practiceState.list.length || practiceState.list.some(function (q) { return pool.indexOf(q) === -1; }) || practiceState.list.length !== pool.length) {
    practiceState.list = pool;
  }
  const list = practiceState.list;

  if (!list.length) {
    const e = el('div', { class: 'empty' });
    e.appendChild(el('div', { text: 'No questions match that filter.' }));
    e.appendChild(el('button', { class: 'btn btn-sm', text: 'Reset filters', onclick: function () { practiceState.topic = 'all'; practiceState.diff = 'all'; practiceState.pool = 'all'; go('practice'); } }));
    wrap.appendChild(e);
    return wrap;
  }

  if (practiceState.idx >= list.length) practiceState.idx = 0;
  const q = list[practiceState.idx];
  wrap.appendChild(questionCard(q, {
    index: practiceState.idx, total: list.length,
    onNext: function () { practiceState.idx = (practiceState.idx + 1) % list.length; practiceState.answered = null; go('practice'); },
    onPrev: function () { practiceState.idx = (practiceState.idx - 1 + list.length) % list.length; practiceState.answered = null; go('practice'); },
  }));
  return wrap;
};

function questionCard(q, opts) {
  const card = el('div', { class: 'card card-pad q-card' });
  card.appendChild(el('i', { class: 'q-stripe', style: 'background:' + topicHue(q.topic) }));

  const meta = el('div', { class: 'q-meta' });
  meta.appendChild(el('span', { class: 'q-idx', text: (opts.index + 1) + ' / ' + opts.total }));
  meta.appendChild(el('span', { class: 'chip', html: '<i class="chip-dot" style="background:' + topicHue(q.topic) + '"></i>' + esc(topicLabel(q.topic)) }));
  meta.appendChild(el('span', { class: 'chip ' + q.difficulty, text: q.difficulty }));
  if (q.subtopic) meta.appendChild(el('span', { class: 'chip', text: q.subtopic }));
  meta.appendChild(el('span', { class: 'spacer' }));

  const rec = mcqRec(q.id);
  const star = el('button', { class: 'icon-btn ' + (rec.starred ? 'is-on' : ''), title: 'Star for later (S)', type: 'button' });
  star.appendChild(icon('flag'));
  star.addEventListener('click', function () {
    rec.starred = !rec.starred; saveState();
    star.classList.toggle('is-on', rec.starred);
    toast(rec.starred ? 'Starred' : 'Unstarred');
  });
  meta.appendChild(star);
  card.appendChild(meta);

  card.appendChild(mdBlock(q.question, 'q-stem'));

  const opts_ = el('div', { class: 'opts' });
  const buttons = [];
  const KEYS = ['A', 'B', 'C', 'D'];

  function reveal(pick) {
    buttons.forEach(function (b, i) {
      b.disabled = true;
      if (i === q.answerIndex) b.dataset.state = 'correct';
      else if (i === pick) b.dataset.state = 'wrong';
    });
    const right = pick === q.answerIndex;
    rec.seen = (rec.seen || 0) + 1;
    rec.lastPick = pick;
    if (right) rec.correct++; else rec.wrong++;
    saveState();

    const v = el('div', { class: 'verdict ' + (right ? 'right' : 'wrong') });
    const vh = el('div', { class: 'verdict-head' });
    vh.appendChild(icon(right ? 'check' : 'x'));
    vh.appendChild(el('span', { text: right ? 'Correct' : 'Not quite — the answer is ' + KEYS[q.answerIndex] }));
    v.appendChild(vh);

    const vb = el('div', { class: 'verdict-body' });
    vb.appendChild(mdBlock(q.explanation));

    if (q.whyOthersWrong && q.whyOthersWrong.length) {
      const sec = el('div');
      sec.appendChild(el('div', { class: 'section-label', style: 'margin-bottom:7px', text: 'Why the others are wrong' }));
      const wl = el('div', { class: 'why-list' });
      q.whyOthersWrong.forEach(function (w) {
        const item = el('div', { class: 'why-item' });
        item.appendChild(el('span', { class: 'k', text: KEYS[w.optionIndex] || '?' }));
        item.appendChild(el('span', { html: inlineMd(w.reason) }));
        wl.appendChild(item);
      });
      sec.appendChild(wl);
      vb.appendChild(sec);
    }

    if (q.takeaway) {
      const t = el('div', { class: 'takeaway' });
      t.appendChild(icon('bulb'));
      t.appendChild(el('span', { html: inlineMd(q.takeaway) }));
      vb.appendChild(t);
    }

    if (q.verified === 'unverified') {
      vb.appendChild(el('div', {
        class: 'chip', style: 'align-self:flex-start',
        text: 'Not double-checked by the review pass — sanity-check this one yourself',
      }));
    }

    v.appendChild(vb);
    card.appendChild(v);

    const nav = el('div', { style: 'display:flex;gap:9px;margin-top:16px;flex-wrap:wrap' });
    const next = el('button', { class: 'btn btn-primary', text: 'Next question  →', onclick: opts.onNext });
    nav.appendChild(next);
    nav.appendChild(el('button', { class: 'btn', text: '← Previous', onclick: opts.onPrev }));
    card.appendChild(nav);
    next.focus();
    practiceState.answered = pick;
  }

  q.options.forEach(function (o, i) {
    const b = el('button', { class: 'opt', type: 'button' });
    b.appendChild(el('span', { class: 'key', text: KEYS[i] }));
    b.appendChild(el('span', { class: 'txt', html: inlineMd(o) }));
    b.addEventListener('click', function () { reveal(i); });
    buttons.push(b);
    opts_.appendChild(b);
  });
  card.appendChild(opts_);

  card._pick = function (i) { if (!buttons[i].disabled) reveal(i); };
  card._star = function () { star.click(); };
  card._next = opts.onNext;
  return card;
}

/* ---- Coding lab --------------------------------------------------------- */

const codingState = { idx: 0, lang: 'python', filter: 'all' };

ROUTES.coding = function (params) {
  const wrap = el('div', { class: 'view' });
  wrap.appendChild(pageHead('Round 1 · Section B', 'Coding lab',
    'Two problems in 45 minutes means roughly 22 minutes each. Every problem here is pitched at that budget: hints first, then the dry run, then full code in three languages.'));

  const bar = el('div', { class: 'filters' });
  const seg = el('div', { class: 'seg' });
  [['all', 'All'], ['unsolved', 'Unsolved'], ['solved', 'Solved']].forEach(function (f) {
    seg.appendChild(el('button', {
      type: 'button', text: f[1], 'aria-pressed': codingState.filter === f[0] ? 'true' : 'false',
      onclick: function () { codingState.filter = f[0]; go('coding'); },
    }));
  });
  bar.appendChild(seg);
  bar.appendChild(el('span', { class: 'grow' }));
  const cs = codeStats();
  bar.appendChild(el('span', { class: 'chip', text: cs.solved + ' of ' + cs.total + ' marked solved' }));
  wrap.appendChild(bar);

  let list = APP.coding.slice();
  if (codingState.filter === 'solved') list = list.filter(function (p) { return (STATE.code[p.id] || {}).solved; });
  if (codingState.filter === 'unsolved') list = list.filter(function (p) { return !(STATE.code[p.id] || {}).solved; });

  if (params.id) {
    const p = APP.coding.filter(function (x) { return x.id === params.id; })[0];
    if (p) { wrap.appendChild(problemDetail(p)); return wrap; }
  }

  if (!list.length) {
    wrap.appendChild(el('div', { class: 'empty', text: 'Nothing here with that filter.' }));
    return wrap;
  }

  const listEl = el('div', { class: 'list' });
  list.forEach(function (p, i) {
    const solved = (STATE.code[p.id] || {}).solved;
    const row = el('button', { class: 'list-row ' + (solved ? 'is-done' : ''), type: 'button', onclick: function () { go('coding', { id: p.id }); } });
    row.appendChild(el('span', { class: 'lr-num', text: String(i + 1).padStart(2, '0') }));
    const main = el('div', { class: 'lr-main' });
    main.appendChild(el('span', { class: 'lr-title', text: p.title }));
    main.appendChild(el('span', { class: 'lr-sub', text: (p.topics || []).join(' · ') }));
    row.appendChild(main);
    row.appendChild(el('span', { class: 'chip ' + p.difficulty, text: p.difficulty }));
    if (solved) row.appendChild(icon('check', 'solved-tick'));
    listEl.appendChild(row);
  });
  wrap.appendChild(listEl);
  return wrap;
};

function problemDetail(p) {
  const rec = codeRec(p.id);
  const box = el('div');

  const top = el('div', { style: 'display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-bottom:14px' });
  top.appendChild(el('button', { class: 'btn btn-sm btn-ghost', text: '← All problems', onclick: function () { go('coding'); } }));
  top.appendChild(el('span', { class: 'grow', style: 'flex:1' }));
  const solveBtn = el('button', {
    class: 'btn btn-sm ' + (rec.solved ? '' : 'btn-primary'),
    text: rec.solved ? 'Solved ✓' : 'Mark solved',
    onclick: function () { rec.solved = !rec.solved; saveState(); go('coding', { id: p.id }); },
  });
  top.appendChild(solveBtn);
  box.appendChild(top);

  const head = el('div', { class: 'page-head' });
  const trow = el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' });
  trow.appendChild(el('h1', { text: p.title }));
  trow.appendChild(el('span', { class: 'chip ' + p.difficulty, text: p.difficulty }));
  head.appendChild(trow);
  const tagRow = el('div', { class: 'pill-row' });
  (p.topics || []).forEach(function (t) { tagRow.appendChild(el('span', { class: 'chip', text: t })); });
  head.appendChild(tagRow);
  box.appendChild(head);

  const card = el('div', { class: 'card card-pad' });
  card.appendChild(mdBlock(p.statement));

  if (p.examples && p.examples.length) {
    card.appendChild(el('div', { class: 'section-label', style: 'margin:18px 0 8px', text: 'Examples' }));
    p.examples.forEach(function (ex, i) {
      const e = el('div', { class: 'card', style: 'padding:12px 14px;margin-bottom:8px;background:var(--surface-2)' });
      e.appendChild(el('div', { class: 'section-label', style: 'margin-bottom:6px', text: 'Example ' + (i + 1) }));
      e.appendChild(mdBlock('**Input:** `' + ex.input + '`\n\n**Output:** `' + ex.output + '`\n\n' + (ex.explanation || '')));
      card.appendChild(e);
    });
  }

  if (p.constraints && p.constraints.length) {
    card.appendChild(el('div', { class: 'section-label', style: 'margin:18px 0 8px', text: 'Constraints' }));
    card.appendChild(mdBlock(p.constraints.map(function (c) { return '- ' + c; }).join('\n')));
  }
  box.appendChild(card);

  // Progressive hints
  const hintWrap = el('div', { style: 'margin-top:16px' });
  hintWrap.appendChild(el('div', { class: 'section-label', style: 'margin-bottom:8px', text: 'Hints — open one at a time' }));
  (p.hints || []).forEach(function (h, i) {
    const d = el('details', { class: 'disclose', open: rec.revealed.indexOf(i) !== -1 });
    const sum = el('summary', { class: 'disclose-btn' });
    sum.appendChild(icon('chevron', 'caret'));
    sum.appendChild(el('span', { class: 'hint-n', text: 'Hint ' + (i + 1) }));
    sum.appendChild(el('span', { text: i === 0 ? 'A nudge' : i === 1 ? 'The approach' : 'Almost the whole algorithm' }));
    d.appendChild(sum);
    const body = el('div', { class: 'disclose-body' });
    body.appendChild(mdBlock(h));
    d.appendChild(body);
    d.addEventListener('toggle', function () {
      if (d.open && rec.revealed.indexOf(i) === -1) { rec.revealed.push(i); saveState(); }
    });
    hintWrap.appendChild(d);
  });
  box.appendChild(hintWrap);

  // Approach
  const app = el('div', { class: 'card card-pad', style: 'margin-top:16px' });
  app.appendChild(el('h2', { text: 'Approach' }));
  const cmp = el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin:12px 0' });
  [['Brute force', p.bruteForce, 'var(--text-faint)'], ['Optimal', p.optimal, 'var(--ok)']].forEach(function (pair) {
    if (!pair[1]) return;
    const c = el('div', { class: 'card', style: 'padding:12px 14px;background:var(--surface-2)' });
    c.appendChild(el('div', { class: 'section-label', style: 'color:' + pair[2], text: pair[0] }));
    c.appendChild(mdBlock(pair[1].idea, ''));
    const cx = el('div', { class: 'pill-row', style: 'margin-top:9px' });
    cx.appendChild(el('span', { class: 'chip', text: 'Time ' + pair[1].time }));
    cx.appendChild(el('span', { class: 'chip', text: 'Space ' + pair[1].space }));
    c.appendChild(cx);
    cmp.appendChild(c);
  });
  app.appendChild(cmp);
  if (p.walkthrough) {
    app.appendChild(el('div', { class: 'section-label', style: 'margin:16px 0 8px', text: 'Dry run' }));
    app.appendChild(mdBlock(p.walkthrough));
  }
  box.appendChild(app);

  // Solutions
  const sol = el('details', { class: 'card', style: 'margin-top:16px' });
  const ssum = el('summary', { class: 'disclose-btn', style: 'padding:14px 18px;font-size:.95rem' });
  ssum.appendChild(icon('chevron', 'caret'));
  ssum.appendChild(el('strong', { text: 'Show full solutions' }));
  ssum.appendChild(el('span', { class: 'chip', style: 'margin-left:auto', text: 'Python · Java · C++' }));
  sol.appendChild(ssum);
  const sbody = el('div', { style: 'padding:0 18px 18px' });
  const holder = el('div');
  const tabs = el('div', { class: 'lang-tabs' });
  function renderCode() {
    clear(holder);
    holder.appendChild(codeBlock(p.solutions[codingState.lang] || '', codingState.lang));
    $$('button', tabs).forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.lang === codingState.lang ? 'true' : 'false'); });
  }
  ['python', 'java', 'cpp'].forEach(function (l) {
    tabs.appendChild(el('button', {
      type: 'button', 'data-lang': l, text: l === 'cpp' ? 'C++' : l,
      onclick: function () { codingState.lang = l; renderCode(); },
    }));
  });
  sbody.appendChild(el('div', { style: 'display:flex;justify-content:flex-end;margin-bottom:8px' }, tabs));
  sbody.appendChild(holder);
  renderCode();
  sol.appendChild(sbody);
  box.appendChild(sol);

  // Edge cases / follow-ups / takeaway
  const extra = el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin-top:16px' });
  if (p.edgeCases && p.edgeCases.length) {
    const c = el('div', { class: 'card card-pad' });
    c.appendChild(el('h3', { text: 'Edge cases that break naive code' }));
    c.appendChild(mdBlock(p.edgeCases.map(function (x) { return '- ' + x; }).join('\n')));
    extra.appendChild(c);
  }
  if (p.followUps && p.followUps.length) {
    const c = el('div', { class: 'card card-pad' });
    c.appendChild(el('h3', { text: 'Follow-ups an interviewer would ask' }));
    c.appendChild(mdBlock(p.followUps.map(function (x) { return '- ' + x; }).join('\n')));
    extra.appendChild(c);
  }
  box.appendChild(extra);

  if (p.patternTakeaway) {
    const t = el('div', { class: 'takeaway', style: 'margin-top:16px' });
    t.appendChild(icon('bulb'));
    t.appendChild(el('span', { html: inlineMd(p.patternTakeaway) }));
    box.appendChild(t);
  }

  // Scratch notes
  const notes = el('div', { class: 'card card-pad', style: 'margin-top:16px' });
  notes.appendChild(el('h3', { text: 'Your notes' }));
  const ta = el('textarea', {
    class: 'field', style: 'width:100%;min-height:90px;margin-top:9px',
    placeholder: 'What tripped you up? Write it here — this is what you reread the night before.',
    oninput: function (e) { rec.notes = e.target.value; saveState(); },
  });
  ta.value = rec.notes || '';
  notes.appendChild(ta);
  box.appendChild(notes);

  return box;
}
