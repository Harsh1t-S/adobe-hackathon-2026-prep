/* ==========================================================================
   Shell: rail navigation, theme, countdown ticker, keyboard shortcuts, boot.
   ========================================================================== */

const NAV = [
  { group: 'Round 1 — today' },
  { route: 'dashboard', label: 'Command centre', icon: 'gauge' },
  { route: 'mock', label: 'Round 1 mock', icon: 'timer' },
  { route: 'practice', label: 'MCQ practice', icon: 'list', count: function () { return APP.mcq.length; } },
  { route: 'coding', label: 'Coding lab', icon: 'code', count: function () { return APP.coding.length; } },
  { group: 'Round 2 — 16 Aug' },
  { route: 'cases', label: 'Case studio', icon: 'brief', count: function () { return APP.cases.length; } },
  { route: 'theme', label: 'Theme brief', icon: 'layers', count: function () { return APP.theme.length; } },
  { group: 'Prep' },
  { route: 'strategy', label: 'Exam strategy', icon: 'target' },
  { route: 'flash', label: 'Flashcards', icon: 'cards' },
  { route: 'dev', label: 'Round 3 build guide', icon: 'book' },
  { route: 'progress', label: 'Progress', icon: 'chart' },
  { route: 'search', label: 'Search', icon: 'search' },
];

function buildRail() {
  const rail = el('aside', { class: 'rail' });

  const head = el('div', { class: 'rail-head' });
  const mark = el('div', { class: 'rail-mark' });
  mark.appendChild(el('span', { class: 'glyph', text: 'A' }));
  mark.appendChild(el('span', { text: 'Hackathon Prep' }));
  head.appendChild(mark);
  head.appendChild(el('div', { class: 'rail-sub', text: 'Adobe UH 2026' }));
  rail.appendChild(head);

  const nav = el('nav', { class: 'rail-nav', 'aria-label': 'Sections' });
  NAV.forEach(function (item) {
    if (item.group) { nav.appendChild(el('div', { class: 'nav-group', text: item.group })); return; }
    const b = el('button', { class: 'nav-item', type: 'button', 'data-route': item.route, onclick: function () { go(item.route); } });
    b.appendChild(icon(item.icon));
    b.appendChild(el('span', { text: item.label }));
    if (item.count) b.appendChild(el('span', { class: 'count', text: String(item.count()) }));
    nav.appendChild(b);
  });
  rail.appendChild(nav);

  const foot = el('div', { class: 'rail-foot' });
  const cd = el('div', { class: 'countdown-mini', id: 'railCountdown' });
  cd.appendChild(el('div', { class: 'cd-label', id: 'cdLabel', text: 'Next round' }));
  cd.appendChild(el('div', { class: 'cd-value', id: 'cdValue', text: '—' }));
  foot.appendChild(cd);

  const tools = el('div', { class: 'rail-tools' });
  const themeBtn = el('button', { class: 'icon-btn', type: 'button', title: 'Toggle light / dark', onclick: toggleTheme, id: 'themeBtn' });
  themeBtn.appendChild(icon(isDark() ? 'sun' : 'moon'));
  tools.appendChild(themeBtn);
  const searchBtn = el('button', { class: 'icon-btn', type: 'button', title: 'Search (/)', onclick: function () { go('search'); } });
  searchBtn.appendChild(icon('search'));
  tools.appendChild(searchBtn);
  tools.appendChild(el('span', { style: 'flex:1' }));
  tools.appendChild(el('span', { class: 'rail-sub', style: 'padding:0;font-size:.63rem', text: 'v' + APP.meta.version }));
  foot.appendChild(tools);
  rail.appendChild(foot);
  return rail;
}

function isDark() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t) return t === 'dark';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}
function toggleTheme() {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  STATE.theme = next; saveState();
  const btn = $('#themeBtn');
  if (btn) { clear(btn); btn.appendChild(icon(next === 'dark' ? 'sun' : 'moon')); }
}

function tickCountdown() {
  const r = nextRound();
  const st = roundState(r);
  const box = $('#railCountdown'), lab = $('#cdLabel'), val = $('#cdValue');
  if (!box) return;
  clear(lab);
  if (st.phase === 'live') {
    box.className = 'countdown-mini is-live';
    lab.appendChild(el('i', { class: 'pulse-dot' }));
    lab.appendChild(el('span', { text: 'R' + r.n + ' live · closes in' }));
  } else {
    const soon = st.ms < 6 * 3600 * 1000;
    box.className = 'countdown-mini' + (soon ? ' is-soon' : '');
    lab.appendChild(el('span', { text: 'Round ' + r.n + ' opens in' }));
  }
  val.textContent = fmtCountdown(st.ms);

  $$('[data-cd]').forEach(function (n) {
    const ms = Date.parse(n.getAttribute('data-cd')) - Date.now();
    n.textContent = ms > 0 ? 'in ' + fmtCountdown(ms) : 'now';
  });
}

function keyboard(e) {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

  if (e.key === '/') { e.preventDefault(); go('search'); return; }
  if (e.key === '?') { e.preventDefault(); showHelp(); return; }

  if (CURRENT === 'practice') {
    const card = $('.q-card');
    if (!card) return;
    const idx = ['1', '2', '3', '4'].indexOf(e.key);
    const alpha = ['a', 'b', 'c', 'd'].indexOf((e.key || '').toLowerCase());
    if (idx !== -1 && card._pick) { e.preventDefault(); card._pick(idx); }
    else if (alpha !== -1 && card._pick) { e.preventDefault(); card._pick(alpha); }
    else if (e.key === 's' && card._star) { e.preventDefault(); card._star(); }
    else if ((e.key === 'Enter' || e.key === 'n') && practiceState.answered !== null && card._next) { e.preventDefault(); card._next(); }
  }

  if (CURRENT === 'flash') {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flashFlipped = !flashFlipped; go('flash'); }
  }

  if (CURRENT === 'mock' && mock && !mock.done) {
    const idx = ['1', '2', '3', '4'].indexOf(e.key);
    if (idx !== -1) { e.preventDefault(); mock.picks[mock.cur] = idx; go('mock'); }
    if (e.key === 'ArrowRight' && mock.cur < MOCK_N - 1) { mock.cur++; go('mock'); }
    if (e.key === 'ArrowLeft' && mock.cur > 0) { mock.cur--; go('mock'); }
    if ((e.key || '').toLowerCase() === 'f') { mock.flags[mock.cur] = !mock.flags[mock.cur]; go('mock'); }
  }
}

function showHelp() {
  const back = el('div', { class: 'modal-back', onclick: function (e) { if (e.target === back) back.remove(); } });
  const m = el('div', { class: 'modal' });
  m.appendChild(el('h2', { text: 'Keyboard' }));
  m.appendChild(mdBlock([
    '| Key | Does |',
    '|---|---|',
    '| `1` `2` `3` `4` or `A`–`D` | Pick an option |',
    '| `Enter` / `N` | Next question (after answering) |',
    '| `S` | Star the current question |',
    '| `F` | Flag for review, during a mock |',
    '| `←` `→` | Move between mock questions |',
    '| `Space` | Flip a flashcard |',
    '| `/` | Search |',
    '| `?` | This panel |',
  ].join('\n')));
  m.appendChild(el('button', { class: 'btn btn-primary', text: 'Got it', onclick: function () { back.remove(); } }));
  back.appendChild(m);
  document.body.appendChild(back);
}

function boot() {
  loadState();
  if (STATE.theme) document.documentElement.setAttribute('data-theme', STATE.theme);

  const shell = el('div', { class: 'shell' });
  shell.appendChild(buildRail());

  const main = el('main', { class: 'main' });
  const top = el('div', { class: 'topbar' });
  top.appendChild(el('span', { class: 'crumb', id: 'crumb', text: 'Command centre' }));
  top.appendChild(el('span', { class: 'spacer' }));
  const mockBtn = el('button', { class: 'btn btn-sm btn-primary', onclick: function () { go('mock', { restart: true }); } });
  mockBtn.appendChild(icon('play'));
  mockBtn.appendChild(document.createTextNode('Start Round 1 mock'));
  top.appendChild(mockBtn);
  top.appendChild(el('button', { class: 'btn btn-sm btn-ghost', text: '?', title: 'Keyboard shortcuts', onclick: showHelp }));
  main.appendChild(top);
  main.appendChild(el('div', { id: 'viewport' }));
  shell.appendChild(main);

  document.body.appendChild(shell);

  go('dashboard');
  tickCountdown();
  setInterval(tickCountdown, 1000);
  document.addEventListener('keydown', keyboard);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
