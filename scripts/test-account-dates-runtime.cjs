'use strict';

// Runtime guard for the account page's subscription dates.
//
// The static guard (test-jeff-account-source-of-truth.cjs) proves the guessing code is gone.
// This one runs the template's real <script> blocks in headless Chromium, with Appstle and the
// queue Worker mocked and the clock pinned, and checks that every date the customer can see
// agrees: the Next Shipment tile, the Next ship + charge card, Next charge on, Cancel before,
// Plan Details, and the "charges <date>" labels on the upcoming rows.
//
// Why it exists: on 2026-10-08 a subscriber's dashboard said "Oct 8" while My Subscription said
// "Next charge on November 8" (Clarity recording e99bf415, shared by Jeff). Two independent
// guesses disagreed and Appstle never corrected the dashboard card.
//
// Usage: NODE_PATH="$(npm root -g)" node scripts/test-account-dates-runtime.cjs \
//          [templates/customers/account.liquid] [assets/queue-scheduler.js]
// Exit 0 when every scenario agrees, 1 otherwise.

const fs = require('node:fs');
const { chromium } = require('playwright');

const TEMPLATE = process.argv[2] || 'templates/customers/account.liquid';
const QUEUE_JS = process.argv[3] || 'assets/queue-scheduler.js';
const ORIGIN = 'http://bn.test';
const NOW = '2026-10-08T10:30:00-05:00'; // when the recorded session happened (Chicago)
const CUSTOMER_ID = 7001;

// ── Liquid stubs ────────────────────────────────────────────────────────────
// Only the handful of Liquid expressions inside the two scripts matter for dates. Anything
// left unhandled fails loudly rather than silently becoming an empty string.

// Remove `{% if <startPattern> %}` … its matching `{% endif %}`, honouring nesting.
function stripBlock(text, startPattern) {
  const start = text.search(startPattern);
  if (start === -1) return text;
  const tagRe = /\{%-?\s*(if|unless|for|endif|endunless|endfor)\b[^%]*-?%\}/g;
  tagRe.lastIndex = start;
  let depth = 0;
  let m;
  while ((m = tagRe.exec(text))) {
    if (m[1] === 'if' || m[1] === 'unless' || m[1] === 'for') depth++;
    else depth--;
    if (depth === 0) return text.slice(0, start) + text.slice(m.index + m[0].length);
  }
  throw new Error('unbalanced Liquid block for ' + startPattern);
}

const LAST_ORDER = '2026-09-08T09:14:00-05:00';
const VALUES = {
  'is_subscriber | json': 'true',
  'is_subscriber | default: false | json': 'true',
  'latest_sub_order.created_at | json': JSON.stringify(LAST_ORDER),
  'latest_sub_order.name | json': '"#1042"',
  'latest_sub_order.fulfillment_status | json': '"fulfilled"',
  "latest_shipped_sub_order.created_at | date: '%Y-%m' | json": '"2026-09"',
  'latest_sub_item.product.title | json': '"Parfums de Marly Althair EDP"',
  'latest_sub_item.image | image_url: width: 200 | json': 'null',
  'latest_sub_item.product.vendor | json': '"Parfums de Marly"',
  "settings.appstle_portal_url | default: '/apps/subscriptions' | json": '"/apps/subscriptions"',
  'settings.fotm_enabled | default: false | json': 'false',
  'settings.fotm_month | json': 'null',
  'settings.fotm_display_name | json': 'null',
};

function stubScript(js) {
  js = stripBlock(js, /\{%-?\s*if fh_json/);
  js = stripBlock(js, /\{%-?\s*if settings\.fotm_product\s*-?%\}/);
  // pastOrders loop → this customer's four fulfilled subscription orders
  const loopAt = js.search(/\{%-?\s*if is_subscriber\s*-?%\}\s*\{%-?\s*for order in customer\.orders/);
  if (loopAt !== -1) {
    js = stripBlock(js, /\{%-?\s*if is_subscriber\s*-?%\}\s*\{%-?\s*for order in customer\.orders/);
    js = js.slice(0, loopAt) +
      ['2026-06', '2026-07', '2026-08', '2026-09']
        .map((m) => `pastOrders.push({ shipMonth: '${m}', title: 'Fragrance ${m}', image: null });`).join('\n') +
      js.slice(loopAt);
  }
  js = js.replace(/\{%-?\s*assign[^%]*-?%\}/g, '');
  js = js.replace(/\{%\s*if customer_tag_text contains 'staff'\s*%\}true\{%\s*else\s*%\}false\{%\s*endif\s*%\}/, 'false');
  js = js.replace(/\{%-?\s*(if latest_sub_order|if latest_sub_item|if latest_shipped_sub_order|endif)\s*-?%\}/g, '');
  js = js.replace(/\{\{-?\s*([^}]*?)\s*-?\}\}/g, (all, expr) => {
    if (!(expr in VALUES)) throw new Error('unstubbed Liquid output: ' + all);
    return VALUES[expr];
  });
  const left = js.match(/\{%[^%]*%\}|\{\{[^}]*\}\}/);
  if (left) throw new Error('unstubbed Liquid tag: ' + left[0]);
  return js;
}

// The page markup with Liquid crudely removed. Both branches of an if/else survive, which is
// fine here: the scripts only need the elements to exist.
function stubMarkup(html) {
  html = html.replace(/\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g, '');
  html = html.replace(/data-shipped-through="[^"]*"/, 'data-shipped-through="2026-09"');
  html = html.replace(/data-last-order-date="(?:[^"{]|\{[^}]*\})*"/, 'data-last-order-date="2026-09-08"');
  html = html.replace(/\{\{[\s\S]*?\}\}/g, '');
  html = html.replace(/\{%[\s\S]*?%\}/g, '');
  return html;
}

function buildPage(src) {
  const routerMark = src.indexOf('<!-- ═══ STANDALONE ROUTER');
  const markupEnd = src.indexOf('<script src="{{ \'sortable.min.js\'');
  if (routerMark === -1 || markupEnd === -1) throw new Error('template landmarks not found');
  // The router's own HTML comment contains the text "<script>", so start after the comment.
  const rOpen = src.indexOf('<script>', src.indexOf('-->', routerMark));
  const rClose = src.indexOf('</script>', rOpen);
  const bOpen = src.indexOf('<script>', rClose);
  const bClose = src.lastIndexOf('</script>');
  const router = stubScript(src.slice(rOpen + 8, rClose));
  const big = stubScript(src.slice(bOpen + 8, bClose));
  const subscriberData = {
    isSubscriber: true,
    billingDay: '8',
    priceLabel: '$20/mo',
    pastShipments: ['2026-09', '2026-08', '2026-07', '2026-06'].map((m, i) => ({
      orderName: '#10' + (42 - i), orderUrl: '/account/orders/' + i, orderTotal: '$22.05',
      shipMonth: m, shippedAt: m, title: 'Fragrance ' + m, image: null, handle: 'fragrance-' + i,
    })),
  };
  return '<!doctype html><html><head><meta charset="utf-8">' +
    '<script>window.bnCustomerId = ' + CUSTOMER_ID + ';</script>' +
    '<script src="/assets/queue-scheduler.js" defer></script></head><body>' +
    stubMarkup(src.slice(0, markupEnd)) +
    '<script type="application/json" id="bn-subscriber-data">' + JSON.stringify(subscriberData) + '</script>' +
    '<script>' + router + '</script><script>' + big + '</script></body></html>';
}

// ── Scenarios ───────────────────────────────────────────────────────────────
const CONTRACT = (iso) => [{ id: 1, subscriptionContractId: 555, status: 'ACTIVE', nextBillingDate: iso }];
const SCENARIOS = [
  { name: 'Appstle has no valid contract (the recorded customer)', contracts: [], appstleMs: 400, queueMs: 100, expect: null },
  { name: 'Appstle: next charge Nov 8, Appstle slower than queue', contracts: CONTRACT('2026-11-08T19:00:00Z'), appstleMs: 700, queueMs: 100, expect: 'Nov 8' },
  { name: 'Appstle: next charge Nov 8, queue slower than Appstle', contracts: CONTRACT('2026-11-08T19:00:00Z'), appstleMs: 50, queueMs: 900, expect: 'Nov 8' },
  { name: 'Appstle: renewal later today (Oct 8)', contracts: CONTRACT('2026-10-08T19:00:00Z'), appstleMs: 400, queueMs: 100, expect: 'Oct 8' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "November 7, 2026" / "Oct 8, 2026" / "Oct 8" → "Nov 7" style; null when no date present.
function shortDate(text) {
  const m = String(text || '').match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? (\d{1,2})\b/);
  return m ? m[1] + ' ' + Number(m[2]) : null;
}
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// "October 2026 · charges Oct 8" → sortable month key for the row's own month.
function rowKey(meta) {
  const m = meta.match(new RegExp('(' + FULL_MONTHS.join('|') + ') (\\d{4})'));
  return m ? Number(m[2]) * 12 + FULL_MONTHS.indexOf(m[1]) : -Infinity;
}
function dayAfter(short) {
  if (!short) return null;
  const [mon, d] = short.split(' ');
  const date = new Date(2026, MONTHS.indexOf(mon), Number(d) + 1);
  return MONTHS[date.getMonth()] + ' ' + date.getDate();
}

async function run(scenario, html, queueJs, browser) {
  const context = await browser.newContext({ timezoneId: 'America/Chicago', locale: 'en-US' });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(NOW));
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  page.on('dialog', (d) => d.dismiss());
  const later = (ms, body) => new Promise((r) => setTimeout(() => r(body), ms));
  await page.route(ORIGIN + '/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body, ms) => later(ms, body).then((b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) }));
    if (url.pathname === '/account') return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    if (url.pathname === '/assets/queue-scheduler.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: queueJs });
    if (url.pathname === '/apps/subscriptions/cp/api/logged-in-customer') return json(CUSTOMER_ID, scenario.appstleMs / 2);
    if (url.pathname === '/apps/subscriptions/cp/api/subscription-customers-detail/valid/' + CUSTOMER_ID) return json(scenario.contracts, scenario.appstleMs / 2);
    if (url.pathname === '/apps/basenote/queue') return json({ queue: [] }, scenario.queueMs);
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(ORIGIN + '/account#dashboard');
  await page.waitForTimeout(Math.max(scenario.appstleMs, scenario.queueMs) + 1200);
  const seen = await page.evaluate(() => {
    const text = (id) => { const el = document.getElementById(id); return el ? el.textContent.trim() : null; };
    const journey = document.getElementById('dashJourney');
    const q = (sel) => { const el = journey && journey.querySelector(sel); return el ? el.textContent.trim() : null; };
    return {
      tile: text('statNextShipment'),
      card: q('.dash-journey__next-date'),
      cardEyebrow: q('.dash-journey__next-eyebrow'),
      nextCharge: text('billingDateText'),
      cancelBefore: text('cancelDeadline'),
      planNextBilling: text('subNextBilling'),
      upcoming: journey ? Array.from(journey.querySelectorAll('.dash-journey__meta'))
        .map((e) => e.textContent.trim()).filter((t) => !/Shipped/.test(t)) : [],
    };
  });
  await context.close();

  const problems = [];
  const dates = {
    tile: shortDate(seen.tile),
    card: shortDate(seen.card),
    nextCharge: shortDate(seen.nextCharge),
    planNextBilling: shortDate(seen.planNextBilling),
    'cancelBefore+1': dayAfter(shortDate(seen.cancelBefore)),
  };
  for (const [where, value] of Object.entries(dates)) {
    if (value !== scenario.expect) problems.push(`${where} shows ${value || 'no date'} (${JSON.stringify(seen[where.replace('+1', '')])}), expected ${scenario.expect || 'no date'}`);
  }
  // An upcoming row may name a charge only on the confirmed renewal day, and never for a month
  // before the confirmed renewal month (nothing is charged then).
  const [expMon, expDay] = (scenario.expect || ' ').split(' ');
  const expKey = scenario.expect ? 2026 * 12 + MONTHS.indexOf(expMon) : null;
  for (const meta of seen.upcoming) {
    const charge = (meta.match(/charges (.*)$/) || [])[1];
    if (!charge) continue;
    if (!scenario.expect) { problems.push(`upcoming row "${meta}" names a charge date nothing has confirmed`); continue; }
    const day = shortDate(charge).split(' ')[1];
    if (day !== expDay) problems.push(`upcoming row "${meta}" charges on a different day than the confirmed ${scenario.expect}`);
    else if (rowKey(meta) < expKey) problems.push(`upcoming row "${meta}" claims a charge before the confirmed ${scenario.expect}`);
  }
  if (errors.length) problems.push('page errors: ' + errors.join(' | '));
  return { seen, problems };
}

(async () => {
  const html = buildPage(fs.readFileSync(TEMPLATE, 'utf8'));
  if (process.env.BN_DUMP) fs.writeFileSync(process.env.BN_DUMP, html); // debug: the page as served
  const queueJs = fs.readFileSync(QUEUE_JS, 'utf8');
  const browser = await chromium.launch();
  let failed = 0;
  for (const scenario of SCENARIOS) {
    const { seen, problems } = await run(scenario, html, queueJs, browser);
    console.log((problems.length ? 'FAIL ' : 'PASS ') + scenario.name);
    console.log('     tile=' + JSON.stringify(seen.tile) + ' card=' + JSON.stringify(seen.card) +
      ' nextCharge=' + JSON.stringify(seen.nextCharge) + ' cancelBefore=' + JSON.stringify(seen.cancelBefore) +
      ' plan=' + JSON.stringify(seen.planNextBilling));
    console.log('     upcoming=' + JSON.stringify(seen.upcoming.slice(0, 3)));
    problems.forEach((p) => console.log('     - ' + p));
    if (problems.length) failed++;
  }
  await browser.close();
  console.log(failed ? `\n${failed} of ${SCENARIOS.length} scenarios show dates that disagree.` : `\nAll ${SCENARIOS.length} scenarios agree.`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
