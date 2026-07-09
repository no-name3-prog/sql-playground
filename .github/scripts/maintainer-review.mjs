#!/usr/bin/env node
/**
 * Experienced-maintainer style automated PR review.
 * Exit 0 = safe to merge (with notes). Exit 1 = block merge.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

function section(title, lines) {
  return [`### ${title}`, ...lines, ''].join('\n');
}

const base = process.env.BASE_SHA || 'origin/main';
const head = process.env.HEAD_SHA || 'HEAD';

let diffFiles = '';
try {
  diffFiles = sh(`git diff --name-only ${base}...${head}`);
} catch {
  diffFiles = sh('git diff --name-only origin/main...HEAD');
}
const files = diffFiles.split('\n').filter(Boolean);

const findings = [];
const blockers = [];
const nits = [];

// --- Secret / sensitive paths ---
const secretPatterns = [
  /^\.env$/,
  /\.env\.local$/,
  /id_rsa/,
  /\.pem$/,
  /credentials\.json$/i,
];
for (const f of files) {
  if (secretPatterns.some((p) => p.test(f) || p.test(f.split('/').pop()))) {
    blockers.push(`Possible secret or local env file committed: \`${f}\``);
  }
}

// --- Diff content scan for secrets ---
let diff = '';
try {
  diff = sh(`git diff ${base}...${head}`);
} catch {
  diff = '';
}
const secretContent = [
  /api[_-]?key\s*[:=]\s*['"][^'"]{8,}/i,
  /secret\s*[:=]\s*['"][^'"]{8,}/i,
  /password\s*[:=]\s*['"][^'"]{4,}/i,
  /-----BEGIN (RSA |OPENSSH )?PRIVATE KEY-----/,
  /ghp_[A-Za-z0-9]{20,}/,
  /gho_[A-Za-z0-9]{20,}/,
];
for (const re of secretContent) {
  if (re.test(diff)) {
    blockers.push(`Diff matches sensitive pattern \`${re}\` — remove secrets before merge.`);
  }
}

const touchesBackend = files.some((f) => f.startsWith('backend/src/'));
const touchesFrontend = files.some((f) => f.startsWith('frontend/src/'));
const touchesTests = files.some((f) => f.includes('/tests/') || f.endsWith('.test.ts') || f.endsWith('.test.tsx'));
const touchesDrivers = files.some((f) => f.includes('backend/src/drivers/'));
const touchesAnalysis = files.some((f) => f.includes('backend/src/analysis/') || f.includes('backend/src/optimization/'));
const touchesSchema = files.some((f) => f.includes('backend/src/schema') || f.includes('drivers/'));
const touchesCi = files.some((f) => f.startsWith('.github/'));
const touchesDocsOnly = files.every(
  (f) =>
    f.endsWith('.md') ||
    f.startsWith('.github/ISSUE_TEMPLATE') ||
    f === 'LICENSE' ||
    f.endsWith('.yml') && f.includes('dependabot')
);

// --- Tests for non-trivial backend changes ---
if ((touchesDrivers || touchesAnalysis || touchesSchema) && !touchesTests && !touchesDocsOnly) {
  blockers.push(
    'Backend driver / analysis / schema changes without accompanying tests under `backend/tests/`. Add coverage before merge.'
  );
} else if (touchesBackend && !touchesTests && !touchesCi && !touchesDocsOnly && files.length > 3) {
  nits.push('Backend source changed without new/updated tests — consider adding regression coverage.');
}

// --- Huge PRs ---
if (files.length > 80) {
  nits.push(`Large PR (${files.length} files). Prefer smaller, reviewable changes when possible.`);
}

// --- Lockfiles alone without package.json ---
const lockOnly =
  files.some((f) => f.endsWith('package-lock.json')) &&
  !files.some((f) => f.endsWith('package.json'));
if (lockOnly) {
  nits.push('Lockfile changed without `package.json` — confirm intentional dependency refresh.');
}

// --- package.json without lockfile ---
const pkgNoLock =
  files.some((f) => /\/package\.json$|^package\.json$/.test(f)) &&
  !files.some((f) => f.endsWith('package-lock.json'));
if (pkgNoLock) {
  nits.push('`package.json` changed without lockfile update — run `npm install` and commit the lockfile if deps changed.');
}

// --- Dangerous commands in workflows ---
if (files.some((f) => f.startsWith('.github/workflows/'))) {
  if (/curl .+ \| (ba)?sh/i.test(diff)) {
    blockers.push('Workflow pipes remote script to shell — avoid for supply-chain safety.');
  }
  findings.push('CI/workflow files modified — double-check permissions and secrets usage.');
}

// --- Summary stats ---
const stats = {
  files: files.length,
  backend: touchesBackend,
  frontend: touchesFrontend,
  tests: touchesTests,
  docsOnly: touchesDocsOnly,
};

const approved = blockers.length === 0;
const verdict = approved ? 'APPROVE' : 'REQUEST_CHANGES';

const body = [
  '## 🏛️ Maintainer review (automated)',
  '',
  'Acting as a **senior maintainer**: correctness, tests, security, and merge readiness.',
  '',
  section('Verdict', [
    approved
      ? '**✅ Approve** — no merge blockers from static review. CI must still be green.'
      : '**❌ Request changes** — resolve blockers before merge.',
  ]),
  section('Change map', [
    `- Files changed: **${stats.files}**`,
    `- Backend: ${stats.backend ? 'yes' : 'no'} · Frontend: ${stats.frontend ? 'yes' : 'no'} · Tests: ${stats.tests ? 'yes' : 'no'}`,
    stats.docsOnly ? '- Classified as docs/config-only' : '- Includes application or infrastructure code',
    '',
    '<details><summary>Files</summary>',
    '',
    files.map((f) => `- \`${f}\``).join('\n') || '- _(none)_',
    '',
    '</details>',
  ]),
  blockers.length
    ? section('Blockers', blockers.map((b) => `- ❌ ${b}`))
    : section('Blockers', ['- None']),
  nits.length
    ? section('Nits / suggestions', nits.map((n) => `- ⚠️ ${n}`))
    : section('Nits / suggestions', ['- None']),
  findings.length
    ? section('Notes', findings.map((f) => `- ℹ️ ${f}`))
    : '',
  section('Maintainer checklist', [
    `- [${approved ? 'x' : ' '}] No secrets in diff`,
    `- [${touchesTests || touchesDocsOnly || touchesCi || !touchesBackend ? 'x' : ' '}] Tests updated when behavior changes`,
    '- [x] CI workflow required on merge (branch protection)',
    '- [x] PR description expected to explain *why*',
  ]),
  '---',
  '_Automated senior-maintainer bot · merges only when this review is clean **and** `All checks passed` is green._',
  '<!-- maintainer-bot-review -->',
].join('\n');

const outPath = process.env.GITHUB_STEP_SUMMARY
  ? null
  : '/tmp/maintainer-review.md';

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, body + '\n');
}
fs.writeFileSync('/tmp/maintainer-review.md', body);
fs.writeFileSync(
  '/tmp/maintainer-verdict.json',
  JSON.stringify({ verdict, approved, blockers, nits, files }, null, 2)
);

console.log(body);
console.log(`\nVERDICT=${verdict}`);
process.exit(approved ? 0 : 1);
