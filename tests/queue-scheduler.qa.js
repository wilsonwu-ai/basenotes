// QA harness: load the REAL queue-scheduler.js and exercise firstVisibleMonth()
// across the scenarios that matter for Option A. Mocks window/localStorage/Date.
const path = require('path');
const QS_PATH = path.resolve(__dirname, '../assets/queue-scheduler.js');

const RealDate = Date;
function setNow(iso) {
  const fixedMs = RealDate.parse(iso);
  class FakeDate extends RealDate {
    constructor(...args) { if (args.length === 0) super(fixedMs); else super(...args); }
    static now() { return fixedMs; }
  }
  global.Date = FakeDate;
}

function freshQueue(nowIso) {
  setNow(nowIso);
  const store = {};
  global.window = { addEventListener: () => {}, removeEventListener: () => {} };
  global.document = { addEventListener: () => {}, removeEventListener: () => {}, hidden: false, visibilityState: 'visible' };
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  global.window.localStorage = global.localStorage;
  delete require.cache[QS_PATH];
  require(QS_PATH); // runs IIFE, sets global.window.BasenoteQueue
  return global.window.BasenoteQueue;
}

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + label + ' | got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want));
  ok ? pass++ : fail++;
}

// 1. OPTION A WORKING: mid-month, this cycle's order was PLACED this month.
//    account.liquid now feeds shippedThrough = latest_sub_order month = "2026-07".
{
  const BQ = freshQueue('2026-07-08T12:00:00');
  BQ.setShippedThrough('2026-07');
  check('1. order placed this month -> first editable rolls to NEXT month', BQ.firstVisibleMonth(), '2026-08');
  check('1b. slotsFromNow(3) starts next month', BQ.slotsFromNow(3), ['2026-08','2026-09','2026-10']);
}

// 2. PRE-FIX PAIN: mid-month, NO shippedThrough (old fulfilled-only path when
//    fulfillment lags/absent). View stuck on current month until calendar buffer.
{
  const BQ = freshQueue('2026-07-08T12:00:00');
  // no setShippedThrough call (latest_shipped_sub_order was empty)
  check('2. no shipped-through, mid-month -> STUCK on current month (Jeff\'s bug)', BQ.firstVisibleMonth(), '2026-07');
}

// 3. OLD-ONLY TRIGGER: near month end (2 days left < 3), no shippedThrough ->
//    the 3-day calendar buffer is the ONLY thing that rolls it.
{
  const BQ = freshQueue('2026-07-30T12:00:00');
  check('3. no shipped-through, <3 days left -> calendar buffer rolls to next', BQ.firstVisibleMonth(), '2026-08');
}

// 4. BOUNDARY CAVEAT (documented in PR): renewal charged Jun 30 for the Jul
//    shipment -> latest_sub_order.created_at month = "2026-06". now = Jul 2.
//    shippedThrough "2026-06" < cur "2026-07" -> returns "2026-07" (shows the
//    just-charged month as still editable = off by one).
{
  const BQ = freshQueue('2026-07-02T12:00:00');
  BQ.setShippedThrough('2026-06');
  check('4. month-end charge caveat -> off-by-one (shows just-charged month)', BQ.firstVisibleMonth(), '2026-07');
}

// 5. REGRESSION GUARD: setShippedThrough is idempotent / no throw on repeat
//    (guards the May-12 RangeError loop noted in code).
{
  const BQ = freshQueue('2026-07-08T12:00:00');
  BQ.setShippedThrough('2026-07');
  BQ.setShippedThrough('2026-07'); // second call must be a no-op, not a loop
  check('5. repeat setShippedThrough is a no-op (no loop)', BQ.firstVisibleMonth(), '2026-08');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
