// Dependency-free CSV parser + review-row normaliser.
//
// Handles the exact schema produced by review-export tools:
//   rating,handle,author,email,title,content,images,created_at,country_code
//
// The parser is RFC-4180 aware: it understands quoted fields, escaped quotes
// ("" inside a quoted field), and commas / newlines embedded inside quotes
// (the `images` and `content` columns rely on this).

/**
 * Parse raw CSV text into an array of string-cell rows.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  // Normalise newlines and strip a leading UTF-8 BOM if present.
  const input = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"'; // escaped quote
          i++;
        } else {
          inQuotes = false; // closing quote
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  // Flush the final field/row (file may not end with a newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

// Canonical columns we expect, in no particular order. Anything else in the
// header is ignored; missing optional columns simply come through empty.
export const REVIEW_FIELDS = [
  'rating',
  'handle',
  'author',
  'email',
  'title',
  'content',
  'images',
  'created_at',
  'country_code',
];

const REQUIRED_FIELDS = ['rating', 'handle', 'content'];

/**
 * Turn parsed CSV rows into validated review objects.
 * @param {string[][]} rows  output of parseCsv()
 * @returns {{ reviews: object[], errors: string[], headers: string[] }}
 */
export function rowsToReviews(rows) {
  const errors = [];
  if (!rows.length) {
    return { reviews: [], errors: ['CSV file is empty.'], headers: [] };
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const index = {};
  REVIEW_FIELDS.forEach((f) => {
    index[f] = header.indexOf(f);
  });

  const missingRequired = REQUIRED_FIELDS.filter((f) => index[f] === -1);
  if (missingRequired.length) {
    errors.push(
      `Missing required column(s): ${missingRequired.join(', ')}. ` +
        `Expected header: ${REVIEW_FIELDS.join(',')}`
    );
    return { reviews: [], errors, headers: header };
  }

  const cell = (cols, field) => {
    const i = index[field];
    return i === -1 || i >= cols.length ? '' : (cols[i] ?? '').trim();
  };

  const reviews = [];
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    // Skip fully blank lines.
    if (cols.length === 1 && cols[0].trim() === '') continue;

    const lineNo = r + 1; // 1-based, accounting for header row
    const rawRating = cell(cols, 'rating');
    const rating = Number.parseInt(rawRating, 10);
    const handle = cell(cols, 'handle');
    const content = cell(cols, 'content');

    if (!handle) {
      errors.push(`Row ${lineNo}: missing product "handle" — skipped.`);
      continue;
    }
    if (!content) {
      errors.push(`Row ${lineNo}: missing review "content" — skipped.`);
      continue;
    }
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      errors.push(`Row ${lineNo}: rating "${rawRating}" is not 1–5 — skipped.`);
      continue;
    }

    const images = cell(cols, 'images')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);

    reviews.push({
      rating,
      handle,
      author: cell(cols, 'author') || 'Anonymous',
      email: cell(cols, 'email'),
      title: cell(cols, 'title'),
      content,
      images,
      created_at: cell(cols, 'created_at') || new Date().toISOString(),
      country_code: cell(cols, 'country_code').toUpperCase(),
    });
  }

  return { reviews, errors, headers: header };
}

// --- Serialisation (export) ------------------------------------------------

/** Quote a single CSV cell per RFC-4180 when it contains , " or a newline. */
function escapeCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Serialise review objects back into a CSV string using the exact same
 * column schema reviews are imported in (REVIEW_FIELDS). Round-trips cleanly:
 * parseCsv(reviewsToCsv(x)) -> rowsToReviews -> x.
 * @param {object[]} reviews
 * @returns {string}
 */
export function reviewsToCsv(reviews) {
  const lines = [REVIEW_FIELDS.join(',')];

  for (const r of reviews) {
    const images = Array.isArray(r.images) ? r.images.join(',') : r.images || '';
    const row = [
      r.rating,
      r.handle,
      r.author,
      r.email,
      r.title,
      r.content,
      images,
      r.created_at,
      r.country_code,
    ];
    lines.push(row.map(escapeCell).join(','));
  }

  // Prepend a UTF-8 BOM so Excel opens accented characters correctly.
  return '﻿' + lines.join('\r\n') + '\r\n';
}
