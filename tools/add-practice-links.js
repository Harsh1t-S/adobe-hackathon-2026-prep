// Attaches the closest real LeetCode problem(s) to each authored problem, so
// you can actually run, test and submit code against a judge.
// Our statements are re-themed, but the algorithm is the same one.
const fs = require('fs');
const path = require('path');

const LC = (n, slug, title) => ({
  name: 'LeetCode ' + n + ' · ' + title,
  url: 'https://leetcode.com/problems/' + slug + '/',
});

const MAP = {
  'ca-01': { links: [LC(167, 'two-sum-ii-input-array-is-sorted', 'Two Sum II — Input Array Is Sorted')],
             note: 'Same two-pointer pair-sum scan on a sorted array.' },
  'ca-02': { links: [LC(443, 'string-compression', 'String Compression')],
             note: 'Same run-length encoding, done in place on the judge version.' },
  'ca-03': { links: [LC(3, 'longest-substring-without-repeating-characters', 'Longest Substring Without Repeating Characters')],
             note: 'Identical sliding window with a last-seen map.' },
  'ca-04': { links: [LC(560, 'subarray-sum-equals-k', 'Subarray Sum Equals K')],
             note: 'Same prefix-sum + hash-map counting.' },
  'ca-05': { links: [LC(56, 'merge-intervals', 'Merge Intervals')],
             note: 'Same sort-then-sweep merge.' },
  'ca-06': { links: [LC(1186, 'maximum-subarray-sum-with-one-deletion', 'Maximum Subarray Sum with One Deletion')],
             note: 'Same two-state Kadane — best ending here with and without a skip.' },

  'cb-01': { links: [LC(921, 'minimum-add-to-make-parentheses-valid', 'Minimum Add to Make Parentheses Valid')],
             note: 'Identical counter-instead-of-stack problem.' },
  'cb-02': { links: [LC(347, 'top-k-frequent-elements', 'Top K Frequent Elements'),
                     LC(692, 'top-k-frequent-words', 'Top K Frequent Words')],
             note: '347 for the heap selection; 692 adds the lexicographic tie-break ours uses.' },
  'cb-03': { links: [LC(56, 'merge-intervals', 'Merge Intervals')],
             note: 'The canonical version. Same as ca-05 — worth doing once and recognising forever.' },
  'cb-04': { links: [LC(739, 'daily-temperatures', 'Daily Temperatures')],
             note: 'Identical monotonic stack of unresolved indices.' },

  'cc-01': { links: [LC(200, 'number-of-islands', 'Number of Islands')],
             note: 'Identical grid flood fill. Use the iterative BFS — recursion stack-overflows on the big grids.' },
  'cc-02': { links: [LC(210, 'course-schedule-ii', 'Course Schedule II')],
             note: 'Identical Kahn topological sort, including the empty-array-on-cycle rule.' },
  'cc-03': { links: [LC(199, 'binary-tree-right-side-view', 'Binary Tree Right Side View')],
             note: 'The exact problem, with the tree pre-built for you.' },

  'cd-01': { links: [LC(198, 'house-robber', 'House Robber')],
             note: 'Same non-adjacent DP collapsed to two rolling variables.' },
  'cd-02': { links: [LC(322, 'coin-change', 'Coin Change')],
             note: 'Identical unbounded knapsack, including the -1 unreachable case.' },
  'cd-03': { links: [LC(1143, 'longest-common-subsequence', 'Longest Common Subsequence')],
             note: 'The exact problem.' },

  'ce-01': { links: [LC(48, 'rotate-image', 'Rotate Image')],
             note: 'Identical in-place transpose-then-reverse.' },
  'ce-02': { links: [LC(136, 'single-number', 'Single Number')],
             note: 'The exact XOR problem.' },
  'ce-03': { links: [LC(692, 'top-k-frequent-words', 'Top K Frequent Words')],
             note: 'Closest judge equivalent — same count, rank and tie-break shape. Ours adds the 1/position weighting, which no LeetCode problem covers.' },
};

const DIR = path.join(__dirname, '..', 'src', 'content');
let touched = 0, missing = [];

['coding-salvaged.json', 'coding-authored-1.json', 'coding-authored-2.json'].forEach(function (file) {
  const p = path.join(DIR, file);
  const problems = JSON.parse(fs.readFileSync(p, 'utf8'));
  problems.forEach(function (prob) {
    const m = MAP[prob.id];
    if (!m) { missing.push(prob.id); return; }
    prob.practice = { note: m.note, links: m.links };
    touched++;
  });
  fs.writeFileSync(p, JSON.stringify(problems, null, 1));
});

console.log('practice links attached:', touched);
if (missing.length) console.log('NO MAPPING for:', missing.join(', '));
