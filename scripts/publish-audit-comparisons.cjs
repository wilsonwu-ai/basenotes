#!/usr/bin/env node
'use strict';

// Publishes only the two reviewed audit comparison articles. Before any write,
// saves the existing article records and every cited primary source. Existing
// articles are never overwritten. Run with --publish after reviewing the HTML.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const env = fs.readFileSync(process.env.BASENOTE_ENV_FILE || path.join(root, '.env'), 'utf8');
const token = env.match(/^SHOPIFY_ADMIN_API_ACCESS_TOKEN=(.*)$/m)?.[1].trim().replace(/^['"]|['"]$/g, '');
if (!token) throw new Error('Admin API credential not configured');
const BLOG_ID = 102965346522;
const origin = 'https://basenotescent.com';
const backup = fs.mkdtempSync('/private/tmp/basenote-editorial-comparisons-');
const save = (name, value) => fs.writeFileSync(path.join(backup, name), JSON.stringify(value, null, 2), { mode: 0o600 });
// Shopify's HTML sanitizer adds whitespace around table elements.
const normalizeHtml = html => html.replace(/>\s+</g, '><').trim();
const api = async (route, method = 'GET', body) => {
  const response = await fetch(`https://ath7ay-1y.myshopify.com/admin/api/2026-07/${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Admin ${response.status}: ${JSON.stringify(data.errors)}`);
  return data;
};
const articles = [
  {
    handle: 'scentbox-vs-base-note',
    title: 'ScentBox vs Base Note: Sizes, Prices and One-Time Vials',
    filename: 'scentbox-vs-base-note.html',
    tags: 'ScentBox, Comparisons, Fragrance samples',
    summary: 'Compare ScentBox and Base Note by sample size, regular price, one-time options and exchange rules. Find the format that fits how you wear fragrance.'
  },
  {
    handle: 'olfactif-alternatives',
    title: 'Olfactif Alternatives: Curated Boxes or Your Own Samples',
    filename: 'olfactif-alternatives.html',
    tags: 'Olfactif, Comparisons, Fragrance samples',
    summary: 'Compare Olfactif curated boxes, individual samples and Base Note 5ml vials. Choose your own scents, explore a monthly rotation, or buy just once.'
  }
];

(async () => {
  const existing = await api(`blogs/${BLOG_ID}/articles.json?limit=250`);
  save('articles-before.json', existing);
  assert(existing.articles.length < 250, 'Paginate the existing article list before checking duplicate handles');
  const sourceUrls = new Set(['https://www.olfactif.com/products/subscriptions.js', `${origin}/products/creed-aventus.js`]);
  const internalUrls = new Set();
  for (const article of articles) {
    article.body_html = fs.readFileSync(path.join(root, 'docs/editorial', article.filename), 'utf8');
    const words = article.body_html.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).length;
    assert(words >= 500 && words <= 800, `${article.handle}: unexpected article length`);
    assert(!/<script\b|<h1\b/i.test(article.body_html), 'Article body must not add scripts or a duplicate H1');
    for (const [, href] of article.body_html.matchAll(/href="([^"#]+)"/g)) {
      if (href.startsWith('/')) internalUrls.add(origin + href);
      else sourceUrls.add(href);
    }
    const prior = existing.articles.find(item => item.handle === article.handle);
    if (prior) assert.equal(prior.title, article.title, `Existing different article owns handle ${article.handle}`);
  }
  const evidence = [];
  for (const url of sourceUrls) {
    const response = await fetch(url);
    const body = await response.text();
    assert.equal(response.status, 200, `Primary source unavailable: ${url}`);
    assert(!/^\s*Access Denied/i.test(body), `Primary source blocked: ${url}`);
    evidence.push({ url, fetchedAt: new Date().toISOString(), status: response.status, body });
  }
  save('primary-sources.json', evidence);
  for (const url of internalUrls) {
    const response = await fetch(url);
    assert.equal(response.status, 200, `Internal article link failed: ${url}`);
  }
  save('article-plan.json', articles);
  console.log(`Checked ${evidence.length} primary sources and ${internalUrls.size} internal links. Backup: ${backup}`);
  if (!process.argv.includes('--publish')) { console.log('Read-only plan complete.'); return; }
  for (const article of articles) {
    const prior = existing.articles.find(item => item.handle === article.handle);
    const result = prior ? { article: prior } : await api(`blogs/${BLOG_ID}/articles.json`, 'POST', {
      article: {
        title: article.title, handle: article.handle, author: 'Base Note Editorial',
        body_html: article.body_html, summary_html: `<p>${article.summary}</p>`,
        tags: article.tags, published: true, template_suffix: '',
        metafields: [
          { namespace: 'global', key: 'title_tag', type: 'single_line_text_field', value: article.title },
          { namespace: 'global', key: 'description_tag', type: 'single_line_text_field', value: article.summary }
        ]
      }
    });
    save(`article-${result.article.id}-${prior ? 'retained' : 'created'}.json`, result);
    const readback = await api(`blogs/${BLOG_ID}/articles/${result.article.id}.json`);
    assert.equal(normalizeHtml(readback.article.body_html), normalizeHtml(article.body_html));
    assert.equal(readback.article.handle, article.handle);
    assert(readback.article.published_at, 'Article was not published');
    save(`article-${result.article.id}-verified.json`, readback);
    const url = `${origin}/blogs/hub/${article.handle}`;
    const live = await fetch(url);
    assert.equal(live.status, 200, `Published article is unavailable: ${url}`);
    const html = await live.text();
    assert(html.includes(article.title), 'Published title missing');
    assert(!/<meta[^>]+name="robots"[^>]+content="noindex/i.test(html), 'Article unexpectedly noindex');
    assert(html.includes(`href="${url}"`), 'Article canonical URL missing');
    console.log(`${prior ? 'Retained' : 'Published'} and verified ${result.article.id}: ${url}`);
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
