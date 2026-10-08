'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('templates/customers/account.liquid', 'utf8');

// Jeff reported the account showing the prior order as the next shipment and
// different dates from Appstle. Previous-order/local-storage guesses must stay
// out of the rendered next-shipment and billing paths.
assert.match(source, /window\.__bnLiveNextShipDate/);
assert.match(source, /window\.__bnLiveNextFragrance/);
assert.match(source, /Next shipment<\/div>.*Waiting for the subscription portal/s);
assert.match(source, /return null;\n  }\n\n  function renderBillingCountdown/);
assert.doesNotMatch(source, /localStorage\.getItem\('bn_active_subscription'\)/);
assert.doesNotMatch(source, /new Date\(lastOrderDateStr \+ 'T00:00:00'\)/);
assert.match(source, /active\.nextOrderDate/);

// Oct 8 2026 (Clarity e99bf415): the card must repaint once Appstle answers. The fetch runs in
// the big script, renderDashJourney in the router closure, so they meet through an event.
assert.match(source, /document\.dispatchEvent\(new Event\('bn:appstle-synced'\)\)/);
assert.match(source, /document\.addEventListener\('bn:appstle-synced', renderDashJourney\)/);
assert.doesNotMatch(source, /typeof renderDashJourney === 'function'/);
// Upcoming rows' "charges <date>" come from the live date, not the last order's day.
assert.doesNotMatch(source, /subData\.billingDay/);

console.log('Jeff account source-of-truth guard passed: no guessed renewal date or previous-order next shipment.');
