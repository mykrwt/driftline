#!/usr/bin/env node
/**
 * Import check.
 *
 * Reads every import of the game and verifies that the target module really
 * exports it. A missing export or a typo in an import path is the kind of
 * mistake that only shows up in the browser, and this catches it in a second.
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const srcDir = join(root, 'src');

/**
 * @param {string} dir
 * @returns {string[]}
 */
function collect(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...collect(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

const IMPORT_RE = /import\s+(?:([\s\S]*?)\s+from\s+)?['"]([^'"]+)['"]/g;

/**
 * The names a module asks for.
 * @param {string} clause
 * @returns {string[]}
 */
function requestedNames(clause) {
  if (!clause) return [];
  const names = [];
  const braces = clause.match(/\{([\s\S]*)\}/);
  if (braces) {
    for (const part of braces[1].split(',')) {
      const name = part.split(/\s+as\s+/)[0].trim();
      if (name) names.push(name);
    }
  }
  const defaultImport = clause.replace(/\{[\s\S]*\}/, '').replace(/,/g, '').trim();
  if (defaultImport && !defaultImport.startsWith('*')) names.push('default');
  return names;
}

const files = collect(srcDir).sort();
const exportsOf = new Map();
let failed = 0;

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const statements = [...source.matchAll(IMPORT_RE)];
  for (const statement of statements) {
    const [, clause, specifier] = statement;
    if (!specifier.startsWith('.')) continue;
    const target = resolve(dirname(file), specifier);
    const key = target;
    if (!exportsOf.has(key)) {
      try {
        const module = await import(pathToFileURL(target).href);
        exportsOf.set(key, new Set(Object.keys(module)));
      } catch (err) {
        exportsOf.set(key, null);
        failed++;
        console.log(`FAIL ${relative(root, file)} -> ${specifier}\n     ${String(err.message).split('\n')[0]}`);
        continue;
      }
    }
    const available = exportsOf.get(key);
    if (!available) continue;
    for (const name of requestedNames(clause)) {
      if (!available.has(name)) {
        failed++;
        console.log(
          `FAIL ${relative(root, file)} -> ${specifier}\n     '${name}' is not exported by that module`,
        );
      }
    }
  }
}

console.log(`\n${files.length} modules checked, ${failed} problem${failed === 1 ? '' : 's'}`);
process.exitCode = failed === 0 ? 0 : 1;
