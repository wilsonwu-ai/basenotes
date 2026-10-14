#!/usr/bin/env node
'use strict';

// Read-only by default. --apply-link-fixes changes only article body links;
// --apply-redirects repairs the two verified historical fragrance URLs,
// after retaining the full original API records in a private temporary folder.
const fs = require('node:fs');
const path = require('node:path');

const SHOP = 'ath7ay-1y.myshopify.com';
const SOURCE = 'https://basenotescent.com';
const envPath = process.env.BASENOTE_ENV_FILE || path.resolve('.env');
const env = fs.readFileSync(envPath, 'utf8');
const token = env.match(/^SHOPIFY_ADMIN_API_ACCESS_TOKEN=(.*)$/m)?.[1].trim().replace(/^['"]|['"]$/g, '');
if (!token) throw new Error('Admin token not configured');
const snapshotDir = fs.mkdtempSync('/private/tmp/basenote-audit-content-');
const save = (name, data) => fs.writeFileSync(path.join(snapshotDir, name), JSON.stringify(data, null, 2), { mode: 0o600 });
const call = async (route, method = 'GET', body) => {
  const response = await fetch(`https://${SHOP}/admin/api/2026-07/${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${route}: ${response.status} ${JSON.stringify(data)}`);
  return data;
};

(async () => {
  const products = await (await fetch(`${SOURCE}/products.json?limit=250`)).json();
  save('public-products-before.json', products);
  const { blogs } = await call('blogs.json?limit=250');
  save('blogs-before.json', blogs);
  const publicHandles = new Set(products.products.map(p => p.handle));
  const catalogPlan = products.products.filter(product => product.variants.some(variant => /^5\s?ml$/i.test(variant.title))).map(product => ({
    id: product.id,
    handle: product.handle,
    originalTitle: product.title,
    proposedTitle: /5\s?ml/i.test(product.title) ? product.title : `${product.title} — 5 ml Travel Atomizer`,
    proposedDescriptionPrefix: '<p>A 5 ml Base Note travel atomizer, decanted from the original fragrance. Buy once without a subscription, or choose the optional recurring Monthly Rotation shown on this page. See the selected size and purchase option for current pricing.</p>',
    variants: product.variants.map(variant => ({ id: variant.id, originalSku: variant.sku, proposedSku: variant.sku || `BN-${(product.handle === 'tom-ford-ombre-leather' ? 'tom-ford-oud-wood' : product.handle).toUpperCase()}-${variant.title.toUpperCase().replace(/\s/g, '')}` })),
    imageAction: 'PRESERVE existing images; new accurate vial photography is a separate deliverable',
    barcodeAction: 'Do not borrow a manufacturer GTIN for an independently decanted vial',
    ...(product.handle === 'tom-ford-ombre-leather' ? { proposedHandle: 'tom-ford-oud-wood', redirectNewHandle: true } : {})
  }));
  save('catalog-metadata-plan.json', catalogPlan);
  const fixes = [];
  const articleSummaries = [];
  for (const blog of blogs) {
    const data = await call(`blogs/${blog.id}/articles.json?limit=250`);
    save(`articles-${blog.id}-before.json`, data);
    for (const article of data.articles) {
      let body = article.body_html;
      const links = [...body.matchAll(/href=["']([^"']+)["']/g)].map(m => m[1]);
      articleSummaries.push({ id: article.id, blogId: blog.id, handle: article.handle, publishedAt: article.published_at, title: article.title, productLinks: links.filter(h => h.includes('/products/')), collectionLinks: links.filter(h => h.includes('/collections/')) });
      body = body.replace(/(href=["'])(?:https:\/\/basenotescent\.com)?\/collections\/all(?=["'?#])/g, '$1/collections/fragrances');
      body = body.replace(/(href=["'])(?:https:\/\/basenotescent\.com)?\/products\/bond-no-9-the-scent-of-peace-for-him(?=["'?#])/g, '$1/products/bond-no-9-the-scent-of-peace');
      body = body.replace(/(href=["'])(?:https:\/\/basenotescent\.com)?\/products\/bond-no-9-bleecker-street-one-time(?=["'?#])/g, '$1/products/bond-no-9-bleecker-street');
      // Only replace Tom Ford after its real catalog handle has changed.
      if (publicHandles.has('tom-ford-oud-wood')) {
        body = body.replace(/(href=["'])(?:https:\/\/basenotescent\.com)?\/products\/tom-ford-ombre-leather(?=["'?#])/g, '$1/products/tom-ford-oud-wood');
      }
      if (article.handle === 'best-fragrance-subscriptions-2026-comparison') {
        const currentProductLinks = [...body.matchAll(/href=["'][^"']*\/products\/([^"'?#]+)/g)];
        if (currentProductLinks.length < 3) {
          const candidates = [
            ['creed-aventus', 'Creed Aventus'],
            ['pdm-layton', 'Parfums de Marly Layton'],
            [publicHandles.has('tom-ford-oud-wood') ? 'tom-ford-oud-wood' : 'tom-ford-ombre-leather', 'Tom Ford Oud Wood'],
            ['xerjoff-erba-pura', 'Xerjoff Erba Pura']
          ].filter(([handle]) => publicHandles.has(handle));
          const productLinks = candidates.map(([handle, name]) => `<a href="/products/${handle}">${name}</a>`).join(', ');
          body += `\n<section data-basenote-audit="commercial-links"><h2>Try a scent before choosing a subscription</h2><p>Start with a one-time 5 ml vial of ${productLinks}. Browse <a href="/collections/fragrances">all Base Note fragrances</a> to compare scents and current pricing. Monthly Rotation is an optional recurring subscription; you can also buy a vial once without subscribing.</p></section>`;
        }
        // Link the brand's comparison-table cell while preserving existing markup.
        body = body.replace(/(<t[dh][^>]*>\s*(?:<strong>)?)Base Note((?:<\/strong>)?\s*<\/t[dh]>)/i, '$1<a href="/collections/fragrances">Base Note</a>$2');
      }
      if (body !== article.body_html) fixes.push({ blogId: blog.id, id: article.id, handle: article.handle, body_html: body });
    }
  }
  save('article-link-plan.json', fixes);
  save('article-summary.json', articleSummaries);
  if (process.argv.includes('--create-purchase-pages')) {
    const pages = await call('pages.json?limit=250');
    save('pages-before.json', pages);
    const pagePlan = [
      { title: 'Monthly Rotation', handle: 'monthly-rotation', template_suffix: 'monthly-rotation', body_html: '<p>Monthly Rotation is the optional Base Note fragrance subscription. Choose a 5 ml scent vial, then manage your upcoming fragrances in your account. Visit a fragrance page to see the current first-shipment and monthly renewal prices before subscribing.</p><p><a href="/collections/fragrances">Explore the fragrances</a></p>' },
      { title: 'Full Bottles', handle: 'full-bottles', template_suffix: 'full-bottles', body_html: '<p>Found a fragrance you love? Explore its full-bottle option to see available sizes and current pricing. If a full bottle is not listed for purchase, request its availability before ordering. A 5 ml vial is a travel sample, not a full-size bottle.</p><p><a href="/collections/fragrances">Find your fragrance</a></p>' }
    ];
    for (const page of pagePlan) {
      const existing = pages.pages.find(item => item.handle === page.handle);
      if (existing) { console.log(`Existing purchase page: ${page.handle} (${existing.id})`); continue; }
      const result = await call('pages.json', 'POST', { page: { ...page, published: false } });
      save(`page-${result.page.id}-after.json`, result);
      console.log(`Created draft purchase page: ${page.handle} (${result.page.id})`);
    }
  }
  if (process.argv.includes('--publish-purchase-pages')) {
    const pages = await call('pages.json?limit=250');
    save('pages-before-publish.json', pages);
    for (const handle of ['monthly-rotation', 'full-bottles']) {
      const page = pages.pages.find(item => item.handle === handle);
      if (!page || page.template_suffix !== handle || !page.body_html) throw new Error(`Purchase page not ready: ${handle}`);
      if (page.published_at) { console.log(`Purchase page already published: ${handle}`); continue; }
      const result = await call(`pages/${page.id}.json`, 'PUT', { page: { id: page.id, published: true } });
      save(`page-${page.id}-published.json`, result);
      console.log(`Published purchase page: ${handle} (${page.id})`);
    }
  }
  if (process.argv.includes('--apply-redirects')) {
    const redirects = await call('redirects.json?limit=250');
    save('redirects-before.json', redirects);
    const redirectPlan = [
      { path: '/products/bond-no-9-the-scent-of-peace-for-him', target: '/products/bond-no-9-the-scent-of-peace' },
      { path: '/products/bond-no-9-bleecker-street-one-time', target: '/products/bond-no-9-bleecker-street' }
    ];
    for (const redirect of redirectPlan) {
      const prior = redirects.redirects.find(item => item.path === redirect.path);
      if (prior) {
        if (prior.target !== redirect.target) throw new Error(`Existing redirect conflict: ${redirect.path}`);
        continue;
      }
      const current = await fetch(`${SOURCE}${redirect.path}`, { redirect: 'manual' });
      const target = await fetch(`${SOURCE}${redirect.target}`);
      if (current.status !== 404 || target.status !== 200) throw new Error(`Redirect precondition failed: ${redirect.path}`);
      const result = await call('redirects.json', 'POST', { redirect });
      save(`redirect-${result.redirect.id}-after.json`, result);
      console.log(`Created 301: ${redirect.path} -> ${redirect.target}`);
    }
  }
  console.log(JSON.stringify({ snapshotDir, articleCount: articleSummaries.length, publishedCount: articleSummaries.filter(article => article.publishedAt).length, plannedFixes: fixes.map(f => ({ id: f.id, handle: f.handle })) }, null, 2));
  if (process.argv.includes('--apply-link-fixes')) {
    for (const fix of fixes) {
      const result = await call(`blogs/${fix.blogId}/articles/${fix.id}.json`, 'PUT', { article: { id: fix.id, body_html: fix.body_html } });
      if (result.article.body_html !== fix.body_html) throw new Error(`Readback mismatch: ${fix.handle}`);
      save(`article-${fix.id}-after.json`, result);
      console.log(`Updated article links: ${fix.handle}`);
    }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
