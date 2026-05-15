#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile, mkdir, readdir } from 'node:fs/promises';
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
const PATHS = ['/', '/recommended-reads/', '/privacy/'];
const URLS = PATHS.map((p) => `${BASE_URL}${p}`);

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'].join(',');
const FAIL_IMPACTS = new Set(['serious', 'critical']);
const BOOT_TIMEOUT_MS = 30_000;

async function waitForPreview() {
  const start = Date.now();
  while (Date.now() - start < BOOT_TIMEOUT_MS) {
    try {
      const res = await fetch(BASE_URL, { method: 'GET' });
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

function runAxe() {
  return new Promise((resolveRun, rejectRun) => {
    console.log('\nRunning axe-core against:');
    URLS.forEach((u) => console.log(`  - ${u}`));
    const args = [
      '@axe-core/cli',
      ...URLS,
      '--tags', TAGS,
      '--save', 'report.json',
      '--dir', REPORT_DIR,
    ];
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
  return totalSeriousCritical;
}

async function main() {
  if (!existsSync(REPORT_DIR)) {
    await mkdir(REPORT_DIR, { recursive: true });
  }
  const preview = startPreview();
  let exitCode = 1;
  try {
    await waitForPreview();
    await runAxe();
    const reports = await readReports();
    const blocking = summarize(reports);
    console.log(`\n== Summary ==`);
    console.log(`serious + critical violations across all pages: ${blocking}`);
    exitCode = blocking === 0 ? 0 : 1;
  } finally {
    preview.kill('SIGTERM');
    // Best-effort: give it 500ms, then force.
    await sleep(500);
    if (!preview.killed) preview.kill('SIGKILL');
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
