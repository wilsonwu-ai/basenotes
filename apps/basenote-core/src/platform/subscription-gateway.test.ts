import assert from "node:assert/strict";
import test from "node:test";

import { asSubscriptionContractId } from "../domain/ids.js";
import { assertBaseNoteContractOwnership } from "./subscription-gateway.js";

const contractId = asSubscriptionContractId("gid://shopify/SubscriptionContract/101");

test("Base Note gateway refuses contracts owned by another subscription app", () => {
  assert.throws(
    () =>
      assertBaseNoteContractOwnership(
        { appId: "appstle", id: contractId, status: "ACTIVE" },
        "basenote-core",
      ),
    /not owned by Base Note Core/,
  );
});

test("Base Note gateway permits an explicitly Base Note-owned contract", () => {
  assert.doesNotThrow(() =>
    assertBaseNoteContractOwnership(
      { appId: "basenote-core", id: contractId, status: "ACTIVE" },
      "basenote-core",
    ),
  );
});
