# Reviews Importer — Installable Shopify App

An **installable, embedded Shopify app** whose core feature is uploading a CSV
file of product reviews. It runs the official Shopify OAuth install flow,
embeds in the Shopify admin via App Bridge, parses the standard review-export
schema, validates every row, and stores the reviews in your shop as
`product_review` **metaobjects** (readable by your theme).

```
rating,handle,author,email,title,content,images,created_at,country_code
```

## What's included

- **OAuth install flow** + session storage (`@shopify/shopify-app-express`)
- **Embedded admin UI** (App Bridge + drag-and-drop CSV upload)
- **CSV importer**: RFC-4180 parser, per-row validation, content-hash de-dup
- **Metaobject sync**: creates the `product_review` definition automatically and
  upserts one metaobject per review
- **Webhooks**: `app/uninstalled` cleanup + the three mandatory GDPR/compliance
  webhooks required for app review
- **Storefront Liquid section** to render reviews on product pages
- `shopify.app.toml` app configuration

## CSV format

| Column         | Required | Notes                                                  |
| -------------- | :------: | ------------------------------------------------------ |
| `rating`       |    ✅    | Integer 1–5                                            |
| `handle`       |    ✅    | Product handle the review belongs to                  |
| `content`      |    ✅    | Review body text                                      |
| `author`       |          | Defaults to "Anonymous" if empty                     |
| `email`        |          | Reviewer email                                        |
| `title`        |          | Review title                                          |
| `images`       |          | Comma-separated image URLs inside **one quoted cell** |
| `created_at`   |          | e.g. `2023-11-11 14:24:00` (defaults to now)          |
| `country_code` |          | e.g. `US`                                            |

A test file is included: [`sample-reviews.csv`](./sample-reviews.csv).

## Install & run (development)

**1. Create the app** in your [Shopify Partner Dashboard](https://partners.shopify.com)
(or run `shopify app config link` with the Shopify CLI). Note the API key/secret.

**2. Configure environment:**

```bash
cd reviews-app
npm install
cp .env.example .env      # fill in SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_APP_URL
```

**3. Run it.** Easiest path uses the Shopify CLI, which provisions an HTTPS
tunnel, sets the URLs, and opens the install prompt:

```bash
npm run dev               # or: shopify app dev
```

Or run the server directly behind your own HTTPS tunnel (ngrok, Cloudflare):

```bash
SHOPIFY_APP_URL=https://<your-tunnel> npm start
```

Then open `https://<your-tunnel>/api/auth?shop=<your-store>.myshopify.com` to
install, or click **Install** from the Partner Dashboard. After OAuth you'll
land on the embedded importer inside the Shopify admin.

> Note: the OAuth endpoints reject non-browser (bot) user agents with `410` —
> install from a real browser, not `curl`.

## How it works

1. Merchant installs → offline access token stored in `data/sessions.json`.
2. Merchant uploads a CSV in the embedded UI. The frontend attaches an App
   Bridge session token; `validateAuthenticatedSession` authorizes the request.
3. The server parses + validates the CSV, saves reviews to
   `data/reviews-<shop>.json` (de-duplicated), then upserts each as a
   `product_review` metaobject via the Admin GraphQL API.
4. On uninstall / shop redact, the shop's stored data is deleted.

## Show reviews on the storefront

Copy [`theme/product-reviews.liquid`](./theme/product-reviews.liquid) into your
theme's `sections/` folder and add the **"Product reviews"** section to the
product template. It reads the `product_review` metaobjects (which are exposed
to the storefront) and shows reviews matching the current product's handle.

## Project layout

```
reviews-app/
├─ server.js                  Embedded app server (OAuth, API, frontend)
├─ shopify.app.toml           App configuration
├─ lib/
│  ├─ config.js               shopifyApp() setup
│  ├─ session-storage.js      JSON-file SessionStorage adapter
│  ├─ webhooks.js             uninstall + GDPR webhook handlers
│  ├─ csv.js                  RFC-4180 CSV parser + row validation
│  ├─ store.js                per-shop JSON storage with de-duplication
│  └─ metaobjects.js          Admin GraphQL metaobject sync
├─ frontend/                  Embedded admin UI (App Bridge)
├─ theme/product-reviews.liquid   Storefront section
└─ sample-reviews.csv
```

## Production notes

- Swap the JSON `sessionStorage` and review store for a database
  (e.g. `@shopify/shopify-app-session-storage-postgresql`) when running more
  than one instance.
- Host behind HTTPS; set `SHOPIFY_APP_URL` to your public domain.
- Keep `shopify.app.toml` scopes in sync with `SCOPES` in `.env`.
