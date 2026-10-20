#!/usr/bin/env node
/**
 * Portable test runner.
 *
 * Uses the node:test programmatic runner (single process, no child workers),
 * which keeps it working on devices where spawning processes is restricted.
 */
import { run } from 'node:test';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = join(root, 'tests');

const filter = process.argv[2] ?? '';
const files = readdirSync(testsDir)
  .filter((name) => name.endsWith('.test.js'))
  .filter((name) => !filter || name.includes(filter))
  .sort()
  .map((name) => join(testsDir, name));

if (files.length === 0) {
  console.error('No test files found.');
  process.exit(1);
}

let passed = 0;
let failed = 0;
const failures = [];
let currentFile = '';

const stream = run({ files, isolation: 'none', concurrency: 1 });

stream.on('test:pass', (event) => {
  passed++;
  if (event.file && event.file !== currentFile) {
    currentFile = event.file;
    console.log(`\n✔ ${event.file.replace(`${root}/`, '')}`);
  }
});

stream.on('test:fail', (event) => {
  failed++;
  const name = event.test?.name || event.name || 'unknown test';
  failures.push({ file: event.file, name, error: event.test?.error || event.error });
  console.log(`\n✖ ${event.file?.replace(`${root}/`, '') || ''} › ${name}`);
  const message = (event.test?.error || event.error)?.message;
  if (message) console.log(`   ${String(message).split('\n').slice(0, 6).join('\n   ')}`);
});

stream.on('summary', () => {
  console.log(`\n${'-'.repeat(52)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const failure of failures) {
      console.log(` - ${failure.file?.replace(`${root}/`, '') || ''} › ${failure.name}`);
    }
  }
  process.exitCode = failed === 0 ? 0 : 1;
});
