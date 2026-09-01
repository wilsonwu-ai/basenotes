import {
  asHistoricalBackfillApprovalRef,
  asHistoricalBackfillRunId,
  asHistoricalEvidenceRef,
  type DurableHistoricalSubscriptionRecord,
  type HistoricalBackfillApproval,
  type HistoricalBackfillAuditRecord,
  type HistoricalMemberSource,
} from "./contracts.js";
import type {
  HistoricalSubscriptionHistoryRepository,
  HistoricalSubscriptionHistoryRunFinalizer,
  HistoricalSubscriptionHistoryWriteResult,
} from "./backfill-importer.js";
import { asCustomerId, asIsoTimestamp, type CustomerId } from "../queue/types.js";
import type { D1DatabasePort } from "../staging-runtime/d1.js";

interface HistoryRow {
  readonly customer_id: string;
  readonly established_at: string;
  readonly established_by_run_id: string;
  readonly evidence_ref: string;
  readonly source: string;
}

export class DurableHistoricalBackfillConflictError extends Error {
  override name = "DurableHistoricalBackfillConflictError";
}

export interface D1HistoricalSubscriptionHistoryRepositoryOptions {
  /** Injectable solely for deterministic offline tests. Never derived from a customer. */
  readonly createAuditId?: () => string;
}

/**
 * D1 implementation for positive historical-subscription facts. It accepts no
 * CSV, email, provider credential, network client, or delete/update of a
 * history record. The only mutable run field is its terminal `APPLIED` marker.
 */
export class D1HistoricalSubscriptionHistoryRepository
  implements HistoricalSubscriptionHistoryRepository, HistoricalSubscriptionHistoryRunFinalizer {
  private readonly createAuditId: () => string;

  constructor(
    private readonly database: D1DatabasePort,
    options: D1HistoricalSubscriptionHistoryRepositoryOptions = {},
  ) {
    this.createAuditId = options.createAuditId ?? (() => `hbaudit_${crypto.randomUUID().replaceAll("-", "")}`);
  }

  async appendAudit(record: HistoricalBackfillAuditRecord): Promise<void> {
    if (record.action !== "DRY_RUN_COMPLETED" || record.customerId !== null || record.approvalRef !== null) {
      throw new DurableHistoricalBackfillConflictError("Only a clean dry-run audit may open a durable backfill run.");
    }
    const auditId = this.nextAuditId();
    const results = await this.database.batch([
      this.database.prepare(`
        INSERT INTO historical_subscription_backfill_runs (
          run_id, digest, requested_at, status, approval_ref, approved_at
        ) VALUES (?, ?, ?, 'DRY_RUN_COMPLETE', NULL, NULL)`)
        .bind(record.runId, record.digest, record.occurredAt),
      this.database.prepare(`
        INSERT INTO historical_subscription_backfill_audit (
          audit_id, run_id, action, customer_id, approval_ref, digest, occurred_at
        ) VALUES (?, ?, 'DRY_RUN_COMPLETED', NULL, NULL, ?, ?)`)
        .bind(auditId, record.runId, record.digest, record.occurredAt),
    ]);
    if (results[0]?.meta?.changes !== 1 || results[1]?.meta?.changes !== 1) {
      throw new DurableHistoricalBackfillConflictError("The durable backfill dry run already exists or could not be audited.");
    }
  }

  async findEverSubscribed(customerId: CustomerId): Promise<DurableHistoricalSubscriptionRecord | null> {
    const normalizedCustomerId = asCustomerId(customerId);
    const row = await this.database.prepare(`
      SELECT customer_id, established_at, established_by_run_id, evidence_ref, source
      FROM historical_subscription_history
      WHERE customer_id = ?`)
      .bind(normalizedCustomerId)
      .first<HistoryRow>();
    return row ? mapHistoryRow(row) : null;
  }

  async recordEverSubscribedWithAudit(input: {
    readonly audit: HistoricalBackfillAuditRecord;
    readonly record: DurableHistoricalSubscriptionRecord;
  }): Promise<HistoricalSubscriptionHistoryWriteResult> {
    if (
      input.audit.action !== "EVER_SUBSCRIBED_RECORDED"
      || input.audit.customerId !== input.record.customerId
      || input.audit.approvalRef === null
      || input.record.establishedByRunId !== input.audit.runId
    ) {
      throw new DurableHistoricalBackfillConflictError("A durable history fact must match its approved audit envelope.");
    }
    const auditId = this.nextAuditId();
    const results = await this.database.batch([
      this.database.prepare(`
        INSERT OR IGNORE INTO historical_subscription_history (
          customer_id, established_at, established_by_run_id, evidence_ref, source, recorded_at
        ) SELECT ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM historical_subscription_backfill_runs
          WHERE run_id = ? AND digest = ? AND status = 'DRY_RUN_COMPLETE'
        )`)
        .bind(
          input.record.customerId,
          input.record.establishedAt,
          input.record.establishedByRunId,
          input.record.evidenceRef,
          input.record.source,
          input.audit.occurredAt,
          input.audit.runId,
          input.audit.digest,
        ),
      this.database.prepare(`
        INSERT INTO historical_subscription_backfill_audit (
          audit_id, run_id, action, customer_id, approval_ref, digest, occurred_at
        ) SELECT ?, ?, 'EVER_SUBSCRIBED_RECORDED', ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM historical_subscription_history
          WHERE customer_id = ?
            AND established_by_run_id = ?
            AND evidence_ref = ?
        )
          AND NOT EXISTS (
            SELECT 1 FROM historical_subscription_backfill_audit
            WHERE run_id = ?
              AND action = 'EVER_SUBSCRIBED_RECORDED'
              AND customer_id = ?
          )`)
        .bind(
          auditId,
          input.audit.runId,
          input.record.customerId,
          input.audit.approvalRef,
          input.audit.digest,
          input.audit.occurredAt,
          input.record.customerId,
          input.record.establishedByRunId,
          input.record.evidenceRef,
          input.audit.runId,
          input.record.customerId,
        ),
    ]);
    const stored = await this.findEverSubscribed(input.record.customerId);
    if (!stored) {
      throw new DurableHistoricalBackfillConflictError("The approved historic-subscription fact was not retained.");
    }
    return { newlyRecorded: results[0]?.meta?.changes === 1, record: stored };
  }

  async markRunApplied(input: {
    readonly approval: HistoricalBackfillApproval;
    readonly digest: string;
    readonly runId: string;
  }): Promise<void> {
    const runId = asHistoricalBackfillRunId(input.runId);
    const approvalRef = asHistoricalBackfillApprovalRef(input.approval.approvalRef);
    const approvedAt = asIsoTimestamp(input.approval.approvedAt);
    const result = await this.database.prepare(`
      UPDATE historical_subscription_backfill_runs
      SET status = 'APPLIED', approval_ref = ?, approved_at = ?
      WHERE run_id = ?
        AND digest = ?
        AND status = 'DRY_RUN_COMPLETE'
        AND requested_at <= ?`)
      .bind(approvalRef, approvedAt, runId, input.digest, approvedAt)
      .run();
    if (result.meta?.changes !== 1) {
      throw new DurableHistoricalBackfillConflictError("The durable backfill run cannot be marked applied.");
    }
  }

  private nextAuditId(): string {
    const value = this.createAuditId();
    if (!/^hbaudit_[A-Za-z0-9]{16,128}$/.test(value)) {
      throw new Error("The durable backfill audit identifier must be a high-entropy opaque hbaudit_ value.");
    }
    return value;
  }
}

function mapHistoryRow(row: HistoryRow): DurableHistoricalSubscriptionRecord {
  return {
    customerId: asCustomerId(row.customer_id),
    establishedAt: asIsoTimestamp(row.established_at),
    establishedByRunId: asHistoricalBackfillRunId(row.established_by_run_id),
    evidenceRef: asHistoricalEvidenceRef(row.evidence_ref),
    source: asHistoricalMemberSource(row.source),
  };
}

function asHistoricalMemberSource(value: string): HistoricalMemberSource {
  if (value === "APPSTLE_EXPORT" || value === "SHOPIFY_ORDER_EXPORT" || value === "MERCHANT_REVIEW") {
    return value;
  }
  throw new DurableHistoricalBackfillConflictError("The durable history row has an unsupported source.");
}
