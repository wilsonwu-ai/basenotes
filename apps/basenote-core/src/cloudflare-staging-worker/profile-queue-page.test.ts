import assert from "node:assert/strict";
import test from "node:test";

import { renderProfileQueuePage } from "./profile-queue-page.js";
import { asStagingProfileQueueFormNonce } from "./form-nonce.js";
import {
  MEMBER_FRAGRANCE_CUTOFF_TIMEZONE,
  createEmptyProfileQueueCycle,
} from "../profile-queue/contracts.js";
import { publishProfileQueueFotm } from "../profile-queue/service.js";

const cutoff = "2026-09-10T05:01:00.000Z";
const baseCycle = publishProfileQueueFotm(
  createEmptyProfileQueueCycle({
    bindingId: "binding-profile-410",
    cycleKey: "staging:delivery:2026-09-15",
    shipMonth: "2026-09",
    updatedAt: "2026-09-01T09:00:00.000Z",
  }),
  {
    cutoffAt: cutoff,
    merchantTimezone: MEMBER_FRAGRANCE_CUTOFF_TIMEZONE,
    occurredAt: "2026-09-01T09:01:00.000Z",
    variantId: "gid://shopify/ProductVariant/901",
  },
);

test("pre-cutoff member view visibly defaults the included fragrance to FOTM while exposing an override", () => {
  const markup = renderPage("2026-09-09T05:00:00.000Z");
  assert.match(markup, /Included by default: Eligible test fragrance 1/);
  assert.match(markup, /pre-selected for this shipment/i);
  assert.match(markup, /Do nothing to keep it/i);
  assert.match(markup, /12:01 AM America\/Chicago time/);
  assert.match(markup, /Override included fragrance/);
  assert.match(markup, /name="action" value="SET_MEMBER_FRAGRANCE"/);
  assert.match(markup, /name="action" value="ADD_ADD_ON"/);
});

test("post-cutoff member view removes all mutation forms and states the locked result", () => {
  const markup = renderPage(cutoff);
  assert.match(markup, /Central Time choice window is closed/);
  assert.match(markup, /No included override was saved/i);
  assert.match(markup, /published Fragrance of the Month is the included default/i);
  assert.doesNotMatch(markup, /your included selection/i);
  assert.match(markup, /paid extras are locked/i);
  assert.doesNotMatch(markup, /<form\b/i);
  assert.doesNotMatch(markup, /name="action"/);
});

function renderPage(now: string): string {
  return renderProfileQueuePage({
    createIdempotencyKey: () => "pqk_page_test_001",
    cycle: baseCycle,
    formAction: "/apps/basenote-staging/profile-queue",
    formNonce: asStagingProfileQueueFormNonce("pqf_page_test_000000000000000000000000000001"),
    now,
    variants: [{ label: "Eligible test fragrance 1", variantId: "gid://shopify/ProductVariant/901" }],
  });
}
