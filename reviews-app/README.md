# Shopify Reviews App — CSV Importer

A lightweight Shopify product-reviews app whose core feature is **uploading a
CSV file** of reviews. It parses the exact schema produced by common review
export tools, validates every row, stores the reviews, and (optionally) syncs
them into Shopify as **metaobjects** so a theme section can render them on the
storefront.

## CSV format

The header row must contain these columns (order doesn't matter; extra columns
are ignored):

```
rating,handle,author,email,title,content,images,created_at,country_code
```

| Column         | Required | Notes                                                        |
| -------------- | :------: | ------------------------------------------------------------ |
| `rating`       |    ✅    | Integer 1–5                                                  |
| `handle`       |    ✅    | Product handle the review belongs to                        |
| `content`      |    ✅    | Review body text                                            |
| `author`       |          | Defaults to "Anonymous" if empty                           |
| `email`        |          | Reviewer email                                              |
| `title`        |          | Review title                                                |
| `images`       |          | Comma-separated image URLs inside **one quoted cell**       |
| `created_at`   |          | e.g. `2023-11-11 14:24:00` (defaults to now)                |
| `country_code` |          | e.g. `US`                                                  |

A ready-to-test file is included: [`sample-reviews.csv`](./sample-reviews.csv).

## Run locally

```bash
cd reviews-app
npm install
cp .env.example .env      # optional: fill in SHOPIFY_* to enable sync
npm start
```

Open http://localhost:3000 and upload your CSV.

- **Without Shopify credentials** the app runs in *local-only* mode: reviews are
  parsed, de-duplicated, and saved to `data/reviews.json`.
- **With `SHOPIFY_SHOP` + `SHOPIFY_ADMIN_TOKEN` set**, each new review is also
  upserted into Shopify as a `product_review` metaobject.

### Shopify credentials

Create a custom app in your Shopify admin
(*Settings → Apps and sales channels → Develop apps*) and grant these Admin API
scopes: `read_metaobjects`, `write_metaobjects`, `read_products`. Copy the
Admin API access token (`shpat_…`) into `.env`.

## Show reviews on the storefront

Copy [`theme/product-reviews.liquid`](./theme/product-reviews.liquid) to your
theme's `sections/` folder, then add the **"Product reviews"** section to your
product template (or `{% section 'product-reviews' %}` in `product.liquid`). It
reads the `product_review` metaobjects and shows reviews matching the current
product's handle, with star average, photos, author, and date.

## Project layout

```
reviews-app/
├─ server.js                  Express server + /api/import endpoint
├─ lib/
│  ├─ csv.js                  RFC-4180 CSV parser + row validation
│  ├─ store.js                JSON-file storage with de-duplication
│  └─ shopify.js              Admin GraphQL metaobject sync (optional)
├─ public/                    Upload UI (HTML/CSS/JS)
├─ theme/product-reviews.liquid   Storefront section
└─ sample-reviews.csv
```

## API

| Method | Route                       | Purpose                              |
| ------ | --------------------------- | ------------------------------------ |
| POST   | `/api/import?sync=true`     | Upload + import a reviews CSV        |
| GET    | `/api/reviews?handle=...`   | List stored reviews (optional filter)|
| GET    | `/api/summary`              | Per-product count + average rating   |
