/* ==========================================================================
   Core: DOM helpers, storage, markdown, syntax highlighting, icons.
   No dependencies — the Artifact CSP blocks every external host.
   ========================================================================== */

const APP = window.PREP_DATA;

/* ---- DOM ---------------------------------------------------------------- */

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
  }
  if (children) {
    (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
  }
  return node;
}
const $ = function (sel, root) { return (root || document).querySelector(sel); };
const $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

/* ---- Icons (inline SVG; no emoji as UI furniture) ----------------------- */

const ICON_PATHS = {
  gauge: '<path d="M12 13.5 16 8"/><circle cx="12" cy="13.5" r="1.2" fill="currentColor" stroke="none"/><path d="M3.5 17a9 9 0 1 1 17 0"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 1.5M9.5 2.5h5"/>',
  code: '<path d="m8.5 8.5-5 3.5 5 3.5M15.5 8.5l5 3.5-5 3.5M13.5 5l-3 14"/>',
  brief: '<path d="M5 3.5h9l5 5v12H5z"/><path d="M14 3.5v5h5"/><path d="M8.5 13h7M8.5 16.5h7"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  cards: '<rect x="3" y="6" width="14" height="13" rx="2"/><path d="M7.5 3.5h11a2 2 0 0 1 2 2v11"/>',
  chart: '<path d="M4 20V4"/><path d="M4 20h16"/><rect x="8" y="11" width="3" height="6" rx=".6"/><rect x="14" y="7" width="3" height="10" rx=".6"/>',
  book: '<path d="M4 4.5h6a3 3 0 0 1 3 3V20a2.5 2.5 0 0 0-2.5-2.5H4Z"/><path d="M20 4.5h-6a3 3 0 0 0-3 3V20a2.5 2.5 0 0 1 2.5-2.5H20Z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  flag: '<path d="M5 21V4.5h9l-1.5 3.5L14 11.5H5"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  bulb: '<path d="M9.5 18h5M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9V15h7v-1.1A6 6 0 0 0 12 3Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',
  reset: '<path d="M4 12a8 8 0 1 1 2.6 5.9"/><path d="M4 20v-5h5"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  download: '<path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5M4.5 20.5h15"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
  bolt: '<path d="M13.5 2.5 5 13.5h6L10.5 21.5 19 10.5h-6Z"/>',
};

function icon(name, cls) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'ico ' + (cls || ''));
  svg.innerHTML = ICON_PATHS[name] || '';
  return svg;
}

/* ---- Storage ------------------------------------------------------------ */

const STORE_KEY = 'adobe-prep-2026';

function defaultState() {
  return {
    profile: '',
    theme: '',
    mcq: {},          // id -> {seen, correct, wrong, starred, lastPick, lastAt}
    code: {},         // id -> {solved, revealed:[], notes}
    cases: {},        // caseId -> {answers:{qIdx:text}, scored:{qIdx:[bool]}, done}
    flash: {},        // cardKey -> {box, due}
    mocks: [],        // finished mock runs
    read: {},         // cardId -> true
  };
}

let STATE = defaultState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      STATE = Object.assign(defaultState(), parsed);
      ['mcq', 'code', 'cases', 'flash', 'read'].forEach(function (k) {
        if (!STATE[k] || typeof STATE[k] !== 'object') STATE[k] = {};
      });
      if (!Array.isArray(STATE.mocks)) STATE.mocks = [];
    }
  } catch (e) { STATE = defaultState(); }
}

let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function () {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(STATE)); } catch (e) { /* quota */ }
  }, 180);
}

function mcqRec(id) {
  if (!STATE.mcq[id]) STATE.mcq[id] = { seen: 0, correct: 0, wrong: 0, starred: false, lastPick: null };
  return STATE.mcq[id];
}
function codeRec(id) {
  if (!STATE.code[id]) STATE.code[id] = { solved: false, revealed: [], notes: '' };
  return STATE.code[id];
}
function caseRec(id) {
  if (!STATE.cases[id]) STATE.cases[id] = { answers: {}, scored: {}, done: false };
  return STATE.cases[id];
}

/* ---- Markdown ----------------------------------------------------------- */

// Content authored upstream sometimes already carries HTML entities inside code
// fences (`i &lt; n`). Decode first, then escape once, so it renders as `i < n`
// instead of the literal text `&lt;`.
function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeForHtml(s) { return esc(decodeEntities(s)); }

function inlineMd(src) {
  let s = escapeForHtml(src);
  const codes = [];
  s = s.replace(/`([^`]+)`/g, function (_, c) {
    codes.push(c);
    return '\u001A' + (codes.length - 1) + '\u001A';
  });
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  s = s.replace(/\u001A(\d+)\u001A/g, function (_, i) { return '<code>' + codes[+i] + '</code>'; });
  return s;
}

function highlight(code, lang) {
  const src = decodeEntities(code);
  const out = [];
  const KW = {
    python: /\b(def|class|return|if|elif|else|for|while|in|not|and|or|import|from|as|with|try|except|finally|raise|lambda|yield|pass|break|continue|None|True|False|global|nonlocal|assert|del|is)\b/,
    java: /\b(public|private|protected|static|final|class|interface|extends|implements|return|if|else|for|while|do|switch|case|break|continue|new|this|super|void|try|catch|finally|throw|throws|import|package|null|true|false|abstract|synchronized|instanceof|enum|default)\b/,
    cpp: /\b(int|long|short|char|bool|double|float|void|auto|const|static|struct|class|public|private|protected|return|if|else|for|while|do|switch|case|break|continue|new|delete|using|namespace|template|typename|try|catch|throw|include|define|nullptr|true|false|sizeof|virtual|override|unsigned|constexpr)\b/,
  };
  const TYPES = /\b(vector|string|map|unordered_map|set|unordered_set|pair|queue|stack|priority_queue|deque|List|ArrayList|Map|HashMap|Set|HashSet|Deque|ArrayDeque|Queue|PriorityQueue|String|StringBuilder|Integer|Long|Character|Boolean|Arrays|Collections|Math|System|Optional|int|str|list|dict|tuple|float|bool)\b/;
  const kw = KW[lang] || KW.python;

  // Tokenise line by line so a stray quote can't swallow the file.
  src.split('\n').forEach(function (line, li) {
    if (li) out.push('\n');
    let rest = line, guard = 0;
    while (rest.length && guard++ < 4000) {
      let m;
      if ((m = rest.match(/^(\s+)/))) { out.push(esc(m[1])); rest = rest.slice(m[1].length); continue; }
      if ((m = rest.match(/^(#[^\n]*|\/\/[^\n]*)/))) { out.push('<span class="tk-com">' + esc(m[1]) + '</span>'); rest = rest.slice(m[1].length); continue; }
      if ((m = rest.match(/^(\/\*[\s\S]*?\*\/|\/\*[^\n]*)/))) { out.push('<span class="tk-com">' + esc(m[1]) + '</span>'); rest = rest.slice(m[1].length); continue; }
      if ((m = rest.match(/^("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/))) { out.push('<span class="tk-str">' + esc(m[1]) + '</span>'); rest = rest.slice(m[1].length); continue; }
      if ((m = rest.match(/^(\d[\w.]*)/))) { out.push('<span class="tk-num">' + esc(m[1]) + '</span>'); rest = rest.slice(m[1].length); continue; }
      if ((m = rest.match(/^([A-Za-z_$][\w$]*)/))) {
        const w = m[1];
        const after = rest.slice(w.length);
        let cls = '';
        if (kw.test(w)) cls = 'tk-kw';
        else if (TYPES.test(w)) cls = 'tk-typ';
        else if (/^\s*\(/.test(after)) cls = 'tk-fn';
        out.push(cls ? '<span class="' + cls + '">' + esc(w) + '</span>' : esc(w));
        rest = after; continue;
      }
      if ((m = rest.match(/^([+\-*/%=<>!&|^~?:]+)/))) { out.push('<span class="tk-op">' + esc(m[1]) + '</span>'); rest = rest.slice(m[1].length); continue; }
      out.push(esc(rest[0])); rest = rest.slice(1);
    }
  });
  return out.join('');
}

function codeBlock(code, lang, opts) {
  const o = opts || {};
  const wrap = el('div', { class: 'code-wrap' });
  const bar = el('div', { class: 'code-bar' });
  bar.appendChild(el('span', { class: 'lang', text: lang || 'text' }));
  bar.appendChild(el('span', { class: 'spacer' }));
  if (o.tabs) bar.appendChild(o.tabs);
  const copyBtn = el('button', {
    class: 'btn btn-sm btn-ghost', type: 'button', title: 'Copy code',
    onclick: function () {
      const text = decodeEntities(code);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toast('Copied'); },
          function () { fallbackCopy(text); });
      } else fallbackCopy(text);
    },
  });
  copyBtn.appendChild(icon('copy'));
  copyBtn.appendChild(document.createTextNode('Copy'));
  bar.appendChild(copyBtn);
  wrap.appendChild(bar);
  const pre = el('pre', { class: 'code' });
  pre.appendChild(el('code', { html: highlight(code, lang) }));
  wrap.appendChild(pre);
  return wrap;
}

function fallbackCopy(text) {
  const ta = el('textarea', { style: 'position:fixed;opacity:0' });
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); toast('Copied'); } catch (e) { toast('Copy failed'); }
  document.body.removeChild(ta);
}

// Block-level markdown -> DocumentFragment
function md(src) {
  const frag = document.createDocumentFragment();
  if (!src) return frag;
  const lines = String(src).replace(/\r\n/g, '\n').split('\n');
  let i = 0;

  function flushPara(buf) {
    if (!buf.length) return;
    frag.appendChild(el('p', { html: inlineMd(buf.join('\n')).replace(/\n/g, '<br>') }));
    buf.length = 0;
  }

  const para = [];
  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    const fence = line.match(/^\s*```+\s*([\w+-]*)\s*$/);
    if (fence) {
      flushPara(para);
      const lang = (fence[1] || 'text').toLowerCase();
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```+\s*$/.test(lines[i])) { body.push(lines[i]); i++; }
      i++;
      const norm = lang === 'py' ? 'python' : (lang === 'c++' || lang === 'cc' ? 'cpp' : lang);
      frag.appendChild(codeBlock(body.join('\n'), norm));
      continue;
    }

    if (/^\s*$/.test(line)) { flushPara(para); i++; continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara(para);
      const lvl = Math.min(h[1].length + 1, 6);
      frag.appendChild(el('h' + lvl, { html: inlineMd(h[2]) }));
      i++; continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[-*_\s]*$/.test(line)) { flushPara(para); frag.appendChild(el('hr')); i++; continue; }

    // table
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      flushPara(para);
      const cells = function (row) {
        return row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function (c) { return c.trim(); });
      };
      const head = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && /\|/.test(lines[i]) && !/^\s*$/.test(lines[i])) { body.push(cells(lines[i])); i++; }
      const scroll = el('div', { class: 'table-scroll' });
      const table = el('table');
      const thead = el('thead');
      const hr = el('tr');
      head.forEach(function (c) { hr.appendChild(el('th', { html: inlineMd(c) })); });
      thead.appendChild(hr); table.appendChild(thead);
      const tbody = el('tbody');
      body.forEach(function (r) {
        const tr = el('tr');
        for (let c = 0; c < head.length; c++) tr.appendChild(el('td', { html: inlineMd(r[c] || '') }));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      scroll.appendChild(table);
      frag.appendChild(scroll);
      continue;
    }

    // blockquote
    if (/^\s*>\s?/.test(line)) {
      flushPara(para);
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      const bq = el('blockquote');
      bq.appendChild(md(buf.join('\n')));
      frag.appendChild(bq);
      continue;
    }

    // lists (one nesting level)
    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      flushPara(para);
      const ordered = /\d/.test(li[2]);
      const list = el(ordered ? 'ol' : 'ul');
      let cur = null;
      while (i < lines.length) {
        const m2 = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (m2) {
          const indent = m2[1].length;
          if (indent >= 2 && cur) {
            const subLines = [];
            while (i < lines.length) {
              const m3 = lines[i].match(/^(\s{2,})([-*+]|\d+[.)])\s+(.*)$/);
              if (!m3) break;
              subLines.push(m3[2] + ' ' + m3[3]);
              i++;
            }
            cur.appendChild(md(subLines.join('\n')));
            continue;
          }
          cur = el('li', { html: inlineMd(m2[3]) });
          list.appendChild(cur);
          i++;
          continue;
        }
        if (/^\s{2,}\S/.test(lines[i]) && cur) {
          cur.innerHTML += ' ' + inlineMd(lines[i].trim());
          i++; continue;
        }
        break;
      }
      frag.appendChild(list);
      continue;
    }

    para.push(line);
    i++;
  }
  flushPara(para);
  return frag;
}

function mdBlock(src, cls) {
  const d = el('div', { class: 'md ' + (cls || '') });
  d.appendChild(md(src));
  return d;
}

/* ---- Misc --------------------------------------------------------------- */

function toast(msg) {
  let stack = $('.toast-stack');
  if (!stack) { stack = el('div', { class: 'toast-stack' }); document.body.appendChild(stack); }
  const t = el('div', { class: 'toast', text: msg });
  stack.appendChild(t);
  setTimeout(function () { t.remove(); }, 2100);
}

function fmtClock(ms) {
  if (ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
  return (h > 0 ? h + ':' + pad(m) : m) + ':' + pad(s);
}

function fmtCountdown(ms) {
  if (ms <= 0) return '00:00:00';
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
  return (d > 0 ? d + 'd ' : '') + pad(h) + ':' + pad(m) + ':' + pad(s);
}

function shuffle(arr, seed) {
  const a = arr.slice();
  let s = seed || 1;
  const rnd = function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

const TOPIC_META = {
  'arrays-strings':            { label: 'Arrays & Strings',      hue: 't1' },
  'sorting-searching-hashing': { label: 'Sorting, Search, Hash', hue: 't2' },
  'trees-graphs':              { label: 'Trees & Graphs',        hue: 't3' },
  'dp-greedy-recursion':       { label: 'DP, Greedy, Recursion', hue: 't4' },
  'output-prediction':         { label: 'Output Prediction',     hue: 't5' },
  'oop-languages':             { label: 'OOP & Languages',       hue: 't6' },
  'os-dbms-networks':          { label: 'OS, DBMS, Networks',    hue: 't7' },
  'aptitude-logical':          { label: 'Aptitude & Logic',      hue: 't8' },
  'ai-agents-brand':           { label: 'AI Agents & Brand',     hue: 't9' },
};
function topicLabel(k) { return (TOPIC_META[k] || {}).label || k; }
function topicHue(k) { return 'var(--' + ((TOPIC_META[k] || {}).hue || 't1') + ')'; }
