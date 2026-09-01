import { createHash } from "node:crypto";

import {
  asHistoricalBackfillApprovalRef,
  asHistoricalBackfillRunId,
  normalizeHistoricalMemberCandidate,
  type DurableHistoricalSubscriptionRecord,
  type HistoricalBackfillApproval,
  type HistoricalBackfillAuditRecord,
  type HistoricalBackfillDecision,
  type HistoricalBackfillDryRun,
  type HistoricalBackfillDryRunInput,
  type HistoricalBackfillRunId,
  type NormalizedHistoricalMemberCandidate,
} from "./contracts.js";
import { asIsoTimestamp, type CustomerId, type IsoTimestamp } from "../queue/types.js";

export class HistoricalBackfillRunConflictError extends Error {
  override name = "HistoricalBackfillRunConflictError";
}

export class HistoricalBackfillApprovalError extends Error {
  override name = "HistoricalBackfillApprovalError";
}

/**
 * Durable boundary for historic-subscription evidence. There is deliberately
 * no update/delete operation: cancellation or a source export correction may
 * require a separate reviewed remediation process, never a silent downgrade.
 */
export interface HistoricalSubscriptionHistoryRepository {
  appendAudit(record: HistoricalBackfillAuditRecord): Promise<void>;
  findEverSubscribed(customerId: CustomerId): Promise<DurableHistoricalSubscriptionRecord | null>;
  /** Must atomically append a newly established fact and its matching audit. */
  recordEverSubscribedWithAudit(input: {
    readonly audit: HistoricalBackfillAuditRecord;
    readonly record: DurableHistoricalSubscriptionRecord;
  }): Promise<HistoricalSubscriptionHistoryWriteResult>;
}

export interface HistoricalSubscriptionHistoryWriteResult {
  readonly newlyRecorded: boolean;
  readonly record: DurableHistoricalSubscriptionRecord;
}

/**
 * In-memory test helper only. It proves pure decision semantics but does not
 * retain approvals or plans across a process restart. Any durable staging
 * path must use D1DurableHistoricalBackfillService instead.
 *
 * It has no CSV reader, provider credential, data export, or network client.
 */
export class HistoricalMemberBackfillImporter {
  private readonly plans = new Map<HistoricalBackfillRunId, HistoricalBackfillDryRun>();
  private readonly appliedRuns = new Set<HistoricalBackfillRunId>();

  constructor(private readonly repository: HistoricalSubscriptionHistoryRepository) {}

  async createDryRun(input: HistoricalBackfillDryRunInput): Promise<HistoricalBackfillDryRun> {
    const runId = asHistoricalBackfillRunId(input.runId);
    if (this.plans.has(runId)) {
      throw new HistoricalBackfillRunConflictError("A historical backfill run ID may be planned only once.");
    }
    const requestedAt = asIsoTimestamp(input.requestedAt);
    const normalized = input.candidates.map(normalizeHistoricalMemberCandidate);
    const decisions = await this.planDecisions(normalized);
    const dryRun: HistoricalBackfillDryRun = {
      decisions,
      digest: digestHistoricalBackfillDecisions(runId, requestedAt, decisions),
      requestedAt,
      runId,
      status: "DRY_RUN_COMPLETE",
    };
    await this.repository.appendAudit({
      action: "DRY_RUN_COMPLETED",
      approvalRef: null,
      customerId: null,
      digest: dryRun.digest,
      occurredAt: requestedAt,
      runId,
    });
    this.plans.set(runId, cloneDryRun(dryRun));
    return cloneDryRun(dryRun);
  }

  /**
   * Applies only the immutable, positive records identified by a prior dry
   * run. It never changes a durable record back to "never subscribed".
   */
  async applyReviewedDryRun(
    runIdValue: string,
    approval: HistoricalBackfillApproval,
  ): Promise<readonly DurableHistoricalSubscriptionRecord[]> {
    const runId = asHistoricalBackfillRunId(runIdValue);
    const dryRun = this.plans.get(runId);
    if (!dryRun) {
      throw new HistoricalBackfillApprovalError("A historical backfill must start with a retained dry run.");
    }
    if (this.appliedRuns.has(runId)) {
      throw new HistoricalBackfillRunConflictError("A historical backfill run may be applied only once.");
    }
    const approvalRef = asHistoricalBackfillApprovalRef(approval.approvalRef);
    const approvedAt = asIsoTimestamp(approval.approvedAt);
    if (approvedAt < dryRun.requestedAt) {
      throw new HistoricalBackfillApprovalError("Backfill approval cannot predate its dry run.");
    }

    const persisted: DurableHistoricalSubscriptionRecord[] = [];
    for (const decision of dryRun.decisions) {
      if (decision.disposition !== "WILL_RECORD_EVER_SUBSCRIBED") continue;
      const result = await this.repository.recordEverSubscribedWithAudit({
        audit: {
          action: "EVER_SUBSCRIBED_RECORDED",
          approvalRef,
          customerId: decision.candidate.customerId,
          digest: dryRun.digest,
          occurredAt: approvedAt,
          runId,
        },
        record: {
          customerId: decision.candidate.customerId,
          evidenceRef: decision.candidate.evidenceRef,
          establishedAt: decision.candidate.firstObservedAt,
          establishedByRunId: runId,
          source: decision.candidate.source,
        },
      });
      persisted.push(cloneHistory(result.record));
    }
    this.appliedRuns.add(runId);
    return persisted;
  }

  private async planDecisions(
    candidates: readonly NormalizedHistoricalMemberCandidate[],
  ): Promise<HistoricalBackfillDecision[]> {
    const decisions: HistoricalBackfillDecision[] = [];
    const seenCustomers = new Set<CustomerId>();
    for (const candidate of candidates) {
      if (seenCustomers.has(candidate.customerId)) {
        decisions.push({ candidate, disposition: "DUPLICATE_IN_INPUT" });
        continue;
      }
      seenCustomers.add(candidate.customerId);
      const existing = await this.repository.findEverSubscribed(candidate.customerId);
      decisions.push({
        candidate,
        disposition: existing ? "ALREADY_DURABLE" : "WILL_RECORD_EVER_SUBSCRIBED",
      });
    }
    return decisions;
  }
}

/** Local-only in-memory repository used to prove import invariants in tests. */
export class InMemoryHistoricalSubscriptionHistoryRepository
  implements HistoricalSubscriptionHistoryRepository {
  private readonly audit: HistoricalBackfillAuditRecord[] = [];
  private readonly records = new Map<CustomerId, DurableHistoricalSubscriptionRecord>();

  async appendAudit(record: HistoricalBackfillAuditRecord): Promise<void> {
    this.audit.push({ ...record });
  }

  async findEverSubscribed(customerId: CustomerId): Promise<DurableHistoricalSubscriptionRecord | null> {
    const record = this.records.get(customerId);
    return record ? cloneHistory(record) : null;
  }

  async recordEverSubscribed(
    record: DurableHistoricalSubscriptionRecord,
  ): Promise<DurableHistoricalSubscriptionRecord> {
    const existing = this.records.get(record.customerId);
    if (existing) return cloneHistory(existing);
    const stored = cloneHistory(record);
    this.records.set(stored.customerId, stored);
    return cloneHistory(stored);
  }

  async recordEverSubscribedWithAudit(input: {
    readonly audit: HistoricalBackfillAuditRecord;
    readonly record: DurableHistoricalSubscriptionRecord;
  }): Promise<HistoricalSubscriptionHistoryWriteResult> {
    const existing = this.records.get(input.record.customerId);
    if (existing) return { newlyRecorded: false, record: cloneHistory(existing) };
    const stored = cloneHistory(input.record);
    this.records.set(stored.customerId, stored);
    this.audit.push({ ...input.audit });
    return { newlyRecorded: true, record: cloneHistory(stored) };
  }

  listAudit(): readonly HistoricalBackfillAuditRecord[] {
    return this.audit.map((record) => ({ ...record }));
  }
}

/** Shared canonical digest used by both local and durable backfill planners. */
export function digestHistoricalBackfillDecisions(
  runId: HistoricalBackfillRunId,
  requestedAt: IsoTimestamp,
  decisions: readonly HistoricalBackfillDecision[],
): string {
  const canonical = decisions.map((decision) => ({
    customerId: decision.candidate.customerId,
    disposition: decision.disposition,
    evidenceRef: decision.candidate.evidenceRef,
    firstObservedAt: decision.candidate.firstObservedAt,
    source: decision.candidate.source,
  }));
  return createHash("sha256")
    .update("basenote.historical-subscription-backfill.v1\u0000")
    .update(JSON.stringify({ canonical, requestedAt, runId }))
    .digest("hex");
}

function cloneDryRun(value: HistoricalBackfillDryRun): HistoricalBackfillDryRun {
  return {
    ...value,
    decisions: value.decisions.map((decision) => ({
      ...decision,
      candidate: { ...decision.candidate },
    })),
  };
}

function cloneHistory(value: DurableHistoricalSubscriptionRecord): DurableHistoricalSubscriptionRecord {
  return { ...value };
}
