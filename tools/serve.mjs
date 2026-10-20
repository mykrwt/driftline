#!/usr/bin/env node
/**
 * Zero-dependency static file server for Driftline.
 *
 * The game itself has no backend: this only serves the static files so a
 * browser can load them (ES modules require an http(s) origin).
 *
 *   node tools/serve.mjs [--port 8080] [--host 0.0.0.0]
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, mkdir, writeFile, readFile } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
// A build id derived from the newest source file. Every module URL carries it,
// so a reload always picks up fresh code even in WebViews that cache hard.
let buildCache = { id: '0', at: 0 };
function getBuildId() {
  const now = Date.now();
  if (now - buildCache.at < 1000) return buildCache.id;
  let newest = 0;
  const walk = (dir) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        try {
          newest = Math.max(newest, statSync(full).mtimeMs);
        } catch {
          /* ignore */
        }
      }
    }
  };
  walk(join(ROOT, 'src'));
  walk(join(ROOT, 'styles'));
  try {
    newest = Math.max(newest, statSync(join(ROOT, 'vendor')).mtimeMs);
  } catch {
    /* ignore */
  }
  buildCache = { id: newest.toString(36), at: now };
  return buildCache.id;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function parseArgs(argv) {
  const out = { port: Number(process.env.PORT || 8080), host: process.env.HOST || '0.0.0.0' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') out.port = Number(argv[++i]);
    else if (argv[i] === '--host') out.host = argv[++i];
  }
  return out;
}

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const target = normalize(join(root, decoded));
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

async function resolveFile(path) {
  try {
    const info = await stat(path);
    if (info.isDirectory()) {
      const index = join(path, 'index.html');
      const idx = await stat(index);
      return idx.isFile() ? index : null;
    }
    return info.isFile() ? path : null;
  } catch {
    return null;
  }
}

const { port, host } = parseArgs(process.argv.slice(2));

/**
 * Rewrite relative imports of a module so every load is cache busted.
 * @param {string} source
 * @returns {string}
 */
function bustImports(source) {
  const build = getBuildId();
  return source
    .replace(/(\bfrom\s*['"])(\.{1,2}\/[^'"]+?\.js)(['"])/g, `$1$2?v=${build}$3`)
    .replace(/(\bimport\s*\(\s*['"])(\.{1,2}\/[^'"]+?\.js)(['"])/g, `$1$2?v=${build}$3`)
    .replace(/(\bimport\s+['"])(\.{1,2}\/[^'"]+?\.js)(['"])/g, `$1$2?v=${build}$3`);
}

const server = createServer(async (req, res) => {
  const urlPath = (req.url || '/').split('?')[0];

  // Development helper: receive a canvas snapshot from the page and store it.
  if (req.method === 'POST' && urlPath === '/__shot') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    const name = (new URL(req.url, 'http://x').searchParams.get('name') || 'frame').replace(/[^\w.-]/g, '');
    const dir = join(ROOT, '.harness', 'shots');
    await mkdir(dir, { recursive: true });
    const dataUrl = body.replace(/^data:image\/\w+;base64,/, '');
    await writeFile(join(dir, `${name}.png`), Buffer.from(dataUrl, 'base64'));
    res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }).write('ok');
    return;
  }

  let filePath = safeJoin(ROOT, urlPath === '/' ? '/index.html' : urlPath);
  if (!filePath) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  let target = await resolveFile(filePath);
  if (!target) {
    // SPA-ish fallback for unknown paths without an extension.
    if (!extname(urlPath)) target = await resolveFile(join(ROOT, 'index.html'));
  }
  if (!target) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }
  const type = MIME[extname(target).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'content-type': type,
    'cache-control': 'no-store, no-cache, must-revalidate',
    // Service workers and WebRTC are happier with a secure context; localhost counts.
    'x-content-type-options': 'nosniff',
    // Allows the harness to import modules for debugging.
    'access-control-allow-origin': '*',
  });
  if (type.startsWith('text/html')) {
    const source = await readFile(target, 'utf8');
    res.end(source.replace(/(\?v=)[0-9a-z]+/g, `$1${getBuildId()}`));
    return;
  }
  if (type.startsWith('text/javascript')) {
    const source = await readFile(target, 'utf8');
    res.end(bustImports(source));
    return;
  }
  createReadStream(target).pipe(res);
});

server.listen(port, host, () => {
  const addrs = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) addrs.push(net.address);
    }
  }
  console.log(`Driftline dev server -> http://localhost:${port}`);
  for (const a of addrs) console.log(`  LAN (open on your phone) -> http://${a}:${port}`);
});
