import {
  asHistoricalBackfillApprovalRef,
  asHistoricalBackfillRunId,
  asHistoricalEvidenceRef,
  assertCanonicalHistoricalTimestamp,
  canonicalizeHistoricalTimestamp,
  normalizeHistoricalMemberCandidate,
  type DurableHistoricalSubscriptionRecord,
  type HistoricalBackfillApproval,
  type HistoricalBackfillDecision,
  type HistoricalBackfillDisposition,
  type HistoricalBackfillDryRun,
  type HistoricalBackfillDryRunInput,
  type HistoricalBackfillRunId,
  type HistoricalMemberSource,
  type NormalizedHistoricalMemberCandidate,
} from "./contracts.js";
import { digestHistoricalBackfillDecisions } from "./backfill-importer.js";
import { asCustomerId, type CustomerId, type IsoTimestamp } from "../queue/types.js";
import type { D1DatabasePort, D1PreparedStatement, D1Result } from "../staging-runtime/d1.js";

/**
 * Apply uses 3 statements per candidate plus 3 transition statements. Keeping
 * this at 14 limits its one D1 batch to 45 statements, below the Worker Free
 * 50-subrequest budget even under a conservative accounting model.
 */
export const MAX_DRY_RUN_CANDIDATES = 14;
const MAX_APPLY_BATCH_STATEMENTS = 45;
const DIGEST = /^[0-9a-f]{64}$/;
const FACT_AUDIT_ID = /^hbaudit_[0-9a-f]{32}$/;
const LIFECYCLE_AUDIT_ID = /^hblcaudit_[0-9a-f]{32}$/;

export type DurableHistoricalBackfillApplyState =
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "APPLYING"
  | "APPLIED"
  | "NEEDS_REVIEW";

export interface DurableHistoricalBackfillRun {
  readonly approvalRef: string | null;
  readonly approvedAt: IsoTimestamp | null;
  readonly applyStartedAt: IsoTimestamp | null;
  readonly applyState: DurableHistoricalBackfillApplyState;
  readonly digest: string;
  readonly finalizedAt: IsoTimestamp | null;
  readonly lifecycleAuditId: string | null;
  /** Legacy rows that lacked a retained manifest are permanently non-runnable. */
  readonly legacyQuarantined: boolean;
  readonly legacyQuarantineReason: "NO_IMMUTABLE_PLAN" | null;
  readonly requestedAt: IsoTimestamp;
  readonly runId: HistoricalBackfillRunId;
  readonly status: "DRY_RUN_COMPLETE" | "APPLIED";
}

export interface DurableHistoricalBackfillApprovalInput {
  readonly approval: HistoricalBackfillApproval;
  readonly runId: string;
}

export interface DurableHistoricalBackfillApplyInput {
  readonly appliedAt: string;
  readonly runId: string;
}

export interface DurableHistoricalBackfillApplyResult {
  readonly conflictCount: number;
  readonly newlyRecordedCount: number;
  readonly run: DurableHistoricalBackfillRun;
}

export interface DurableHistoricalBackfillConflict {
  /** Null only when a quarantined legacy row blocks safe automatic recording. */
  readonly competingRunId: HistoricalBackfillRunId | null;
  readonly customerId: CustomerId;
  readonly detectedAt: IsoTimestamp;
  readonly reason:
    | "ALREADY_RECORDED_BY_ANOTHER_RUN"
    | "LEGACY_EVIDENCE_REQUIRES_REVIEW";
}

export class DurableHistoricalBackfillConflictError extends Error {
  override name = "DurableHistoricalBackfillConflictError";
}

export class DurableHistoricalBackfillPersistenceError extends Error {
  override name = "DurableHistoricalBackfillPersistenceError";
}

export interface D1DurableHistoricalBackfillServiceOptions {
  readonly createFactAuditId?: () => string;
  readonly createLifecycleAuditId?: () => string;
}

interface HistoryRow {
  readonly customer_id: string;
  readonly established_at: string;
  readonly established_by_run_id: string;
  readonly evidence_ref: string;
  readonly source: string;
}

interface PlanRow {
  readonly customer_id: string;
  readonly decision_ordinal: number;
  readonly disposition: string;
  readonly evidence_ref: string;
  readonly first_observed_at: string;
  readonly source: string;
}

interface RunRow {
  readonly approval_ref: string | null;
  readonly approved_at: string | null;
  readonly apply_started_at: string | null;
  readonly apply_state: string;
  readonly digest: string;
  readonly finalized_at: string | null;
  readonly lifecycle_audit_id: string | null;
  readonly legacy_quarantined: number;
  readonly legacy_quarantine_reason: string | null;
  readonly requested_at: string;
  readonly run_id: string;
  readonly status: string;
}

interface ConflictRow {
  readonly competing_run_id: string | null;
  readonly customer_id: string;
  readonly detected_at: string;
  readonly reason: string;
}

interface PlannedDecision {
  readonly candidate: NormalizedHistoricalMemberCandidate;
  readonly disposition: HistoricalBackfillDisposition;
  readonly ordinal: number;
}

/**
 * Staging-only durable historical backfill service. It has no CSV reader,
 * provider credential, email address, export client, deploy command, or
 * production database binding. A caller must provide a separately approved D1
 * binding and invoke only dry-run, approval, then apply.
 *
 * Each phase is one D1 batch. Apply first records conflicts, then writes facts
 * only when no retained candidate conflicts. A quarantined legacy row is not
 * trusted as durable evidence, but because it occupies the immutable customer
 * key it must terminalize the run as an auditable NEEDS_REVIEW rather than
 * causing a failed batch or a silent overwrite. A run therefore ends APPLIED
 * with every planned fact, or NEEDS_REVIEW with no new partial facts.
 */
export class D1DurableHistoricalBackfillService {
  private readonly createFactAuditId: () => string;
  private readonly createLifecycleAuditId: () => string;
  private readonly issuedFactAuditIds = new Set<string>();
  private readonly issuedLifecycleAuditIds = new Set<string>();

  constructor(
    private readonly database: D1DatabasePort,
    options: D1DurableHistoricalBackfillServiceOptions = {},
  ) {
    this.createFactAuditId = options.createFactAuditId
      ?? (() => "hbaudit_" + crypto.randomUUID().replaceAll("-", ""));
    this.createLifecycleAuditId = options.createLifecycleAuditId
      ?? (() => "hblcaudit_" + crypto.randomUUID().replaceAll("-", ""));
  }

  /**
   * All candidates are normalized before the first D1 read. Thus malformed or
   * email-shaped values never reach a SQL binding.
   */
  async createDryRun(input: HistoricalBackfillDryRunInput): Promise<HistoricalBackfillDryRun> {
    const runId = asHistoricalBackfillRunId(input.runId);
    const requestedAt = canonicalizeHistoricalTimestamp(input.requestedAt);
    if (input.candidates.length > MAX_DRY_RUN_CANDIDATES) {
      throw new Error(
        "A durable historical dry run may contain at most " + MAX_DRY_RUN_CANDIDATES + " candidates.",
      );
    }
    const normalizedCandidates = input.candidates.map(normalizeHistoricalMemberCandidate);
    const decisions = await this.planDecisions(normalizedCandidates);
    const digest = digestHistoricalBackfillDecisions(runId, requestedAt, decisions);
    const factAuditId = this.nextFactAuditId();
    const statements: D1PreparedStatement[] = [
      this.database.prepare(sql([
        "INSERT INTO historical_subscription_backfill_runs (",
        "  run_id, digest, requested_at, status, approval_ref, approved_at,",
        "  apply_state, apply_started_at, finalized_at, lifecycle_audit_id",
        ") VALUES (?, ?, ?, 'DRY_RUN_COMPLETE', NULL, NULL, 'PENDING_APPROVAL', NULL, NULL, NULL)",
      ])).bind(runId, digest, requestedAt),
      this.database.prepare(sql([
        "INSERT INTO historical_subscription_backfill_audit (",
        "  audit_id, run_id, action, customer_id, approval_ref, digest, occurred_at",
        ") VALUES (?, ?, 'DRY_RUN_COMPLETED', NULL, NULL, ?, ?)",
      ])).bind(factAuditId, runId, digest, requestedAt),
      ...decisions.map((decision, ordinal) => this.database.prepare(sql([
        "INSERT INTO historical_subscription_backfill_plan (",
        "  run_id, decision_ordinal, customer_id, evidence_ref, first_observed_at, source, disposition",
        ") VALUES (?, ?, ?, ?, ?, ?, ?)",
      ])).bind(
        runId,
        ordinal,
        decision.candidate.customerId,
        decision.candidate.evidenceRef,
        decision.candidate.firstObservedAt,
        decision.candidate.source,
        decision.disposition,
      )),
    ];
    try {
      const results = await this.database.batch(statements);
      assertChanged(results[0], "The durable dry-run record was not created.");
      assertChanged(results[1], "The durable dry-run audit was not created.");
      for (let index = 0; index < decisions.length; index += 1) {
        assertChanged(results[index + 2], "The durable dry-run manifest was not fully retained.");
      }
    } catch (error) {
      throw asDurableConflict(error, "The durable dry run already exists or could not be retained.");
    }
    return cloneDryRun({ decisions, digest, requestedAt, runId, status: "DRY_RUN_COMPLETE" });
  }

  /**
   * Binds one non-boolean approval reference to the immutable retained digest.
   * The lifecycle trigger rejects later alteration or replacement.
   */
  async approveDryRun(input: DurableHistoricalBackfillApprovalInput): Promise<DurableHistoricalBackfillRun> {
    const runId = asHistoricalBackfillRunId(input.runId);
    const approvalRef = asHistoricalBackfillApprovalRef(input.approval.approvalRef);
    const approvedAt = canonicalizeHistoricalTimestamp(input.approval.approvedAt);
    const run = await this.requireRun(runId);
    if (run.legacyQuarantined) {
      throw new DurableHistoricalBackfillConflictError(
        "This legacy backfill run is quarantined because it has no immutable reviewed plan.",
      );
    }
    if (run.applyState !== "PENDING_APPROVAL" || run.status !== "DRY_RUN_COMPLETE") {
      throw new DurableHistoricalBackfillConflictError("Only an unapproved durable dry run may be approved.");
    }
    assertAtOrAfter(approvedAt, run.requestedAt, "Backfill approval cannot predate its dry run.");
    const lifecycleAuditId = this.nextLifecycleAuditId();
    try {
      const results = await this.database.batch([
        this.database.prepare(sql([
          "UPDATE historical_subscription_backfill_runs",
          "SET approval_ref = ?, approved_at = ?, apply_state = 'APPROVED', lifecycle_audit_id = ?",
          "WHERE run_id = ? AND digest = ? AND status = 'DRY_RUN_COMPLETE'",
          "  AND apply_state = 'PENDING_APPROVAL' AND approval_ref IS NULL",
        ])).bind(approvalRef, approvedAt, lifecycleAuditId, runId, run.digest),
      ]);
      assertChanged(results[0], "The durable dry run could not transition to approved.");
    } catch (error) {
      throw asDurableConflict(error, "The durable dry run could not be approved.");
    }
    return this.requireRun(runId);
  }

  /**
   * Applies a retained approved plan atomically. Conflict rows are written
   * first. If any candidate already has a durable fact from another run, or a
   * quarantined legacy row blocks safe recording, all new fact inserts are
   * withheld and the run terminalizes as NEEDS_REVIEW.
   */
  async applyApprovedDryRun(input: DurableHistoricalBackfillApplyInput): Promise<DurableHistoricalBackfillApplyResult> {
    const runId = asHistoricalBackfillRunId(input.runId);
    const appliedAt = canonicalizeHistoricalTimestamp(input.appliedAt);
    const run = await this.requireRun(runId);
    if (run.legacyQuarantined) {
      throw new DurableHistoricalBackfillConflictError(
        "This legacy backfill run is quarantined because it has no immutable reviewed plan.",
      );
    }
    if (
      run.applyState !== "APPROVED"
      || run.status !== "DRY_RUN_COMPLETE"
      || run.approvalRef === null
      || run.approvedAt === null
    ) {
      throw new DurableHistoricalBackfillConflictError("Only one durable approved dry run may be applied.");
    }
    assertAtOrAfter(appliedAt, run.approvedAt, "A durable apply cannot predate its approval.");

    const planned = await this.readPlan(run);
    const retainedDigest = digestHistoricalBackfillDecisions(
      run.runId,
      run.requestedAt,
      planned.map(({ candidate, disposition }) => ({ candidate, disposition })),
    );
    if (retainedDigest !== run.digest) {
      throw new DurableHistoricalBackfillPersistenceError("The retained durable plan does not match its reviewed digest.");
    }

    const willRecord = planned.filter((decision) => decision.disposition === "WILL_RECORD_EVER_SUBSCRIBED");
    const applyingAuditId = this.nextLifecycleAuditId();
    const needsReviewAuditId = this.nextLifecycleAuditId();
    const appliedAuditId = this.nextLifecycleAuditId();
    const factAuditIds = willRecord.map(() => this.nextFactAuditId());
    const statements: D1PreparedStatement[] = [
      this.database.prepare(sql([
        "UPDATE historical_subscription_backfill_runs",
        "SET apply_state = 'APPLYING', apply_started_at = ?, lifecycle_audit_id = ?",
        "WHERE run_id = ? AND digest = ? AND status = 'DRY_RUN_COMPLETE'",
        "  AND apply_state = 'APPROVED' AND approval_ref = ? AND approved_at <= ?",
      ])).bind(
        appliedAt,
        applyingAuditId,
        run.runId,
        run.digest,
        run.approvalRef,
        appliedAt,
      ),
    ];

    for (const decision of willRecord) {
      statements.push(bindConflictDetection(this.database, run, decision, appliedAt));
    }
    for (let index = 0; index < willRecord.length; index += 1) {
      const decision = willRecord[index];
      const factAuditId = factAuditIds[index];
      if (!decision || !factAuditId) {
        throw new DurableHistoricalBackfillPersistenceError("The durable apply plan could not allocate opaque audit IDs.");
      }
      statements.push(bindHistoryInsert(this.database, run, decision, appliedAt));
      statements.push(bindFactAuditInsert(this.database, run, decision, factAuditId, appliedAt));
    }
    statements.push(
      bindNeedsReviewTransition(this.database, run, needsReviewAuditId, appliedAt),
      bindAppliedTransition(this.database, run, appliedAuditId, appliedAt),
    );
    if (statements.length > MAX_APPLY_BATCH_STATEMENTS) {
      throw new DurableHistoricalBackfillPersistenceError("The durable apply exceeded its Worker-safe D1 batch cap.");
    }

    let results: readonly D1Result[];
    try {
      results = await this.database.batch(statements);
    } catch (error) {
      throw asDurableConflict(error, "The durable apply transaction was rejected; no partial batch was retained.");
    }
    assertChanged(results[0], "The durable run could not transition to applying.");

    const conflictsStart = 1;
    const factsStart = conflictsStart + willRecord.length;
    const terminalStart = factsStart + (willRecord.length * 2);
    const needsReviewTransition = results[terminalStart];
    const appliedTransition = results[terminalStart + 1];
    const needsReview = changed(needsReviewTransition);
    const applied = changed(appliedTransition);

    if (needsReview && !changed(appliedTransition)) {
      const finalized = await this.requireRun(runId);
      const conflicts = await this.listConflicts(runId);
      if (finalized.applyState !== "NEEDS_REVIEW" || conflicts.length === 0) {
        throw new DurableHistoricalBackfillPersistenceError("A conflict apply did not retain an auditable terminal state.");
      }
      return { conflictCount: conflicts.length, newlyRecordedCount: 0, run: finalized };
    }
    if (applied && !changed(needsReviewTransition)) {
      const finalized = await this.requireRun(runId);
      if (finalized.applyState !== "APPLIED" || finalized.status !== "APPLIED") {
        throw new DurableHistoricalBackfillPersistenceError("The durable apply did not retain its terminal state.");
      }
      const newlyRecordedCount = willRecord.reduce((count, _decision, index) => {
        const historyResult = results[factsStart + (index * 2)];
        return count + (changed(historyResult) ? 1 : 0);
      }, 0);
      return { conflictCount: 0, newlyRecordedCount, run: finalized };
    }
    throw new DurableHistoricalBackfillPersistenceError(
      "The durable apply did not reach one auditable terminal state; investigate the retained staging run.",
    );
  }

  async findRun(runIdValue: string): Promise<DurableHistoricalBackfillRun | null> {
    const runId = asHistoricalBackfillRunId(runIdValue);
    const row = await this.database.prepare(sql([
      "SELECT run_id, digest, requested_at, status, approval_ref, approved_at,",
      "  apply_state, apply_started_at, finalized_at, lifecycle_audit_id,",
      "  legacy_quarantined, legacy_quarantine_reason",
      "FROM historical_subscription_backfill_runs",
      "WHERE run_id = ?",
    ])).bind(runId).first<RunRow>();
    return row ? mapRunRow(row) : null;
  }

  async listConflicts(runIdValue: string): Promise<readonly DurableHistoricalBackfillConflict[]> {
    const runId = asHistoricalBackfillRunId(runIdValue);
    const result = await this.database.prepare(sql([
      "SELECT customer_id, competing_run_id, reason, detected_at",
      "FROM historical_subscription_backfill_apply_conflicts",
      "WHERE run_id = ?",
      "ORDER BY customer_id ASC",
    ])).bind(runId).all<ConflictRow>();
    return (result.results ?? []).map(mapConflictRow);
  }

  private async requireRun(runId: HistoricalBackfillRunId): Promise<DurableHistoricalBackfillRun> {
    const run = await this.findRun(runId);
    if (!run) throw new DurableHistoricalBackfillConflictError("The durable historical backfill run was not found.");
    return run;
  }

  private async planDecisions(
    candidates: readonly NormalizedHistoricalMemberCandidate[],
  ): Promise<HistoricalBackfillDecision[]> {
    const customerIds = [...new Set(candidates.map((candidate) => candidate.customerId))];
    const durableByCustomer = await this.findEverSubscribedByCustomerIds(customerIds);
    const decisions: HistoricalBackfillDecision[] = [];
    const seenCustomers = new Set<CustomerId>();
    for (const candidate of candidates) {
      if (seenCustomers.has(candidate.customerId)) {
        decisions.push({ candidate, disposition: "DUPLICATE_IN_INPUT" });
        continue;
      }
      seenCustomers.add(candidate.customerId);
      const existing = durableByCustomer.get(candidate.customerId);
      decisions.push({
        candidate,
        disposition: existing ? "ALREADY_DURABLE" : "WILL_RECORD_EVER_SUBSCRIBED",
      });
    }
    return decisions;
  }

  /** One bounded D1 lookup for the entire dry run; never one subrequest per row. */
  private async findEverSubscribedByCustomerIds(
    customerIds: readonly CustomerId[],
  ): Promise<ReadonlyMap<CustomerId, DurableHistoricalSubscriptionRecord>> {
    if (customerIds.length === 0) return new Map();
    if (customerIds.length > MAX_DRY_RUN_CANDIDATES) {
      throw new DurableHistoricalBackfillPersistenceError("The durable dry-run lookup exceeded its Worker-safe cap.");
    }
    const placeholders = customerIds.map(() => "?").join(", ");
    const result = await this.database.prepare(sql([
      "SELECT customer_id, established_at, established_by_run_id, evidence_ref, source",
      "FROM historical_subscription_history",
      "WHERE legacy_quarantined = 0",
      "  AND customer_id IN (" + placeholders + ")",
    ])).bind(...customerIds).all<HistoryRow>();
    const durableByCustomer = new Map<CustomerId, DurableHistoricalSubscriptionRecord>();
    for (const row of result.results ?? []) {
      const record = mapHistoryRow(row);
      if (durableByCustomer.has(record.customerId)) {
        throw new DurableHistoricalBackfillPersistenceError("The durable history contains duplicate customer evidence.");
      }
      durableByCustomer.set(record.customerId, record);
    }
    return durableByCustomer;
  }

  private async readPlan(run: DurableHistoricalBackfillRun): Promise<readonly PlannedDecision[]> {
    const result = await this.database.prepare(sql([
      "SELECT decision_ordinal, customer_id, evidence_ref, first_observed_at, source, disposition",
      "FROM historical_subscription_backfill_plan",
      "WHERE run_id = ?",
      "ORDER BY decision_ordinal ASC",
    ])).bind(run.runId).all<PlanRow>();
    return (result.results ?? []).map((row, index) => {
      if (!Number.isInteger(row.decision_ordinal) || row.decision_ordinal !== index) {
        throw new DurableHistoricalBackfillPersistenceError("The retained durable manifest has an invalid ordinal.");
      }
      try {
        const candidate = normalizeHistoricalMemberCandidate({
          customerId: row.customer_id,
          evidenceRef: row.evidence_ref,
          firstObservedAt: row.first_observed_at,
          source: asHistoricalMemberSource(row.source),
        });
        if (candidate.firstObservedAt !== row.first_observed_at) {
          throw new Error("Retained historical plan timestamp is not canonical.");
        }
        return {
          candidate,
          disposition: asHistoricalBackfillDisposition(row.disposition),
          ordinal: row.decision_ordinal,
        };
      } catch {
        throw new DurableHistoricalBackfillPersistenceError("The retained durable manifest contains malformed data.");
      }
    });
  }

  private nextFactAuditId(): string {
    const value = this.createFactAuditId();
    if (!FACT_AUDIT_ID.test(value)) {
      throw new Error("The durable fact-audit identifier must be an opaque hbaudit_ value.");
    }
    if (this.issuedFactAuditIds.has(value)) {
      throw new Error("The durable fact-audit identifier must be unique within one backfill service instance.");
    }
    this.issuedFactAuditIds.add(value);
    return value;
  }

  private nextLifecycleAuditId(): string {
    const value = this.createLifecycleAuditId();
    if (!LIFECYCLE_AUDIT_ID.test(value)) {
      throw new Error("The durable lifecycle-audit identifier must be an opaque hblcaudit_ value.");
    }
    if (this.issuedLifecycleAuditIds.has(value)) {
      throw new Error("The durable lifecycle-audit identifier must be unique within one backfill service instance.");
    }
    this.issuedLifecycleAuditIds.add(value);
    return value;
  }
}

function sql(lines: readonly string[]): string {
  return lines.join("\n");
}

function bindConflictDetection(
  database: D1DatabasePort,
  run: DurableHistoricalBackfillRun,
  decision: PlannedDecision,
  appliedAt: IsoTimestamp,
): D1PreparedStatement {
  return database.prepare(sql([
    "INSERT INTO historical_subscription_backfill_apply_conflicts (",
    "  run_id, customer_id, competing_run_id, reason, detected_at",
    ")",
    "SELECT ?, ?,",
    "  CASE WHEN history.legacy_quarantined = 1 THEN NULL ELSE history.established_by_run_id END,",
    "  CASE WHEN history.legacy_quarantined = 1 THEN 'LEGACY_EVIDENCE_REQUIRES_REVIEW' ELSE 'ALREADY_RECORDED_BY_ANOTHER_RUN' END,",
    "  ?",
    "FROM historical_subscription_history AS history",
    "JOIN historical_subscription_backfill_plan AS plan",
    "  ON plan.customer_id = history.customer_id",
    "JOIN historical_subscription_backfill_runs AS current_run",
    "  ON current_run.run_id = plan.run_id",
    "WHERE current_run.run_id = ?",
    "  AND current_run.digest = ?",
    "  AND current_run.status = 'DRY_RUN_COMPLETE'",
    "  AND current_run.apply_state = 'APPLYING'",
    "  AND plan.decision_ordinal = ?",
    "  AND plan.disposition = 'WILL_RECORD_EVER_SUBSCRIBED'",
    "  AND plan.customer_id = ?",
    "  AND (history.legacy_quarantined = 1 OR history.established_by_run_id <> current_run.run_id)",
    "  AND NOT EXISTS (",
    "    SELECT 1",
    "    FROM historical_subscription_backfill_apply_conflicts AS existing",
    "    WHERE existing.run_id = current_run.run_id AND existing.customer_id = plan.customer_id",
    "  )",
  ])).bind(
    run.runId,
    decision.candidate.customerId,
    appliedAt,
    run.runId,
    run.digest,
    decision.ordinal,
    decision.candidate.customerId,
  );
}

function bindHistoryInsert(
  database: D1DatabasePort,
  run: DurableHistoricalBackfillRun,
  decision: PlannedDecision,
  appliedAt: IsoTimestamp,
): D1PreparedStatement {
  return database.prepare(sql([
    "INSERT INTO historical_subscription_history (",
    "  customer_id, established_at, established_by_run_id, evidence_ref, source, recorded_at",
    ")",
    "SELECT ?, ?, ?, ?, ?, ?",
    "WHERE EXISTS (",
    "  SELECT 1",
    "  FROM historical_subscription_backfill_runs AS current_run",
    "  JOIN historical_subscription_backfill_plan AS plan",
    "    ON plan.run_id = current_run.run_id",
    "  WHERE current_run.run_id = ?",
    "    AND current_run.digest = ?",
    "    AND current_run.status = 'DRY_RUN_COMPLETE'",
    "    AND current_run.apply_state = 'APPLYING'",
    "    AND current_run.approval_ref = ?",
    "    AND plan.decision_ordinal = ?",
    "    AND plan.disposition = 'WILL_RECORD_EVER_SUBSCRIBED'",
    "    AND plan.customer_id = ?",
    "    AND plan.evidence_ref = ?",
    "    AND plan.first_observed_at = ?",
    "    AND plan.source = ?",
    ")",
    "  AND NOT EXISTS (",
    "    SELECT 1 FROM historical_subscription_backfill_apply_conflicts",
    "    WHERE run_id = ?",
    "  )",
    "  AND NOT EXISTS (",
    "    SELECT 1 FROM historical_subscription_history",
    "    WHERE customer_id = ?",
    "  )",
  ])).bind(
    decision.candidate.customerId,
    decision.candidate.firstObservedAt,
    run.runId,
    decision.candidate.evidenceRef,
    decision.candidate.source,
    appliedAt,
    run.runId,
    run.digest,
    run.approvalRef,
    decision.ordinal,
    decision.candidate.customerId,
    decision.candidate.evidenceRef,
    decision.candidate.firstObservedAt,
    decision.candidate.source,
    run.runId,
    decision.candidate.customerId,
  );
}

function bindFactAuditInsert(
  database: D1DatabasePort,
  run: DurableHistoricalBackfillRun,
  decision: PlannedDecision,
  auditId: string,
  appliedAt: IsoTimestamp,
): D1PreparedStatement {
  return database.prepare(sql([
    "INSERT INTO historical_subscription_backfill_audit (",
    "  audit_id, run_id, action, customer_id, approval_ref, digest, occurred_at",
    ")",
    "SELECT ?, ?, 'EVER_SUBSCRIBED_RECORDED', ?, ?, ?, ?",
    "WHERE EXISTS (",
    "  SELECT 1",
    "  FROM historical_subscription_backfill_runs AS current_run",
    "  JOIN historical_subscription_backfill_plan AS plan",
    "    ON plan.run_id = current_run.run_id",
    "  JOIN historical_subscription_history AS history",
    "    ON history.customer_id = plan.customer_id",
    "  WHERE current_run.run_id = ?",
    "    AND current_run.digest = ?",
    "    AND current_run.status = 'DRY_RUN_COMPLETE'",
    "    AND current_run.apply_state = 'APPLYING'",
    "    AND current_run.approval_ref = ?",
    "    AND plan.decision_ordinal = ?",
    "    AND plan.disposition = 'WILL_RECORD_EVER_SUBSCRIBED'",
    "    AND plan.customer_id = ?",
    "    AND history.established_by_run_id = current_run.run_id",
    "    AND history.evidence_ref = plan.evidence_ref",
    "    AND history.established_at = plan.first_observed_at",
    "    AND history.source = plan.source",
    "    AND history.recorded_at = ?",
    ")",
    "  AND NOT EXISTS (",
    "    SELECT 1 FROM historical_subscription_backfill_audit AS existing",
    "    WHERE existing.run_id = ? AND existing.action = 'EVER_SUBSCRIBED_RECORDED'",
    "      AND existing.customer_id = ?",
    "  )",
  ])).bind(
    auditId,
    run.runId,
    decision.candidate.customerId,
    run.approvalRef,
    run.digest,
    appliedAt,
    run.runId,
    run.digest,
    run.approvalRef,
    decision.ordinal,
    decision.candidate.customerId,
    appliedAt,
    run.runId,
    decision.candidate.customerId,
  );
}

function bindNeedsReviewTransition(
  database: D1DatabasePort,
  run: DurableHistoricalBackfillRun,
  auditId: string,
  appliedAt: IsoTimestamp,
): D1PreparedStatement {
  return database.prepare(sql([
    "UPDATE historical_subscription_backfill_runs",
    "SET apply_state = 'NEEDS_REVIEW', finalized_at = ?, lifecycle_audit_id = ?",
    "WHERE run_id = ? AND digest = ? AND status = 'DRY_RUN_COMPLETE'",
    "  AND apply_state = 'APPLYING' AND approval_ref = ?",
    "  AND EXISTS (",
    "    SELECT 1 FROM historical_subscription_backfill_apply_conflicts AS conflict",
    "    WHERE conflict.run_id = historical_subscription_backfill_runs.run_id",
    "  )",
  ])).bind(appliedAt, auditId, run.runId, run.digest, run.approvalRef);
}

function bindAppliedTransition(
  database: D1DatabasePort,
  run: DurableHistoricalBackfillRun,
  auditId: string,
  appliedAt: IsoTimestamp,
): D1PreparedStatement {
  return database.prepare(sql([
    "UPDATE historical_subscription_backfill_runs",
    "SET status = 'APPLIED', apply_state = 'APPLIED', finalized_at = ?, lifecycle_audit_id = ?",
    "WHERE run_id = ? AND digest = ? AND status = 'DRY_RUN_COMPLETE'",
    "  AND apply_state = 'APPLYING' AND approval_ref = ?",
    "  AND NOT EXISTS (",
    "    SELECT 1 FROM historical_subscription_backfill_apply_conflicts AS conflict",
    "    WHERE conflict.run_id = historical_subscription_backfill_runs.run_id",
    "  )",
    "  AND NOT EXISTS (",
    "    SELECT 1 FROM historical_subscription_backfill_plan AS plan",
    "    WHERE plan.run_id = historical_subscription_backfill_runs.run_id",
    "      AND plan.disposition = 'WILL_RECORD_EVER_SUBSCRIBED'",
    "      AND (",
    "        NOT EXISTS (",
    "          SELECT 1 FROM historical_subscription_history AS history",
    "          WHERE history.customer_id = plan.customer_id",
    "            AND history.established_by_run_id = historical_subscription_backfill_runs.run_id",
    "            AND history.evidence_ref = plan.evidence_ref",
    "            AND history.established_at = plan.first_observed_at",
    "            AND history.source = plan.source",
    "        )",
    "        OR NOT EXISTS (",
    "          SELECT 1 FROM historical_subscription_backfill_audit AS audit",
    "          WHERE audit.run_id = historical_subscription_backfill_runs.run_id",
    "            AND audit.action = 'EVER_SUBSCRIBED_RECORDED'",
    "            AND audit.customer_id = plan.customer_id",
    "            AND audit.approval_ref = historical_subscription_backfill_runs.approval_ref",
    "            AND audit.digest = historical_subscription_backfill_runs.digest",
    "        )",
    "      )",
    "  )",
  ])).bind(appliedAt, auditId, run.runId, run.digest, run.approvalRef);
}

function mapHistoryRow(row: HistoryRow): DurableHistoricalSubscriptionRecord {
  try {
    const source = asHistoricalMemberSource(row.source);
    return {
      customerId: asCustomerId(row.customer_id),
      establishedAt: assertCanonicalHistoricalTimestamp(row.established_at),
      establishedByRunId: asHistoricalBackfillRunId(row.established_by_run_id),
      evidenceRef: asHistoricalEvidenceRef(row.evidence_ref, source),
      source,
    };
  } catch {
    throw new DurableHistoricalBackfillPersistenceError("The durable history row contains malformed data.");
  }
}

function mapRunRow(row: RunRow): DurableHistoricalBackfillRun {
  try {
    const runId = asHistoricalBackfillRunId(row.run_id);
    const digest = asDigest(row.digest);
    const requestedAt = assertCanonicalHistoricalTimestamp(row.requested_at);
    const status = asRunStatus(row.status);
    const applyState = asApplyState(row.apply_state);
    const legacyQuarantined = asLegacyQuarantined(row.legacy_quarantined);
    const legacyQuarantineReason = asLegacyQuarantineReason(row.legacy_quarantine_reason);
    const approvalRef = row.approval_ref === null ? null : asHistoricalBackfillApprovalRef(row.approval_ref);
    const approvedAt = nullableTimestamp(row.approved_at);
    const applyStartedAt = nullableTimestamp(row.apply_started_at);
    const finalizedAt = nullableTimestamp(row.finalized_at);
    const lifecycleAuditId = row.lifecycle_audit_id === null ? null : asLifecycleAuditId(row.lifecycle_audit_id);
    assertRunStateShape({
      approvalRef,
      approvedAt,
      applyStartedAt,
      applyState,
      finalizedAt,
      lifecycleAuditId,
      legacyQuarantined,
      legacyQuarantineReason,
      status,
    });
    return {
      approvalRef,
      approvedAt,
      applyStartedAt,
      applyState,
      digest,
      finalizedAt,
      lifecycleAuditId,
      legacyQuarantined,
      legacyQuarantineReason,
      requestedAt,
      runId,
      status,
    };
  } catch (error) {
    if (error instanceof DurableHistoricalBackfillPersistenceError) throw error;
    throw new DurableHistoricalBackfillPersistenceError("The durable backfill run contains malformed data.");
  }
}

function mapConflictRow(row: ConflictRow): DurableHistoricalBackfillConflict {
  try {
    if (row.reason === "LEGACY_EVIDENCE_REQUIRES_REVIEW") {
      if (row.competing_run_id !== null) throw new Error("Legacy conflict must not name a durable competing run.");
      return {
        competingRunId: null,
        customerId: asCustomerId(row.customer_id),
        detectedAt: assertCanonicalHistoricalTimestamp(row.detected_at),
        reason: row.reason,
      };
    }
    if (row.reason !== "ALREADY_RECORDED_BY_ANOTHER_RUN" || row.competing_run_id === null) {
      throw new Error("Unsupported conflict reason.");
    }
    return {
      competingRunId: asHistoricalBackfillRunId(row.competing_run_id),
      customerId: asCustomerId(row.customer_id),
      detectedAt: assertCanonicalHistoricalTimestamp(row.detected_at),
      reason: row.reason,
    };
  } catch {
    throw new DurableHistoricalBackfillPersistenceError("The durable backfill conflict contains malformed data.");
  }
}

function asHistoricalMemberSource(value: string): HistoricalMemberSource {
  if (value === "APPSTLE_EXPORT" || value === "SHOPIFY_ORDER_EXPORT" || value === "MERCHANT_REVIEW") {
    return value;
  }
  throw new Error("Unsupported historical member source.");
}

function asHistoricalBackfillDisposition(value: string): HistoricalBackfillDisposition {
  if (
    value === "WILL_RECORD_EVER_SUBSCRIBED"
    || value === "ALREADY_DURABLE"
    || value === "DUPLICATE_IN_INPUT"
  ) {
    return value;
  }
  throw new Error("Unsupported historical backfill disposition.");
}

function asRunStatus(value: string): "DRY_RUN_COMPLETE" | "APPLIED" {
  if (value === "DRY_RUN_COMPLETE" || value === "APPLIED") return value;
  throw new Error("Unsupported historical backfill status.");
}

function asApplyState(value: string): DurableHistoricalBackfillApplyState {
  if (
    value === "PENDING_APPROVAL"
    || value === "APPROVED"
    || value === "APPLYING"
    || value === "APPLIED"
    || value === "NEEDS_REVIEW"
  ) {
    return value;
  }
  throw new Error("Unsupported historical backfill apply state.");
}

function asDigest(value: string): string {
  if (!DIGEST.test(value)) throw new Error("Durable historical backfill digest is malformed.");
  return value;
}

function asLifecycleAuditId(value: string): string {
  if (!LIFECYCLE_AUDIT_ID.test(value)) throw new Error("Durable lifecycle audit identifier is malformed.");
  return value;
}

function nullableTimestamp(value: string | null): IsoTimestamp | null {
  return value === null ? null : assertCanonicalHistoricalTimestamp(value);
}

function asLegacyQuarantined(value: number): boolean {
  if (value === 0) return false;
  if (value === 1) return true;
  throw new Error("Durable historical legacy quarantine marker is malformed.");
}

function asLegacyQuarantineReason(value: string | null): "NO_IMMUTABLE_PLAN" | null {
  if (value === null) return null;
  if (value === "NO_IMMUTABLE_PLAN") return value;
  throw new Error("Durable historical legacy quarantine reason is malformed.");
}

function assertRunStateShape(input: {
  readonly approvalRef: string | null;
  readonly approvedAt: IsoTimestamp | null;
  readonly applyStartedAt: IsoTimestamp | null;
  readonly applyState: DurableHistoricalBackfillApplyState;
  readonly finalizedAt: IsoTimestamp | null;
  readonly lifecycleAuditId: string | null;
  readonly legacyQuarantined: boolean;
  readonly legacyQuarantineReason: "NO_IMMUTABLE_PLAN" | null;
  readonly status: "DRY_RUN_COMPLETE" | "APPLIED";
}): void {
  if (input.legacyQuarantined) {
    if (
      input.legacyQuarantineReason !== "NO_IMMUTABLE_PLAN"
      || input.lifecycleAuditId !== null
      || (input.applyState === "APPLIED" && input.status !== "APPLIED")
      || (input.applyState === "NEEDS_REVIEW" && input.status !== "DRY_RUN_COMPLETE")
      || (input.applyState !== "APPLIED" && input.applyState !== "NEEDS_REVIEW")
    ) {
      throw new DurableHistoricalBackfillPersistenceError("The legacy quarantined durable run state is malformed.");
    }
    return;
  }
  if (input.legacyQuarantineReason !== null) {
    throw new DurableHistoricalBackfillPersistenceError("A non-legacy durable run cannot have a quarantine reason.");
  }
  const noApproval = input.approvalRef === null && input.approvedAt === null;
  if (input.applyState === "PENDING_APPROVAL") {
    if (
      input.status !== "DRY_RUN_COMPLETE"
      || !noApproval
      || input.applyStartedAt !== null
      || input.finalizedAt !== null
      || input.lifecycleAuditId !== null
    ) {
      throw new DurableHistoricalBackfillPersistenceError("The pending durable run state is malformed.");
    }
    return;
  }
  if (input.applyState === "APPROVED") {
    if (
      input.status !== "DRY_RUN_COMPLETE"
      || noApproval
      || input.applyStartedAt !== null
      || input.finalizedAt !== null
      || input.lifecycleAuditId === null
    ) {
      throw new DurableHistoricalBackfillPersistenceError("The approved durable run state is malformed.");
    }
    return;
  }
  if (input.applyState === "APPLYING") {
    if (
      input.status !== "DRY_RUN_COMPLETE"
      || noApproval
      || input.applyStartedAt === null
      || input.finalizedAt !== null
      || input.lifecycleAuditId === null
    ) {
      throw new DurableHistoricalBackfillPersistenceError("The applying durable run state is malformed.");
    }
    return;
  }
  if (input.applyState === "NEEDS_REVIEW") {
    if (
      input.status !== "DRY_RUN_COMPLETE"
      || noApproval
      || input.applyStartedAt === null
      || input.finalizedAt === null
      || input.lifecycleAuditId === null
    ) {
      throw new DurableHistoricalBackfillPersistenceError("The review-needed durable run state is malformed.");
    }
    return;
  }
  if (
    input.status !== "APPLIED"
    || noApproval
    || input.applyStartedAt === null
    || input.finalizedAt === null
    || input.lifecycleAuditId === null
  ) {
    throw new DurableHistoricalBackfillPersistenceError("The applied durable run state is malformed.");
  }
}

function assertAtOrAfter(value: IsoTimestamp, minimum: IsoTimestamp, message: string): void {
  if (Date.parse(value) < Date.parse(minimum)) {
    throw new DurableHistoricalBackfillConflictError(message);
  }
}

function assertChanged(result: D1Result | undefined, message: string): void {
  if (!changed(result)) throw new DurableHistoricalBackfillPersistenceError(message);
}

function changed(result: D1Result | undefined): boolean {
  return (result?.meta?.changes ?? 0) === 1;
}

function asDurableConflict(error: unknown, fallback: string): DurableHistoricalBackfillConflictError {
  if (error instanceof DurableHistoricalBackfillConflictError) return error;
  if (error instanceof DurableHistoricalBackfillPersistenceError) return error;
  return new DurableHistoricalBackfillConflictError(fallback);
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
