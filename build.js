/* Bundles src/ into dist/artifact.html (for Artifact publishing, no doc tags)
   and dist/index.html (standalone, for GitHub Pages / Vercel / local open). */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const DIST = path.join(__dirname, 'dist');
const CONTENT = path.join(SRC, 'content');

function readIf(file, fallback) {
  const p = path.join(CONTENT, file);
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const meta = readIf('meta.json', {});
const mcq = readIf('mcq.json', []);
const strategy = readIf('strategy.json', []);
const caseMethod = readIf('case-method.json', []);

const coding = []
  .concat(readIf('coding-salvaged.json', []))
  .concat(readIf('coding-authored-1.json', []))
  .concat(readIf('coding-authored-2.json', []));

let cases = readIf('cases.json', []);
let theme = readIf('theme.json', []);
let dev = readIf('dev.json', []);

const PENDING = {
  id: 'pending',
  section: 'Coming soon',
  title: 'This section is still being written',
  body: 'The material for this section has not been added yet. Everything else in this app — the '
      + mcq.length + '-question MCQ bank, the coding lab, the exam strategy playbook and the Round 2 '
      + 'method playbook — is complete and ready to use.\n\nCheck back for an updated build.',
  keyTerms: [],
  whyItMatters: 'Round 1 material is complete. This section is additional depth for later rounds.',
};

if (!theme.length) theme = [PENDING];
if (!dev.length) dev = [{ id: 'dev-pending', title: 'Still being written', body: PENDING.body }];

const DATA = {
  meta: meta,
  mcq: mcq,
  coding: coding,
  cases: cases,
  caseMethod: caseMethod,
  theme: theme,
  strategy: strategy,
  dev: dev,
};

// All top-level stylesheets, alphabetically: styles.css then z-exam.css.
const css = fs.readdirSync(SRC)
  .filter(f => f.endsWith('.css')).sort()
  .map(f => fs.readFileSync(path.join(SRC, f), 'utf8'))
  .join('\n\n');
const jsFiles = fs.readdirSync(path.join(SRC, 'js')).filter(f => f.endsWith('.js')).sort();
const js = jsFiles.map(f => fs.readFileSync(path.join(SRC, 'js', f), 'utf8')).join('\n\n');

const TITLE = 'Adobe University Hackathon 2026 — Prep Console';

// JSON is embedded as a string literal and parsed at runtime: far smaller and
// immune to </script> injection from content, which a raw object literal is not.
const payload = JSON.stringify(JSON.stringify(DATA))
  .replace(/<\//g, '<\\/')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');

const body =
  '<style>\n' + css + '\n</style>\n' +
  '<script>window.PREP_DATA = JSON.parse(' + payload + ');</script>\n' +
  '<script>\n' + js + '\n</script>\n';

fs.mkdirSync(DIST, { recursive: true });

fs.writeFileSync(path.join(DIST, 'artifact.html'), '<title>' + TITLE + '</title>\n' + body);

fs.writeFileSync(path.join(DIST, 'index.html'),
  '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
  '<title>' + TITLE + '</title>\n</head>\n<body>\n' + body + '</body>\n</html>\n');

const kb = n => (n / 1024).toFixed(0) + ' KB';
console.log('MCQs:      ', mcq.length);
console.log('Coding:    ', coding.length);
console.log('Cases:     ', cases.length, '| method sections:', caseMethod.length);
console.log('Strategy:  ', strategy.length, 'sections');
console.log('artifact:  ', kb(fs.statSync(path.join(DIST, 'artifact.html')).size));
console.log('index:     ', kb(fs.statSync(path.join(DIST, 'index.html')).size));
