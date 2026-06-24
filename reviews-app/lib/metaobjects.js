// Syncs imported reviews into Shopify as metaobjects of type
// "product_review", using the authenticated session's Admin GraphQL client.
//
// On first use it ensures the metaobject definition exists (with a storefront
// access capability so themes can read it), then upserts one metaobject per
// review keyed by a deterministic handle.

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

async function run(client, query, variables) {
  const res = await client.request(query, { variables });
  if (res.errors) {
    throw new Error(`GraphQL: ${JSON.stringify(res.errors)}`);
  }
  return res.data;
}

async function ensureDefinition(client) {
  const data = await run(
    client,
    `query($type: String!) {
      metaobjectDefinitionByType(type: $type) { id }
    }`,
    { type: DEFINITION.type }
  );

  if (data.metaobjectDefinitionByType) return;

  const created = await run(
    client,
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
        access: { storefront: 'PUBLIC_READ' },
        capabilities: { publishable: { enabled: true } },
        fieldDefinitions: DEFINITION.fieldDefinitions,
      },
    }
  );

  const errs = created.metaobjectDefinitionCreate.userErrors;
  if (errs.length) throw new Error(`Definition create: ${JSON.stringify(errs)}`);
}

async function upsertReview(client, r) {
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

  const data = await run(
    client,
    `mutation($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
      metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
        metaobject { id }
        userErrors { field message }
      }
    }`,
    {
      handle: { type: DEFINITION.type, handle: `review-${r.id}` },
      metaobject: {
        fields,
        capabilities: { publishable: { status: 'ACTIVE' } },
      },
    }
  );

  const errs = data.metaobjectUpsert.userErrors;
  if (errs.length) throw new Error(`Upsert ${r.handle}: ${JSON.stringify(errs)}`);
}

/**
 * Sync stored reviews (each needs an `id`) to Shopify metaobjects.
 * @param {object} client  shopify.api.clients.Graphql instance
 * @param {object[]} reviews
 */
export async function syncReviews(client, reviews) {
  await ensureDefinition(client);
  let synced = 0;
  let failed = 0;
  const errors = [];

  for (const r of reviews) {
    try {
      await upsertReview(client, r);
      synced++;
    } catch (err) {
      failed++;
      if (errors.length < 10) errors.push(err.message);
    }
  }

  return { synced, failed, errors };
}
