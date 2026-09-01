import type { DurableSubscriptionHistory } from "../pricing/pricing-policy.js";
import {
  asCustomerId,
  asIsoTimestamp,
  type CustomerId,
  type IsoTimestamp,
} from "../queue/types.js";

export type HistoricalBackfillRunId = string & { readonly __brand: "HistoricalBackfillRunId" };
export type HistoricalEvidenceRef = string & { readonly __brand: "HistoricalEvidenceRef" };
export type HistoricalBackfillApprovalRef = string & { readonly __brand: "HistoricalBackfillApprovalRef" };

export type HistoricalMemberSource = "APPSTLE_EXPORT" | "SHOPIFY_ORDER_EXPORT" | "MERCHANT_REVIEW";

/** A positive, immutable fact: this customer has previously subscribed. */
export interface DurableHistoricalSubscriptionRecord {
  readonly customerId: CustomerId;
  readonly evidenceRef: HistoricalEvidenceRef;
  readonly establishedAt: IsoTimestamp;
  readonly establishedByRunId: HistoricalBackfillRunId;
  readonly source: HistoricalMemberSource;
}

/** Input intentionally excludes names, email addresses, and raw export rows. */
export interface HistoricalMemberCandidate {
  readonly customerId: string;
  readonly evidenceRef: string;
  readonly firstObservedAt: string;
  readonly source: HistoricalMemberSource;
}

export interface HistoricalBackfillDryRunInput {
  readonly candidates: readonly HistoricalMemberCandidate[];
  readonly requestedAt: string;
  readonly runId: string;
}

export type HistoricalBackfillDisposition =
  | "WILL_RECORD_EVER_SUBSCRIBED"
  | "ALREADY_DURABLE"
  | "DUPLICATE_IN_INPUT";

export interface HistoricalBackfillDecision {
  readonly candidate: NormalizedHistoricalMemberCandidate;
  readonly disposition: HistoricalBackfillDisposition;
}

export interface HistoricalBackfillDryRun {
  readonly decisions: readonly HistoricalBackfillDecision[];
  readonly digest: string;
  readonly requestedAt: IsoTimestamp;
  readonly runId: HistoricalBackfillRunId;
  readonly status: "DRY_RUN_COMPLETE";
}

export interface HistoricalBackfillApproval {
  readonly approvedAt: string;
  /** Immutable merchant/change-management approval reference; never a boolean. */
  readonly approvalRef: string;
}

export interface NormalizedHistoricalMemberCandidate {
  readonly customerId: CustomerId;
  readonly evidenceRef: HistoricalEvidenceRef;
  readonly firstObservedAt: IsoTimestamp;
  readonly source: HistoricalMemberSource;
}

export type HistoricalBackfillAuditAction = "DRY_RUN_COMPLETED" | "EVER_SUBSCRIBED_RECORDED";

/** Append-only audit envelope. It does not contain raw exports or email addresses. */
export interface HistoricalBackfillAuditRecord {
  readonly action: HistoricalBackfillAuditAction;
  readonly approvalRef: HistoricalBackfillApprovalRef | null;
  readonly customerId: CustomerId | null;
  readonly digest: string;
  readonly occurredAt: IsoTimestamp;
  readonly runId: HistoricalBackfillRunId;
}

const RUN_ID = /^hbr_[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const EVIDENCE_REF = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,191}$/;
const APPROVAL_REF = /^hba_[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export function asHistoricalBackfillRunId(value: string): HistoricalBackfillRunId {
  if (!RUN_ID.test(value)) {
    throw new Error("runId must begin with hbr_ and contain 12-132 URL-safe characters.");
  }
  return value as HistoricalBackfillRunId;
}

export function asHistoricalEvidenceRef(value: string): HistoricalEvidenceRef {
  if (!EVIDENCE_REF.test(value) || value.includes("@")) {
    throw new Error("evidenceRef must be an opaque reference and must not contain an email address.");
  }
  return value as HistoricalEvidenceRef;
}

export function asHistoricalBackfillApprovalRef(value: string): HistoricalBackfillApprovalRef {
  if (!APPROVAL_REF.test(value)) {
    throw new Error("approvalRef must begin with hba_ and contain 12-132 URL-safe characters.");
  }
  return value as HistoricalBackfillApprovalRef;
}

export function normalizeHistoricalMemberCandidate(
  input: HistoricalMemberCandidate,
): NormalizedHistoricalMemberCandidate {
  if (!isHistoricalMemberSource(input.source)) {
    throw new Error("source must be APPSTLE_EXPORT, SHOPIFY_ORDER_EXPORT, or MERCHANT_REVIEW.");
  }
  return {
    customerId: asCustomerId(input.customerId),
    evidenceRef: asHistoricalEvidenceRef(input.evidenceRef),
    firstObservedAt: asIsoTimestamp(input.firstObservedAt),
    source: input.source,
  };
}

/**
 * A backfill can only add positive historic evidence. Absence of a record is
 * deliberately `unknown`, never proof that a customer qualifies as new.
 */
export function toPricingSubscriptionHistory(
  record: DurableHistoricalSubscriptionRecord | null,
): DurableSubscriptionHistory {
  return record ? "durably_ever_subscribed" : "unknown";
}

function isHistoricalMemberSource(value: string): value is HistoricalMemberSource {
  return ["APPSTLE_EXPORT", "SHOPIFY_ORDER_EXPORT", "MERCHANT_REVIEW"].includes(value);
}
