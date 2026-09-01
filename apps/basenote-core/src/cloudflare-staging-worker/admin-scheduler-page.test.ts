import assert from "node:assert/strict";
import test from "node:test";

import { renderStagingAdminSchedulerShell } from "./admin-scheduler-page.js";

test("embedded scheduler shell exposes no protected data before a fresh Admin token API call", () => {
  const markup = renderStagingAdminSchedulerShell({
    apiPath: "/api/admin/fotm-schedules",
    clientId: "staging-client-id-123456",
  });

  assert.match(markup, /name="shopify-api-key" content="staging-client-id-123456"/);
  assert.match(markup, /shopify\.idToken\(\)/);
  assert.match(markup, /Authorization: "Bearer " \+ token/);
  assert.match(markup, /Retry pending request/);
  assert.match(markup, /original idempotency key and a fresh Shopify ID token/);
  assert.match(markup, /state\.pending = pending/);
  assert.match(markup, /Future FOTM scheduler/);
  assert.match(markup, /visibly pre-selected, one included fragrance/i);
  assert.match(markup, /not an add-on/i);
  assert.match(markup, /member may still save a separate override before the Central-time cutoff/i);
  assert.match(markup, /legacy theme FOTM is display-only/i);
  assert.match(markup, /Provision up to five cycles/);
  assert.match(markup, /Retire this month/);
  assert.match(markup, /explicit recovery draft/i);
  assert.match(markup, /Record no-mutation recovery exception/);
  assert.match(markup, /It was not retired or replaced/i);
  assert.match(markup, /provision_recovery_required/);
  assert.match(markup, /Mark pending provision needs attention/);
  assert.match(markup, /pendingProvisionCommands/);
  assert.match(markup, /state\.pendingProvisionCommands\.filter/);
  assert.match(markup, /15-minute recovery delay/);
  assert.match(markup, /will not retry, alter a schedule, or change a shipment/i);
  assert.doesNotMatch(markup, /SHOPIFY_ADMIN_CLIENT_SECRET/);
  assert.doesNotMatch(markup, /staging_admin_id_token_replays/);
  assert.doesNotMatch(markup, /person@example\.test/);
});
