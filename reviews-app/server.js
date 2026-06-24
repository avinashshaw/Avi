import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCsv, rowsToReviews, REVIEW_FIELDS } from './lib/csv.js';
import { saveReviews, listReviews, summary } from './lib/store.js';
import * as shopify from './lib/shopify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// CSV uploads only, capped at 10 MB, kept in memory (we parse, never store the file).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ok =
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.mimetype === 'application/octet-stream' ||
      file.originalname.toLowerCase().endsWith('.csv');
    cb(ok ? null : new Error('Please upload a .csv file.'), ok);
  },
});

app.use(express.json());
app.use(express.static(resolve(__dirname, 'public')));

// --- Core endpoint: upload + parse a reviews CSV ---------------------------
app.post('/api/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No file uploaded.' });
    }

    const text = req.file.buffer.toString('utf8');
    const rows = parseCsv(text);
    const { reviews, errors, headers } = rowsToReviews(rows);

    if (!reviews.length) {
      return res.status(422).json({
        ok: false,
        error: 'No valid reviews found in the file.',
        details: errors,
        expected: REVIEW_FIELDS,
        headers,
      });
    }

    // 1) Always persist locally.
    const saved = await saveReviews(reviews);

    // 2) Optionally push to Shopify.
    let shopifyResult = { configured: false };
    const syncRequested = req.query.sync !== 'false';
    if (shopify.isConfigured() && syncRequested) {
      const stored = await listReviews();
      const justAdded = stored.slice(0, saved.added);
      shopifyResult = { configured: true, ...(await shopify.syncReviews(justAdded)) };
    }

    res.json({
      ok: true,
      parsed: reviews.length,
      added: saved.added,
      duplicates: saved.duplicates,
      totalStored: saved.total,
      rowErrors: errors,
      shopify: shopifyResult,
      preview: reviews.slice(0, 5),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Read endpoints (used by the storefront Liquid section & dashboard) -----
app.get('/api/reviews', async (req, res) => {
  res.json({ ok: true, reviews: await listReviews(req.query.handle) });
});

app.get('/api/summary', async (_req, res) => {
  res.json({ ok: true, shopifyConfigured: shopify.isConfigured(), products: await summary() });
});

// Multer / generic error handler.
app.use((err, _req, res, _next) => {
  res.status(400).json({ ok: false, error: err.message });
});

app.listen(PORT, () => {
  console.log(`Shopify Reviews App running at http://localhost:${PORT}`);
  console.log(
    shopify.isConfigured()
      ? `Shopify sync: ENABLED (${process.env.SHOPIFY_SHOP})`
      : 'Shopify sync: disabled (local JSON only — set SHOPIFY_* in .env to enable)'
  );
});
