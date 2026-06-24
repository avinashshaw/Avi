// Per-shop JSON storage for imported reviews. Each installed shop gets its own
// file (data/reviews-<shop>.json). Reviews are de-duplicated by a content hash
// so re-importing the same CSV does not create duplicates.

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'data');

function fileFor(shop) {
  const safe = shop.replace(/[^a-z0-9.-]/gi, '_');
  return resolve(DATA_DIR, `reviews-${safe}.json`);
}

function reviewId(r) {
  return createHash('sha1')
    .update([r.handle, r.author, r.title, r.content, r.created_at].join('|'))
    .digest('hex')
    .slice(0, 16);
}

async function readAll(shop) {
  try {
    return JSON.parse(await readFile(fileFor(shop), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeAll(shop, reviews) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(fileFor(shop), JSON.stringify(reviews, null, 2), 'utf8');
}

/** Merge new reviews for a shop, de-duplicating by content hash. */
export async function saveReviews(shop, incoming) {
  const existing = await readAll(shop);
  const seen = new Set(existing.map((r) => r.id));
  const added = [];
  let duplicates = 0;

  for (const r of incoming) {
    const id = reviewId(r);
    if (seen.has(id)) {
      duplicates++;
      continue;
    }
    seen.add(id);
    const record = { id, ...r, imported_at: new Date().toISOString() };
    existing.push(record);
    added.push(record);
  }

  await writeAll(shop, existing);
  return { added, duplicates, total: existing.length };
}

export async function listReviews(shop, handle) {
  const all = await readAll(shop);
  const filtered = handle ? all.filter((r) => r.handle === handle) : all;
  return filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export async function summary(shop) {
  const all = await readAll(shop);
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

/** Remove all stored data for a shop (called on uninstall / shop redact). */
export async function deleteShopData(shop) {
  try {
    await unlink(fileFor(shop));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}
