// Pulls the generated content out of the workflow artefacts and writes
// src/content/mcq.json + src/content/coding-set-1.json.
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'src', 'content');
fs.mkdirSync(OUT, { recursive: true });

// ---- MCQ bank -------------------------------------------------------------
const mcqTaskFile = process.argv[2];
const raw = JSON.parse(fs.readFileSync(mcqTaskFile, 'utf8'));

// The workflow's return value lives under `result` (string or object).
function findBanks(node, depth = 0) {
  if (!node || depth > 6) return null;
  if (typeof node === 'string') {
    const t = node.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      try { return findBanks(JSON.parse(t), depth + 1); } catch (e) { return null; }
    }
    return null;
  }
  if (Array.isArray(node)) {
    for (const el of node) { const r = findBanks(el, depth + 1); if (r) return r; }
    return null;
  }
  if (typeof node === 'object') {
    if (Array.isArray(node.banks)) return node.banks;
    for (const k of Object.keys(node)) {
      const r = findBanks(node[k], depth + 1);
      if (r) return r;
    }
  }
  return null;
}

const banks = findBanks(raw);
if (!banks) { console.error('could not locate banks[] in', mcqTaskFile); process.exit(1); }

const seen = new Set();
const questions = [];
for (const b of banks) {
  for (const q of (b.questions || [])) {
    if (!q || !q.id || seen.has(q.id)) continue;
    if (!Array.isArray(q.options) || q.options.length !== 4) continue;
    if (typeof q.answerIndex !== 'number' || q.answerIndex < 0 || q.answerIndex > 3) continue;
    seen.add(q.id);
    questions.push({
      id: q.id,
      topic: q.topic || b.topic,
      subtopic: q.subtopic || '',
      difficulty: q.difficulty || 'medium',
      question: q.question,
      options: q.options,
      answerIndex: q.answerIndex,
      explanation: q.explanation || '',
      whyOthersWrong: q.whyOthersWrong || [],
      takeaway: q.takeaway || '',
      tags: q.tags || [],
      verified: q.verified || 'unverified',
    });
  }
}
fs.writeFileSync(path.join(OUT, 'mcq.json'), JSON.stringify(questions, null, 1));

const byTopic = {};
questions.forEach(q => { byTopic[q.topic] = (byTopic[q.topic] || 0) + 1; });
const unverified = questions.filter(q => q.verified === 'unverified').length;
console.log('MCQ total:', questions.length, '| unverified:', unverified);
console.log(byTopic);

// ---- Coding set salvaged from the stopped workflow ------------------------
const journal = process.argv[3];
if (journal && fs.existsSync(journal)) {
  const lines = fs.readFileSync(journal, 'utf8').split('\n').filter(Boolean);
  const sets = [];
  for (const line of lines) {
    let rec; try { rec = JSON.parse(line); } catch (e) { continue; }
    if (rec.type !== 'result') continue;
    let val = rec.result !== undefined ? rec.result : rec.value;
    if (typeof val === 'string') { try { val = JSON.parse(val); } catch (e) { /* leave */ } }
    if (val && Array.isArray(val.problems)) sets.push(val.problems);
  }
  const problems = [].concat(...sets);
  if (problems.length) {
    fs.writeFileSync(path.join(OUT, 'coding-salvaged.json'), JSON.stringify(problems, null, 1));
    console.log('Salvaged coding problems:', problems.length, problems.map(p => p.id).join(', '));
  } else {
    console.log('No coding problems found in journal.');
  }
}
