#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const REPORT_DIR = join(REPO_ROOT, 'axe-reports');

const PREVIEW_HOST = '127.0.0.1';
const PREVIEW_PORT = 4321;
const BASE_URL = `http://${PREVIEW_HOST}:${PREVIEW_PORT}`;
const URLS_FULL = ['/', '/recommended-reads/'].map((p) => `${BASE_URL}${p}`);
const URLS_PRIVACY = ['/privacy/'].map((p) => `${BASE_URL}${p}`);

// /privacy/ uses Termly-injected privacy-policy markup with inline colors that
// fail AA on the site's dark theme. The color-contrast rule is disabled for
// that page only; rewriting the Termly markup is out of scope for Slice 4.
// See docs/superpowers/specs/2026-05-15-slice-4-accessibility-design.md.
const PRIVACY_DISABLED_RULES = ['color-contrast'];

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'].join(',');
const FAIL_IMPACTS = new Set(['serious', 'critical']);
const BOOT_TIMEOUT_MS = 30_000;

async function waitForPreview(preview) {
  const start = Date.now();
  let earlyExitCode = null;
  preview.once('exit', (code) => {
    earlyExitCode = code ?? -1;
  });
  while (Date.now() - start < BOOT_TIMEOUT_MS) {
    if (earlyExitCode !== null) {
      throw new Error(
        `Preview server exited early with code ${earlyExitCode} ` +
          `before becoming reachable. Port ${PREVIEW_PORT} may be in use, ` +
          `or the build is missing. Try: lsof -ti:${PREVIEW_PORT} | xargs kill -9`,
      );
    }
    try {
      const res = await fetch(BASE_URL, { method: 'GET', signal: AbortSignal.timeout(1000) });
      if (res.ok || res.status === 404) return; // any HTTP response means the server is up
    } catch {}
    await sleep(250);
  }
  throw new Error(`Preview server did not respond within ${BOOT_TIMEOUT_MS}ms`);
}

function startPreview() {
  console.log(`Starting preview at ${BASE_URL} ...`);
  const proc = spawn('npx', ['astro', 'preview', '--host', PREVIEW_HOST, '--port', String(PREVIEW_PORT)], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  // Pipe stdout so the engineer sees the "Local: http://..." banner without surprises.
  proc.stdout.on('data', (chunk) => process.stdout.write(chunk));
  return proc;
}

function runAxe(urls, saveName, disabledRules = []) {
  return new Promise((resolveRun, rejectRun) => {
    console.log(`\nRunning axe-core (save: ${saveName}) against:`);
    urls.forEach((u) => console.log(`  - ${u}`));
    if (disabledRules.length > 0) {
      console.log(`  disabled rules: ${disabledRules.join(', ')}`);
    }
    const args = [
      '@axe-core/cli',
      ...urls,
      '--tags', TAGS,
      '--save', saveName,
      '--dir', REPORT_DIR,
    ];
    if (disabledRules.length > 0) {
      args.push('--disable', disabledRules.join(','));
    }
    const proc = spawn('npx', args, { cwd: REPO_ROOT, stdio: 'inherit' });
    proc.on('exit', (code) => resolveRun(code ?? 0));
    proc.on('error', rejectRun);
  });
}

async function readReports() {
  // @axe-core/cli writes one JSON file per URL, named like `localhost_4321_recommended-reads_.json`
  // into the `--dir` directory. We aggregate them.
  const files = (await readdir(REPORT_DIR)).filter((f) => f.endsWith('.json'));
  const reports = [];
  for (const file of files) {
    const raw = await readFile(join(REPORT_DIR, file), 'utf8');
    const parsed = JSON.parse(raw);
    // Each file is an array with one entry. Normalize.
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    for (const entry of arr) reports.push({ file, ...entry });
  }
  return reports;
}

function summarize(reports) {
  let totalSeriousCritical = 0;
  for (const report of reports) {
    const url = report.url ?? report.testEngine?.url ?? report.file;
    const violations = report.violations ?? [];
    const blocking = violations.filter((v) => FAIL_IMPACTS.has(v.impact));
    const other = violations.filter((v) => !FAIL_IMPACTS.has(v.impact));
    totalSeriousCritical += blocking.length;
    console.log(`\n${url}`);
    if (blocking.length === 0) {
      console.log('  serious+critical: 0');
    } else {
      console.log(`  serious+critical: ${blocking.length}`);
      for (const v of blocking) {
        console.log(`    [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'})`);
      }
    }
    if (other.length > 0) {
      console.log(`  moderate/minor: ${other.length} (informational)`);
      for (const v of other) {
        console.log(`    [${v.impact}] ${v.id} — ${v.help}`);
      }
    }
  }
  // Detect missing URLs — axe-core may have failed to load one.
  const seenUrls = new Set(reports.map((r) => r.url).filter(Boolean));
  const expected = [...URLS_FULL, ...URLS_PRIVACY];
  for (const url of expected) {
    if (!seenUrls.has(url)) {
      console.log(`\n${url}`);
      console.log('  WARNING: no report found — axe-core may have failed to scan this URL.');
      totalSeriousCritical += 1;
    }
  }
  return totalSeriousCritical;
}

async function main() {
  if (!existsSync(REPORT_DIR)) {
    await mkdir(REPORT_DIR, { recursive: true });
  } else {
    // Clear stale reports so the summary only reflects this run.
    const stale = (await readdir(REPORT_DIR)).filter((f) => f.endsWith('.json'));
    for (const f of stale) await unlink(join(REPORT_DIR, f));
  }
  const preview = startPreview();
  let exitCode = 1;
  try {
    await waitForPreview(preview);
    const fullCode = await runAxe(URLS_FULL, 'report-full.json');
    const privacyCode = await runAxe(URLS_PRIVACY, 'report-privacy.json', PRIVACY_DISABLED_RULES);
    if (fullCode !== 0 || privacyCode !== 0) {
      // axe-core returns non-zero both for violations (expected) and for URL load failures.
      // If a report file is missing, we'll surface that in the summary; otherwise this is informational.
      console.log(`\nNote: axe-core exited non-zero (full=${fullCode}, privacy=${privacyCode}). Verify report files below.`);
    }
    const reports = await readReports();
    const blocking = summarize(reports);
    console.log(`\n== Summary ==`);
    console.log(`serious + critical violations across all pages: ${blocking}`);
    exitCode = blocking === 0 ? 0 : 1;
  } finally {
    const exited = new Promise((r) => preview.once('exit', r));
    preview.kill('SIGTERM');
    const TIMEOUT_MARKER = Symbol('timeout');
    const winner = await Promise.race([
      exited,
      sleep(500).then(() => TIMEOUT_MARKER),
    ]);
    if (winner === TIMEOUT_MARKER) {
      preview.kill('SIGKILL');
      await exited; // wait for actual reap so the port is released
    }
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
