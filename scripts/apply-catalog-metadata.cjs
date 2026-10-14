#!/usr/bin/env node
'use strict';

// Metadata-only recovery operation. Defaults to a read-only plan. --apply is
// required to mutate; write_products must already belong to this installation.
// Never changes prices, inventory, barcodes, media, status or selling plans.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const env = fs.readFileSync(process.env.BASENOTE_ENV_FILE || path.resolve('.env'), 'utf8');
const token = env.match(/^SHOPIFY_ADMIN_API_ACCESS_TOKEN=(.*)$/m)?.[1].trim().replace(/^['"]|['"]$/g, '');
if (!token) throw new Error('Admin API token not configured');
const shop = 'ath7ay-1y.myshopify.com';
const api = `https://${shop}/admin/api/2026-07`;
const headers = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token };
const snapshotDir = fs.mkdtempSync('/private/tmp/basenote-catalog-metadata-');
const save = (name, value) => fs.writeFileSync(path.join(snapshotDir, name), JSON.stringify(value, null, 2), { mode: 0o600 });
const rest = async route => {
  const response = await fetch(`${api}/${route}`, { headers });
  const data = await response.json();
  if (!response.ok) throw new Error(`Admin ${response.status}: ${JSON.stringify(data.errors)}`);
  return data;
};
const graph = async (query, variables = {}) => {
  const response = await fetch(`${api}/graphql.json`, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
  const data = await response.json();
  if (!response.ok || data.errors) throw new Error(`GraphQL failed: ${JSON.stringify(data.errors || response.status)}`);
  for (const value of Object.values(data.data)) if (value?.userErrors?.length) throw new Error(JSON.stringify(value.userErrors));
  return data.data;
};
const UPDATE_PRODUCT = 'mutation UpdateCatalogMetadata($product: ProductUpdateInput!) { productUpdate(product: $product) { product { id title handle } userErrors { field message } } }';
const UPDATE_SKUS = 'mutation SetMerchantSkus($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $productId, variants: $variants) { productVariants { id sku } userErrors { field message } } }';
const prefix = '<p>A 5 ml Base Note travel atomizer, decanted from the original fragrance. Buy once without a subscription, or choose the optional recurring Monthly Rotation shown on this page. See the selected size and purchase option for current pricing.</p>';
const invariants = product => ({
  vendor: product.vendor, tags: product.tags, status: product.status, template: product.template_suffix,
  images: product.images.map(image => ({ id: image.id, src: image.src, position: image.position })),
  variants: product.variants.map(variant => Object.fromEntries(['id', 'price', 'compare_at_price', 'barcode', 'inventory_quantity', 'inventory_policy', 'inventory_management', 'weight', 'weight_unit', 'requires_shipping', 'taxable', 'option1', 'option2', 'option3'].map(key => [key, variant[key]])))
});

(async () => {
  const installation = await graph('query { currentAppInstallation { accessScopes { handle } } }');
  const scopes = installation.currentAppInstallation.accessScopes.map(scope => scope.handle);
  save('scope-check.json', scopes);
  if (!scopes.includes('read_products') && !scopes.includes('write_products')) throw new Error(`Catalog access is unavailable; granted scopes are ${scopes.join(', ')}. No product mutations were attempted. Recovery folder: ${snapshotDir}`);
  if (process.argv.includes('--apply') && !scopes.includes('write_products')) throw new Error('write_products is required before applying the plan.');
  const publicCatalog = await (await fetch('https://basenotescent.com/products.json?limit=250')).json();
  save('public-products-before.json', publicCatalog);
  const products = [];
  for (const candidate of publicCatalog.products) {
    if (candidate.handle === 'extra-5ml-vial-add-on' || candidate.variants.every(variant => Number(variant.price) === 0)) continue;
    if (!candidate.variants.length || !candidate.variants.every(variant => /^5\s?ml$/i.test(variant.title))) continue;
    const { product } = await rest(`products/${candidate.id}.json`);
    assert(product.variants.every(variant => /^5\s?ml$/i.test(variant.title)), `Mixed-size product must be reviewed separately: ${product.handle}`);
    products.push(product);
  }
  // Retain every exact affected record before any update.
  save('products-before.json', products);
  save('redirects-before.json', await rest('redirects.json?limit=250'));
  const plan = products.map(product => {
    const handle = product.handle === 'tom-ford-ombre-leather' && /oud wood/i.test(product.title) ? 'tom-ford-oud-wood' : product.handle;
    const input = { id: `gid://shopify/Product/${product.id}` };
    if (!/5\s?ml/i.test(product.title)) input.title = `${product.title} — 5 ml Travel Atomizer`;
    if (!/5\s?ml|decant|atomizer/i.test(product.body_html || '')) input.descriptionHtml = `${prefix}\n${product.body_html || ''}`;
    if (handle !== product.handle) Object.assign(input, { handle, redirectNewHandle: true });
    const variants = product.variants.filter(variant => !variant.sku).map(variant => ({ id: `gid://shopify/ProductVariant/${variant.id}`, inventoryItem: { sku: `BN-${handle.toUpperCase()}-5ML` } }));
    return { productId: product.id, oldHandle: product.handle, input, variants };
  });
  save('metadata-plan.json', plan);
  console.log(`Prepared ${plan.length} products. Recovery and plan: ${snapshotDir}`);
  if (!process.argv.includes('--apply')) { console.log('Read-only plan complete; no product mutations attempted.'); return; }
  const results = [];
  for (const entry of plan) {
    if (entry.input.handle) {
      const target = await fetch(`https://basenotescent.com/products/${entry.input.handle}`, { redirect: 'manual' });
      assert.equal(target.status, 404, `New handle already resolves: ${entry.input.handle}`);
    }
    if (Object.keys(entry.input).length > 1) await graph(UPDATE_PRODUCT, { product: entry.input });
    if (entry.variants.length) await graph(UPDATE_SKUS, { productId: entry.input.id, variants: entry.variants });
    const { product: after } = await rest(`products/${entry.productId}.json`);
    const before = products.find(product => product.id === entry.productId);
    save(`product-${entry.productId}-after.json`, after);
    assert.deepEqual(invariants(after), invariants(before), `Protected product fields changed: ${entry.productId}`);
    if (entry.input.title) assert.equal(after.title, entry.input.title);
    if (entry.input.descriptionHtml) assert.equal(after.body_html, entry.input.descriptionHtml);
    if (entry.input.handle) assert.equal(after.handle, entry.input.handle);
    for (const variant of entry.variants) assert.equal(after.variants.find(item => `gid://shopify/ProductVariant/${item.id}` === variant.id)?.sku, variant.inventoryItem.sku);
    results.push({ id: after.id, handle: after.handle, verified: true });
    save('applied-results.json', results);
    console.log(`Verified metadata: ${after.handle}`);
  }
  console.log('Metadata applied and protected fields verified. Re-run audit-store-content.cjs --apply-link-fixes to update any renamed product links.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
