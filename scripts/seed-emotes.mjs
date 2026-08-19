#!/usr/bin/env node
// Uploads the bundled mascot illustrations (assets/mew/) to a running OMEW
// instance as a single "Mew" emote pack, so a fresh deployment isn't left
// with an empty picker.
//
// Usage:
//   node scripts/seed-emotes.mjs --url https://your-instance.example --token <admin-token>
//   node scripts/seed-emotes.mjs --url http://127.0.0.1:8787 --token <admin-token> --dry-run
//
// --url    instance origin (no trailing slash needed)
// --token  a session token for an instance admin (POST /api/admin/emote-packs
//          and .../emotes both require admin)
// --dry-run  parse args and enumerate the source files without making any
//            network call - useful to sanity-check the file list
//
// Idempotent: if the "Mew" pack already exists, reuses it and only uploads
// emote names it doesn't already have (checked against GET /api/emotes).
//
// Node >= 20, zero runtime dependencies (built-in fetch + fs/promises).

import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, '..', 'assets', 'mew');
const PACK_NAME = 'Mew';

// filename (without extension) -> emote name; webp preferred over png.
const EMOTE_FILES = [
  'az',
  'comfort',
  'kusa',
  'lance',
  'm-alice',
  'm-angry',
  'm-sad',
  'm-success',
  'm-warning',
  'niubi',
  'okashii',
  'question',
  'salute',
  'tear',
  'uhhuh',
  'w-alice',
  'w-do-not',
  'w-ellipsis',
  'w-error',
  'w-let-me-see',
  'helpful',
  'like',
];

const MIME_BY_EXT = { '.webp': 'image/webp', '.png': 'image/png' };

function parseArgs(argv) {
  const args = { url: null, token: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--url') args.url = argv[++i] ?? null;
    else if (arg === '--token') args.token = argv[++i] ?? null;
    else if (arg === '--dry-run') args.dryRun = true;
    else throw new Error(`unrecognized argument: ${arg}`);
  }
  return args;
}

// webp first, fall back to png; throws if neither exists.
async function resolveEmoteFile(name) {
  for (const ext of ['.webp', '.png']) {
    const filePath = path.join(ASSETS_DIR, `${name}${ext}`);
    try {
      await access(filePath);
      return { filePath, mime: MIME_BY_EXT[ext] };
    } catch {
      // try the next extension
    }
  }
  throw new Error(`no .webp or .png found for "${name}" in ${ASSETS_DIR}`);
}

async function enumerateEmoteFiles() {
  const seen = new Set();
  const files = [];
  for (const name of EMOTE_FILES) {
    if (seen.has(name)) continue; // dedupe (the spec's name list repeats "salute")
    seen.add(name);
    files.push({ name, ...(await resolveEmoteFile(name)) });
  }
  return files;
}

async function apiRequest(baseUrl, token, path_, init = {}) {
  const res = await fetch(`${baseUrl}${path_}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) {
    const code = typeof body?.error === 'string' ? body.error : (body?.error?.code ?? `HTTP_${res.status}`);
    throw new Error(`${init.method ?? 'GET'} ${path_} failed: ${code}`);
  }
  return body;
}

async function uploadMedia(baseUrl, token, filePath, mime) {
  const bytes = await readFile(filePath);
  const body = await apiRequest(baseUrl, token, '/api/media', {
    method: 'POST',
    headers: { 'Content-Type': mime, 'Content-Length': String(bytes.byteLength) },
    body: bytes,
  });
  return body.id;
}

async function findOrCreatePack(baseUrl, token) {
  const { packs } = await apiRequest(baseUrl, token, '/api/emotes');
  const existing = packs.find((pack) => pack.name === PACK_NAME);
  if (existing) return existing;
  return apiRequest(baseUrl, token, '/api/admin/emote-packs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: PACK_NAME }),
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = await enumerateEmoteFiles();

  if (args.dryRun) {
    console.log(`[dry-run] would seed pack "${PACK_NAME}" with ${files.length} emotes:`);
    for (const file of files) console.log(`  ${file.name}  <-  ${path.relative(process.cwd(), file.filePath)} (${file.mime})`);
    return;
  }

  if (!args.url) throw new Error('missing --url');
  if (!args.token) throw new Error('missing --token');
  const baseUrl = args.url.replace(/\/$/, '');

  const pack = await findOrCreatePack(baseUrl, args.token);
  const existingNames = new Set((pack.emotes ?? []).map((emote) => emote.name));
  console.log(`pack "${pack.name}" (${pack.id}) — ${existingNames.size} emote(s) already present`);

  let created = 0;
  let skipped = 0;
  for (const file of files) {
    if (existingNames.has(file.name)) {
      skipped += 1;
      continue;
    }
    const mediaId = await uploadMedia(baseUrl, args.token, file.filePath, file.mime);
    await apiRequest(baseUrl, args.token, `/api/admin/emote-packs/${pack.id}/emotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, media_id: mediaId }),
    });
    created += 1;
    console.log(`  + ${file.name}`);
  }

  console.log(`done: ${created} created, ${skipped} already present`);
}

main().catch((err) => {
  console.error(`seed-emotes: ${err.message}`);
  process.exitCode = 1;
});
