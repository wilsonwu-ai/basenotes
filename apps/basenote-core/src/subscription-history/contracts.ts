import type { DurableSubscriptionHistory } from "../pricing/pricing-policy.js";
import {
  asCustomerId,
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

/**
 * These identifiers deliberately cannot carry a human-entered name, phone
 * number, email address, CSV row label, or ticket title. A caller creates an
 * opaque random identifier outside this service; it must not derive the value
 * from a raw export field.
 */
const RUN_ID = /^hbr_[0-9a-f]{32}$/;
const APPROVAL_REF = /^hba_[0-9a-f]{32}$/;
const EVIDENCE_REF_BY_SOURCE: Readonly<Record<HistoricalMemberSource, RegExp>> = {
  APPSTLE_EXPORT: /^appstle\/sha256\/[0-9a-f]{64}$/,
  SHOPIFY_ORDER_EXPORT: /^shopify-order\/sha256\/[0-9a-f]{64}$/,
  MERCHANT_REVIEW: /^merchant-review\/sha256\/[0-9a-f]{64}$/,
};
const HISTORICAL_INPUT_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export function asHistoricalBackfillRunId(value: string): HistoricalBackfillRunId {
  if (!RUN_ID.test(value)) {
    throw new Error("runId must be an opaque hbr_ identifier followed by 32 lowercase hexadecimal characters.");
  }
  return value as HistoricalBackfillRunId;
}

/**
 * Evidence is a source-qualified SHA-256 surrogate, never a raw export cell.
 * Hash raw exports before calling this boundary and retain the linking data in
 * the separately controlled source system, not D1.
 */
export function asHistoricalEvidenceRef(
  value: string,
  source: HistoricalMemberSource,
): HistoricalEvidenceRef {
  const sourcePattern = EVIDENCE_REF_BY_SOURCE[source];
  if (!sourcePattern || !sourcePattern.test(value)) {
    throw new Error(
      "evidenceRef must be a source-qualified SHA-256 surrogate; raw export values are not permitted.",
    );
  }
  return value as HistoricalEvidenceRef;
}

export function asHistoricalBackfillApprovalRef(value: string): HistoricalBackfillApprovalRef {
  if (!APPROVAL_REF.test(value)) {
    throw new Error("approvalRef must be an opaque hba_ identifier followed by 32 lowercase hexadecimal characters.");
  }
  return value as HistoricalBackfillApprovalRef;
}

/**
 * Accept only UTC ISO input at second or millisecond precision and normalize
 * it to canonical millisecond precision. All historical durable values and
 * the reviewed digest use this representation, so SQLite string comparisons
 * and JavaScript comparisons agree.
 */
export function canonicalizeHistoricalTimestamp(value: string): IsoTimestamp {
  if (!HISTORICAL_INPUT_TIMESTAMP.test(value)) {
    throw new Error("historical timestamp must be a valid UTC ISO-8601 value with second or millisecond precision.");
  }
  const expected = value.length === 20 ? value.slice(0, -1) + ".000Z" : value;
  const canonical = new Date(value).toISOString();
  if (canonical !== expected) {
    throw new Error("historical timestamp must name a real UTC instant.");
  }
  return canonical as IsoTimestamp;
}

/** Reject a D1 value unless it was already persisted canonically. */
export function assertCanonicalHistoricalTimestamp(value: string): IsoTimestamp {
  const canonical = canonicalizeHistoricalTimestamp(value);
  if (canonical !== value) {
    throw new Error("durable historical timestamp must use canonical millisecond ISO-8601 precision.");
  }
  return canonical;
}

export function normalizeHistoricalMemberCandidate(
  input: HistoricalMemberCandidate,
): NormalizedHistoricalMemberCandidate {
  if (!isHistoricalMemberSource(input.source)) {
    throw new Error("source must be APPSTLE_EXPORT, SHOPIFY_ORDER_EXPORT, or MERCHANT_REVIEW.");
  }
  return {
    customerId: asCustomerId(input.customerId),
    evidenceRef: asHistoricalEvidenceRef(input.evidenceRef, input.source),
    firstObservedAt: canonicalizeHistoricalTimestamp(input.firstObservedAt),
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
