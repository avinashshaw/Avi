// Optional Shopify Admin GraphQL sync. If SHOPIFY_SHOP / SHOPIFY_ADMIN_TOKEN
// are not set, isConfigured() returns false and the server skips this layer
// entirely (local JSON storage still works).
//
// Reviews are stored as Shopify metaobjects of type "product_review". On first
// use we ensure the metaobject definition exists, then upsert one metaobject
// per review keyed by a deterministic handle.

const SHOP = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-10';

export function isConfigured() {
  return Boolean(SHOP && TOKEN);
}

async function gql(query, variables = {}) {
  const res = await fetch(
    `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    }
  );

  if (!res.ok) {
    throw new Error(`Shopify HTTP ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`Shopify GraphQL: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

const DEFINITION = {
  type: 'product_review',
  name: 'Product Review',
  fieldDefinitions: [
    { key: 'rating', name: 'Rating', type: 'number_integer' },
    { key: 'handle', name: 'Product handle', type: 'single_line_text_field' },
    { key: 'author', name: 'Author', type: 'single_line_text_field' },
    { key: 'email', name: 'Email', type: 'single_line_text_field' },
    { key: 'title', name: 'Title', type: 'single_line_text_field' },
    { key: 'content', name: 'Content', type: 'multi_line_text_field' },
    { key: 'images', name: 'Images', type: 'json' },
    { key: 'created_at', name: 'Created at', type: 'single_line_text_field' },
    { key: 'country_code', name: 'Country', type: 'single_line_text_field' },
  ],
};

let definitionReady = false;

async function ensureDefinition() {
  if (definitionReady) return;

  const data = await gql(
    `query($type: String!) {
      metaobjectDefinitionByType(type: $type) { id }
    }`,
    { type: DEFINITION.type }
  );

  if (!data.metaobjectDefinitionByType) {
    const created = await gql(
      `mutation($def: MetaobjectDefinitionCreateInput!) {
        metaobjectDefinitionCreate(definition: $def) {
          metaobjectDefinition { id }
          userErrors { field message }
        }
      }`,
      {
        def: {
          type: DEFINITION.type,
          name: DEFINITION.name,
          fieldDefinitions: DEFINITION.fieldDefinitions.map((f) => ({
            key: f.key,
            name: f.name,
            type: f.type,
          })),
        },
      }
    );
    const errs = created.metaobjectDefinitionCreate.userErrors;
    if (errs.length) {
      throw new Error(`Definition create failed: ${JSON.stringify(errs)}`);
    }
  }

  definitionReady = true;
}

function handleFor(r, id) {
  return `review-${id}`;
}

/**
 * Upsert one review as a metaobject. Returns the metaobject id.
 */
async function upsertReview(r) {
  const fields = [
    { key: 'rating', value: String(r.rating) },
    { key: 'handle', value: r.handle },
    { key: 'author', value: r.author || '' },
    { key: 'email', value: r.email || '' },
    { key: 'title', value: r.title || '' },
    { key: 'content', value: r.content || '' },
    { key: 'images', value: JSON.stringify(r.images || []) },
    { key: 'created_at', value: r.created_at || '' },
    { key: 'country_code', value: r.country_code || '' },
  ];

  const data = await gql(
    `mutation($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
      metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
        metaobject { id handle }
        userErrors { field message }
      }
    }`,
    {
      handle: { type: DEFINITION.type, handle: handleFor(r, r.id) },
      metaobject: { fields, capabilities: { publishable: { status: 'ACTIVE' } } },
    }
  );

  const errs = data.metaobjectUpsert.userErrors;
  if (errs.length) {
    throw new Error(`Upsert failed for ${r.handle}: ${JSON.stringify(errs)}`);
  }
  return data.metaobjectUpsert.metaobject.id;
}

/**
 * Sync an array of stored reviews (each needs an `id`) to Shopify.
 * @returns {{ synced: number, failed: number, errors: string[] }}
 */
export async function syncReviews(reviews) {
  await ensureDefinition();
  let synced = 0;
  let failed = 0;
  const errors = [];

  for (const r of reviews) {
    try {
      await upsertReview(r);
      synced++;
    } catch (err) {
      failed++;
      errors.push(err.message);
    }
  }

  return { synced, failed, errors };
}
