import {
  FUTURE_ADD_ON_UNIT_PRICE_CENTS,
  MAX_FUTURE_ADD_ONS_PER_CYCLE,
  MEMBER_FRAGRANCE_CUTOFF_TIMEZONE,
  asProfileQueueAddOnId,
  assertMemberFragranceCutoff,
  assertProfileQueueCycleInvariant,
  assertProfileQueueRevision,
  type ProfileQueueAddOn,
  type ProfileQueueMemberFragranceChoice,
  type ProfileQueueCustomerMutation,
  type ProfileQueueCycle,
} from "./contracts.js";
import {
  asIsoTimestamp,
  compareIsoTimestamps,
  type IsoTimestamp,
} from "../queue/types.js";
import { asProductVariantId } from "../domain/ids.js";

export class ProfileQueueCapacityError extends Error {
  override name = "ProfileQueueCapacityError";
}

export class ProfileQueueRevisionConflictError extends Error {
  override name = "ProfileQueueRevisionConflictError";
}

export class ProfileQueueLockedError extends Error {
  override name = "ProfileQueueLockedError";
}

export class ProfileQueueCutoffError extends Error {
  override name = "ProfileQueueCutoffError";
}

export class ProfileQueueAddOnNotFoundError extends Error {
  override name = "ProfileQueueAddOnNotFoundError";
}

export interface ApplyProfileQueueMutationInput {
  readonly expectedRevision: number;
  readonly mutation: ProfileQueueCustomerMutation;
  /** Server-controlled clock value, never a browser-provided timestamp. */
  readonly occurredAt: string;
}

export interface PublishProfileQueueFotmInput {
  readonly cutoffAt: string;
  readonly merchantTimezone: string;
  /** Merchant/server-controlled action timestamp. */
  readonly occurredAt: string;
  readonly variantId: string;
}

/**
 * Applies a customer queue change to one already-authorized future shipment.
 * It does not check catalog availability, calculate checkout pricing, or call
 * a subscription provider; those remain server-side integration gates.
 */
export function applyProfileQueueMutation(
  cycle: ProfileQueueCycle,
  input: ApplyProfileQueueMutationInput,
): ProfileQueueCycle {
  assertProfileQueueCycleInvariant(cycle);
  assertProfileQueueRevision(input.expectedRevision);
  const occurredAt = asIsoTimestamp(input.occurredAt);
  assertCustomerWritable(cycle, input.expectedRevision, occurredAt);

  const memberChoice = applyMutationToMemberChoice(cycle.memberChoice, input.mutation, occurredAt);
  const addOns = applyMutationToAddOns(cycle.addOns, input.mutation, occurredAt);
  return nextCycle(cycle, addOns, cycle.fotm, memberChoice, occurredAt);
}

/**
 * Merchant-only FOTM publication. The customer API contract has no matching
 * action, so a profile cannot select or rewrite its automatic FOTM base item.
 */
export function publishProfileQueueFotm(
  cycle: ProfileQueueCycle,
  input: PublishProfileQueueFotmInput,
): ProfileQueueCycle {
  assertProfileQueueCycleInvariant(cycle);
  if (cycle.state !== "OPEN") {
    throw new ProfileQueueLockedError("FOTM cannot be published for a non-open delivery cycle.");
  }
  if (cycle.fotm.status !== "UNPUBLISHED") {
    throw new ProfileQueueLockedError("A published FOTM cannot be silently replaced.");
  }

  const occurredAt = asIsoTimestamp(input.occurredAt);
  const cutoffAt = assertMemberFragranceCutoff(input.cutoffAt, input.merchantTimezone);
  if (compareIsoTimestamps(occurredAt, cutoffAt) >= 0) {
    throw new ProfileQueueCutoffError("FOTM must be published before its configured cutoff.");
  }

  return nextCycle(
    cycle,
    cycle.addOns,
    {
      cutoffAt,
      merchantTimezone: MEMBER_FRAGRANCE_CUTOFF_TIMEZONE,
      status: "PUBLISHED",
      variantId: asProductVariantId(input.variantId),
    },
    cycle.memberChoice,
    occurredAt,
  );
}

/**
 * Locks a published FOTM at its cutoff. It returns durable intent only: a
 * future outbox/adapter must still make and read back any Shopify change.
 */
export function resolveProfileQueueAtCutoff(
  cycle: ProfileQueueCycle,
  occurredAt: string,
): ProfileQueueCycle {
  assertProfileQueueCycleInvariant(cycle);
  const now = asIsoTimestamp(occurredAt);
  if (cycle.state !== "OPEN") {
    throw new ProfileQueueLockedError("Only an open delivery cycle can resolve at its cutoff.");
  }
  if (
    cycle.fotm.status !== "PUBLISHED"
    || cycle.fotm.variantId === null
    || cycle.fotm.cutoffAt === null
  ) {
    throw new ProfileQueueLockedError("A delivery cycle cannot resolve without a published FOTM.");
  }
  if (compareIsoTimestamps(now, cycle.fotm.cutoffAt) < 0) {
    throw new ProfileQueueCutoffError("A delivery cycle cannot resolve before its FOTM cutoff.");
  }

  const resolved: ProfileQueueCycle = {
    ...cycle,
    fotm: { ...cycle.fotm, status: "RESOLVED" },
    memberChoice: cycle.memberChoice.source === "MEMBER_SELECTED"
      ? { ...cycle.memberChoice }
      : {
          selectedAt: now,
          source: "FOTM_FALLBACK",
          variantId: cycle.fotm.variantId,
        },
    revision: incrementRevision(cycle.revision),
    state: "LOCKED",
    updatedAt: now,
  };
  assertProfileQueueCycleInvariant(resolved);
  return cloneCycle(resolved);
}

function assertCustomerWritable(
  cycle: ProfileQueueCycle,
  expectedRevision: number,
  occurredAt: IsoTimestamp,
): void {
  if (cycle.revision !== expectedRevision) {
    throw new ProfileQueueRevisionConflictError("The profile queue changed; reload before saving.");
  }
  if (cycle.state !== "OPEN") {
    throw new ProfileQueueLockedError("Only an open future delivery cycle may be edited.");
  }
  if (cycle.fotm.cutoffAt !== null && compareIsoTimestamps(occurredAt, cycle.fotm.cutoffAt) >= 0) {
    throw new ProfileQueueCutoffError("The future delivery cycle is past its merchant cutoff.");
  }
}

function applyMutationToAddOns(
  current: readonly ProfileQueueAddOn[],
  mutation: ProfileQueueCustomerMutation,
  occurredAt: IsoTimestamp,
): ProfileQueueAddOn[] {
  switch (mutation.kind) {
    case "SET_MEMBER_FRAGRANCE":
    case "CLEAR_MEMBER_FRAGRANCE":
      return current.map(cloneAddOn);
    case "ADD_ADD_ON": {
      if (current.length >= MAX_FUTURE_ADD_ONS_PER_CYCLE) {
        throw new ProfileQueueCapacityError(
          `A future shipment may have at most ${MAX_FUTURE_ADD_ONS_PER_CYCLE} $18 add-ons.`,
        );
      }
      const id = asProfileQueueAddOnId(mutation.addOnId);
      if (current.some((addOn) => addOn.id === id)) {
        throw new Error("A queue add-on ID cannot be reused in the same delivery cycle.");
      }
      return [
        ...current.map(cloneAddOn),
        {
          createdAt: occurredAt,
          id,
          position: current.length + 1,
          unitPriceCents: FUTURE_ADD_ON_UNIT_PRICE_CENTS,
          updatedAt: occurredAt,
          variantId: asProductVariantId(mutation.variantId),
        },
      ];
    }
    case "CHANGE_ADD_ON": {
      const id = asProfileQueueAddOnId(mutation.addOnId);
      let found = false;
      const next = current.map((addOn) => {
        if (addOn.id !== id) return cloneAddOn(addOn);
        found = true;
        return { ...addOn, updatedAt: occurredAt, variantId: asProductVariantId(mutation.variantId) };
      });
      if (!found) throw new ProfileQueueAddOnNotFoundError("The requested future add-on was not found.");
      return next;
    }
    case "REMOVE_ADD_ON": {
      const id = asProfileQueueAddOnId(mutation.addOnId);
      const withoutTarget = current.filter((addOn) => addOn.id !== id).map(cloneAddOn);
      if (withoutTarget.length === current.length) {
        throw new ProfileQueueAddOnNotFoundError("The requested future add-on was not found.");
      }
      return withoutTarget.map((addOn, index) => ({ ...addOn, position: index + 1, updatedAt: occurredAt }));
    }
  }
}

function applyMutationToMemberChoice(
  current: ProfileQueueMemberFragranceChoice,
  mutation: ProfileQueueCustomerMutation,
  occurredAt: IsoTimestamp,
): ProfileQueueMemberFragranceChoice {
  switch (mutation.kind) {
    case "SET_MEMBER_FRAGRANCE":
      return {
        selectedAt: occurredAt,
        source: "MEMBER_SELECTED",
        variantId: asProductVariantId(mutation.variantId),
      };
    case "CLEAR_MEMBER_FRAGRANCE":
      return { selectedAt: null, source: "UNSELECTED", variantId: null };
    case "ADD_ADD_ON":
    case "CHANGE_ADD_ON":
    case "REMOVE_ADD_ON":
      return { ...current };
  }
}

function nextCycle(
  current: ProfileQueueCycle,
  addOns: readonly ProfileQueueAddOn[],
  fotm: ProfileQueueCycle["fotm"],
  memberChoice: ProfileQueueMemberFragranceChoice,
  updatedAt: IsoTimestamp,
): ProfileQueueCycle {
  const next: ProfileQueueCycle = {
    ...current,
    addOns: addOns.map(cloneAddOn),
    fotm: { ...fotm },
    memberChoice: { ...memberChoice },
    revision: incrementRevision(current.revision),
    updatedAt,
  };
  assertProfileQueueCycleInvariant(next);
  return cloneCycle(next);
}

function incrementRevision(revision: number): number {
  if (revision >= Number.MAX_SAFE_INTEGER) {
    throw new Error("Profile queue revision overflow; manual remediation is required.");
  }
  return revision + 1;
}

export function cloneCycle(cycle: ProfileQueueCycle): ProfileQueueCycle {
  return {
    ...cycle,
    addOns: cycle.addOns.map(cloneAddOn),
    fotm: { ...cycle.fotm },
    memberChoice: { ...cycle.memberChoice },
  };
}

function cloneAddOn(addOn: ProfileQueueAddOn): ProfileQueueAddOn {
  return { ...addOn };
}
