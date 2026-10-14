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

console.log('Jeff account source-of-truth guard passed: no guessed renewal date or previous-order next shipment.');
