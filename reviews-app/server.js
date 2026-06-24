import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import serveStatic from 'serve-static';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

import shopify from './lib/config.js';
import webhookHandlers from './lib/webhooks.js';
import { parseCsv, rowsToReviews, reviewsToCsv, REVIEW_FIELDS } from './lib/csv.js';
import { saveReviews, listReviews, summary } from './lib/store.js';
import { syncReviews } from './lib/metaobjects.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);
const FRONTEND = join(__dirname, 'frontend');

const app = express();

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

// --- OAuth install flow ----------------------------------------------------
app.get(shopify.config.auth.path, shopify.auth.begin());
app.get(
  shopify.config.auth.callbackPath,
  shopify.auth.callback(),
  shopify.redirectToShopifyOrAppRoot()
);

// --- Webhooks (raw body verified by the framework) -------------------------
app.post(
  shopify.config.webhooks.path,
  shopify.processWebhooks({ webhookHandlers })
);

// --- Authenticated API -----------------------------------------------------
// Every /api/* route below this point requires a valid embedded session token.
app.use('/api/*splat', shopify.validateAuthenticatedSession());
app.use(express.json());

function clientFor(res) {
  const session = res.locals.shopify.session;
  return { session, gql: new shopify.api.clients.Graphql({ session }) };
}

// Core endpoint: upload + import a reviews CSV.
app.post('/api/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No file uploaded.' });
    }

    const { session, gql } = clientFor(res);
    const rows = parseCsv(req.file.buffer.toString('utf8'));
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

    const saved = await saveReviews(session.shop, reviews);

    // Push the newly added reviews to Shopify as metaobjects.
    let shopifyResult = { synced: 0, failed: 0, errors: [] };
    if (saved.added.length) {
      shopifyResult = await syncReviews(gql, saved.added);
    }

    res.json({
      ok: true,
      parsed: reviews.length,
      added: saved.added.length,
      duplicates: saved.duplicates,
      totalStored: saved.total,
      rowErrors: errors,
      shopify: shopifyResult,
      preview: saved.added.slice(0, 5),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/reviews', async (req, res) => {
  const { session } = clientFor(res);
  res.json({ ok: true, reviews: await listReviews(session.shop, req.query.handle) });
});

app.get('/api/summary', async (_req, res) => {
  const { session } = clientFor(res);
  res.json({ ok: true, shop: session.shop, products: await summary(session.shop) });
});

// Export all (or one product's) reviews as a CSV download, using the same
// column schema as the importer so the file round-trips back through /api/import.
app.get('/api/export', async (req, res) => {
  try {
    const { session } = clientFor(res);
    const handle = req.query.handle || undefined;
    const reviews = await listReviews(session.shop, handle);
    const csv = reviewsToCsv(reviews);

    const stamp = new Date().toISOString().slice(0, 10);
    const slug = (handle || session.shop.replace(/\.myshopify\.com$/, '')).replace(
      /[^a-z0-9.-]/gi,
      '_'
    );
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="reviews-${slug}-${stamp}.csv"`);
    res.set('X-Review-Count', String(reviews.length));
    res.send(csv);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Embedded frontend -----------------------------------------------------
app.use(shopify.cspHeaders());
app.use(serveStatic(FRONTEND, { index: false }));

// Serve the embedded app for the root and any other non-API path.
app.use(shopify.ensureInstalledOnShop(), async (_req, res) => {
  const html = (await readFile(join(FRONTEND, 'index.html'), 'utf8')).replace(
    /%SHOPIFY_API_KEY%/g,
    process.env.SHOPIFY_API_KEY || ''
  );
  res.set('Content-Type', 'text/html').send(html);
});

// Generic error handler (e.g. multer file-type/size errors).
app.use((err, _req, res, _next) => {
  res.status(400).json({ ok: false, error: err.message });
});

app.listen(PORT, () => {
  console.log(`Reviews app listening on ${process.env.SHOPIFY_APP_URL || `http://localhost:${PORT}`}`);
  if (!process.env.SHOPIFY_API_KEY || !process.env.SHOPIFY_API_SECRET) {
    console.warn('⚠  SHOPIFY_API_KEY / SHOPIFY_API_SECRET are not set — see .env.example');
  }
});
