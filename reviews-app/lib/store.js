// Tiny JSON-file backed store for imported reviews. This is the "local only"
// persistence layer that always runs, regardless of whether Shopify sync is
// configured. Each review gets a stable id derived from its content so
// re-importing the same CSV does not create duplicates.

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '..', 'data', 'reviews.json');

function reviewId(r) {
  return createHash('sha1')
    .update([r.handle, r.author, r.title, r.content, r.created_at].join('|'))
    .digest('hex')
    .slice(0, 16);
}

async function readAll() {
  try {
    const raw = await readFile(DB_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeAll(reviews) {
  await mkdir(dirname(DB_PATH), { recursive: true });
  await writeFile(DB_PATH, JSON.stringify(reviews, null, 2), 'utf8');
}

/**
 * Merge new reviews into the store, de-duplicating by content hash.
 * @returns {{ added: number, duplicates: number, total: number }}
 */
export async function saveReviews(incoming) {
  const existing = await readAll();
  const seen = new Set(existing.map((r) => r.id));
  let added = 0;
  let duplicates = 0;

  for (const r of incoming) {
    const id = reviewId(r);
    if (seen.has(id)) {
      duplicates++;
      continue;
    }
    seen.add(id);
    existing.push({ id, ...r, imported_at: new Date().toISOString() });
    added++;
  }

  await writeAll(existing);
  return { added, duplicates, total: existing.length };
}

/** Return all stored reviews, newest first, optionally filtered by handle. */
export async function listReviews(handle) {
  const all = await readAll();
  const filtered = handle ? all.filter((r) => r.handle === handle) : all;
  return filtered.sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );
}

/** Aggregate count + average rating per product handle. */
export async function summary() {
  const all = await readAll();
  const byHandle = {};
  for (const r of all) {
    const s = (byHandle[r.handle] ||= { handle: r.handle, count: 0, sum: 0 });
    s.count++;
    s.sum += r.rating;
  }
  return Object.values(byHandle)
    .map((s) => ({
      handle: s.handle,
      count: s.count,
      average: Math.round((s.sum / s.count) * 100) / 100,
    }))
    .sort((a, b) => b.count - a.count);
}
