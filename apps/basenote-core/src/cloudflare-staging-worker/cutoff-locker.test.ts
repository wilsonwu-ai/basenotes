import assert from "node:assert/strict";
import test from "node:test";

import {
  createProfileQueueSelectionEvidence,
  runStagingCutoffLock,
} from "./cutoff-locker.js";
import {
  MEMBER_FRAGRANCE_CUTOFF_TIMEZONE,
  asProfileQueueActorRef,
  createEmptyProfileQueueCycle,
  type ProfileQueueMutationAuditRecord,
} from "../profile-queue/contracts.js";
import { InMemoryProfileQueueRepository } from "../profile-queue/repository.js";
import { applyProfileQueueMutation, publishProfileQueueFotm } from "../profile-queue/service.js";

const createdAt = "2026-09-01T09:00:00.000Z";
const cutoff = "2026-09-10T05:01:00.000Z";

test("durable staging cutoff lock preserves a member override and falls back only when unselected", async () => {
  const repository = new InMemoryProfileQueueRepository();
  await seedCycle(repository, "binding-profile-301", "staging:delivery:2026-09-15", null);
  await seedCycle(
    repository,
    "binding-profile-302",
    "staging:delivery:2026-09-16",
    "gid://shopify/ProductVariant/777",
  );

  let serial = 0;
  const result = await runStagingCutoffLock({
    asOf: cutoff,
    createOpaqueId(prefix) {
      serial += 1;
      return `${prefix}_cutoff_lock_test_${serial.toString().padStart(3, "0")}`;
    },
    repository,
  });

  assert.deepEqual(result, { conflicted: 0, locked: 2, scanned: 2 });
  const fallback = await repository.findCycle("binding-profile-301", "staging:delivery:2026-09-15");
  const override = await repository.findCycle("binding-profile-302", "staging:delivery:2026-09-16");
  assert.equal(fallback?.memberChoice.source, "FOTM_FALLBACK");
  assert.equal(fallback?.memberChoice.variantId, "gid://shopify/ProductVariant/701");
  assert.equal(override?.memberChoice.source, "MEMBER_SELECTED");
  assert.equal(override?.memberChoice.variantId, "gid://shopify/ProductVariant/777");

  const retry = await runStagingCutoffLock({
    asOf: cutoff,
    createOpaqueId(prefix) { return `${prefix}_cutoff_lock_retry_001`; },
    repository,
  });
  assert.deepEqual(retry, { conflicted: 0, locked: 0, scanned: 0 });
});

async function seedCycle(
  repository: InMemoryProfileQueueRepository,
  bindingId: string,
  cycleKey: string,
  memberVariantId: string | null,
): Promise<void> {
  const suffix = bindingId.endsWith("301") ? "301" : "302";
  let cycle = createEmptyProfileQueueCycle({
    bindingId,
    cycleKey,
    shipMonth: "2026-09",
    updatedAt: createdAt,
  });
  await persist(repository, cycle, null, "CREATE_CYCLE", `pqm_seedcreate${suffix}`, `pqk_seedcreate${suffix}`, `pqe_seedcreate${suffix}`);
  cycle = publishProfileQueueFotm(cycle, {
    cutoffAt: cutoff,
    merchantTimezone: MEMBER_FRAGRANCE_CUTOFF_TIMEZONE,
    occurredAt: "2026-09-01T09:01:00.000Z",
    variantId: "gid://shopify/ProductVariant/701",
  });
  await persist(repository, cycle, 0, "PUBLISH_FOTM", `pqm_seedpublish${suffix}`, `pqk_seedpublish${suffix}`, `pqe_seedpublish${suffix}`);
  if (memberVariantId !== null) {
    const selected = applyProfileQueueMutation(cycle, {
      expectedRevision: cycle.revision,
      mutation: { kind: "SET_MEMBER_FRAGRANCE", variantId: memberVariantId },
      occurredAt: "2026-09-01T09:02:00.000Z",
    });
    await persist(repository, selected, cycle.revision, "SET_MEMBER_FRAGRANCE", `pqm_seedchoice${suffix}`, `pqk_seedchoice${suffix}`, `pqe_seedchoice${suffix}`);
  }
}

async function persist(
  repository: InMemoryProfileQueueRepository,
  cycle: ReturnType<typeof createEmptyProfileQueueCycle>,
  expectedRevision: number | null,
  mutationKind: ProfileQueueMutationAuditRecord["mutationKind"],
  mutationId: string,
  idempotencyKey: string,
  evidenceId: string,
): Promise<void> {
  const audit: ProfileQueueMutationAuditRecord = {
    actorRef: asProfileQueueActorRef("system_seed_operator"),
    bindingId: cycle.bindingId,
    cycleKey: cycle.cycleKey,
    expectedRevision,
    idempotencyKey: idempotencyKey as ProfileQueueMutationAuditRecord["idempotencyKey"],
    mutationId: mutationId as ProfileQueueMutationAuditRecord["mutationId"],
    mutationKind,
    occurredAt: cycle.updatedAt,
    resultingRevision: cycle.revision,
  };
  await repository.persist({
    audit,
    cycle,
    expectedRevision,
    selectionEvidence: createProfileQueueSelectionEvidence({ audit, cycle, evidenceId }),
  });
}
