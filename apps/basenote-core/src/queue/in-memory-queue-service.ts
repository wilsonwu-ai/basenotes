import {
  asProductVariantId,
  asSubscriptionContractId,
  type ProductVariantId,
} from "../domain/ids.js";
import {
  QueueCutoffError,
  QueueIdempotencyConflictError,
  QueueLockedError,
  QueueNotFoundError,
  QueueRevisionConflictError,
  QueueServiceError,
} from "./errors.js";
import {
  asAdapterContractRef,
  asBindingId,
  asCustomerId,
  asCycleKey,
  asIsoTimestamp,
  asMerchantTimezone,
  asShipMonth,
  asSubscriptionLineId,
  assertIdempotencyKey,
  type BindingId,
  type ContractBinding,
  type ContractBindingStatus,
  type CreateContractBindingInput,
  type CycleKey,
  type FotmSchedule,
  type IsoTimestamp,
  type OutboxId,
  type QueueAttentionReason,
  type QueueCycleSlot,
  type QueueOutboxEntry,
  type QueueResolutionResult,
  type QueueSelectionSource,
  type ScheduleFotmInput,
  type ShipMonth,
  type VariantResolutionGuards,
} from "./types.js";

export interface QueueServiceOptions {
  /** Inject a deterministic clock in tests; the default is the system clock. */
  readonly clock?: () => Date;
}

export interface CustomerSlotMutationInput {
  readonly bindingId: string;
  /** Exact provider delivery-cycle ID, not a month. */
  readonly cycleKey: string;
  /** FOTM/display month associated with this exact cycle. */
  readonly shipMonth: string;
  readonly expectedRevision: number;
}

export interface SetCustomerSelectionInput extends CustomerSlotMutationInput {
  readonly variantId: string;
}

export interface ResolveDeliveryCycleInput {
  readonly bindingId: string;
  readonly cycleKey: string;
  readonly shipMonth: string;
  readonly idempotencyKey: string;
  readonly guards: VariantResolutionGuards;
}

/**
 * Local-only, in-memory implementation of the Queue v2 state machine.
 *
 * It deliberately has no adapter, network, database, or customer-authorisation
 * code. A future route must authenticate the caller before it invokes this
 * service, persist all mutations transactionally, and dispatch the resulting
 * outbox item through an approved exact-contract adapter.
 */
export class InMemoryQueueService {
  private readonly bindings = new Map<BindingId, ContractBinding>();
  private readonly bindingByContractLine = new Map<string, BindingId>();
  private readonly slots = new Map<string, QueueCycleSlot>();
  private readonly fotmSchedules = new Map<ShipMonth, FotmSchedule>();
  private readonly outboxes = new Map<OutboxId, QueueOutboxEntry>();
  private readonly outboxByIdempotency = new Map<string, OutboxId>();
  private readonly activeOutboxBySlot = new Map<string, OutboxId>();
  private readonly clock: () => Date;
  private nextOutboxSequence = 1;

  constructor(options: QueueServiceOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
  }

  createContractBinding(input: CreateContractBindingInput): ContractBinding {
    const binding = normalizeBinding(input);
    if (this.bindings.has(binding.id)) {
      throw new QueueServiceError(`A binding already exists for ${binding.id}.`);
    }
    const contractLineKey = bindingMapKey(binding.canonicalContractId, binding.subscriptionLineId);
    if (this.bindingByContractLine.has(contractLineKey)) {
      throw new QueueServiceError("An exact subscription contract line may have only one queue binding.");
    }

    this.bindings.set(binding.id, binding);
    this.bindingByContractLine.set(contractLineKey, binding.id);
    return cloneBinding(binding);
  }

  getContractBinding(bindingId: string): ContractBinding | null {
    const binding = this.bindings.get(asBindingId(bindingId));
    return binding ? cloneBinding(binding) : null;
  }

  listSlots(bindingId: string): QueueCycleSlot[] {
    const normalizedBindingId = asBindingId(bindingId);
    this.requireBinding(normalizedBindingId);
    return [...this.slots.values()]
      .filter((slot) => slot.bindingId === normalizedBindingId)
      .sort((left, right) => {
        const byMonth = left.shipMonth.localeCompare(right.shipMonth);
        return byMonth === 0 ? left.cycleKey.localeCompare(right.cycleKey) : byMonth;
      })
      .map(cloneSlot);
  }

  getSlot(bindingId: string, cycleKey: string): QueueCycleSlot | null {
    const normalizedBindingId = asBindingId(bindingId);
    const normalizedCycleKey = asCycleKey(cycleKey);
    this.requireBinding(normalizedBindingId);
    const slot = this.slots.get(slotMapKey(normalizedBindingId, normalizedCycleKey));
    return slot ? cloneSlot(slot) : null;
  }

  /**
   * Creates or updates a draft FOTM schedule. A published schedule is frozen
   * so it cannot silently rewrite a delivery already being resolved.
   */
  scheduleFotm(input: ScheduleFotmInput): FotmSchedule {
    const schedule = normalizeSchedule(input);
    const now = this.now();
    if (isAtOrAfter(now, schedule.cutoffAt)) {
      throw new QueueCutoffError("Cannot schedule an FOTM at or after its cutoff.");
    }

    const existing = this.fotmSchedules.get(schedule.shipMonth);
    if (existing && existing.status !== "DRAFT") {
      throw new QueueLockedError("A published or retired FOTM schedule cannot be changed in place.");
    }

    this.fotmSchedules.set(schedule.shipMonth, schedule);
    return cloneSchedule(schedule);
  }

  /** Publishes a previously reviewed FOTM schedule before the relevant cutoff. */
  publishFotm(shipMonth: string): FotmSchedule {
    const normalizedShipMonth = asShipMonth(shipMonth);
    const existing = this.fotmSchedules.get(normalizedShipMonth);
    if (!existing) {
      throw new QueueNotFoundError(`No FOTM schedule exists for ${normalizedShipMonth}.`);
    }
    if (existing.status === "PUBLISHED") return cloneSchedule(existing);
    if (existing.status === "RETIRED") {
      throw new QueueLockedError("A retired FOTM schedule cannot be republished.");
    }

    const now = this.now();
    if (isAtOrAfter(now, existing.cutoffAt)) {
      throw new QueueCutoffError("FOTM must be published before its cutoff.");
    }

    const published: FotmSchedule = {
      ...existing,
      status: "PUBLISHED",
      publishedAt: now,
    };
    this.fotmSchedules.set(published.shipMonth, published);
    return cloneSchedule(published);
  }

  getFotmSchedule(shipMonth: string): FotmSchedule | null {
    const schedule = this.fotmSchedules.get(asShipMonth(shipMonth));
    return schedule ? cloneSchedule(schedule) : null;
  }

  /**
   * Set an exact customer-selected variant using an optimistic slot revision.
   * This is intentionally unavailable after the cycle's merchant cutoff.
   */
  setCustomerSelection(input: SetCustomerSelectionInput): QueueCycleSlot {
    const target = normalizeMutationTarget(input);
    const binding = this.requireActiveBinding(target.bindingId);
    const variantId = asProductVariantId(input.variantId);
    const current = this.getOrCreateOpenSlot(target);
    this.assertWritableSlot(current, target.expectedRevision);
    this.assertBeforeCutoff(target.shipMonth);

    const updated = this.nextSlot(current, {
      selectedVariantId: variantId,
      source: "CUSTOMER",
      state: "OPEN",
      cutoffAt: this.cutoffFor(target.shipMonth),
      attentionReason: null,
    });
    this.saveSlot(updated);

    // Deliberately retain the active-binding check above even though it is not
    // otherwise used here; it makes the mutation boundary explicit.
    void binding;
    return cloneSlot(updated);
  }

  /**
   * An explicit clear records an empty OPEN slot. The resolver will use the
   * reviewed FOTM at cutoff, or transition to needs_attention if it cannot.
   */
  clearCustomerSelection(input: CustomerSlotMutationInput): QueueCycleSlot {
    const target = normalizeMutationTarget(input);
    const binding = this.requireActiveBinding(target.bindingId);
    const current = this.getOrCreateOpenSlot(target);
    this.assertWritableSlot(current, target.expectedRevision);
    this.assertBeforeCutoff(target.shipMonth);

    const updated = this.nextSlot(current, {
      selectedVariantId: null,
      source: "NONE",
      state: "OPEN",
      cutoffAt: this.cutoffFor(target.shipMonth),
      attentionReason: null,
    });
    this.saveSlot(updated);

    void binding;
    return cloneSlot(updated);
  }

  /**
   * Resolves a single delivery cycle once its approved FOTM cutoff has passed.
   * It never applies a provider change. It only locks the slot and emits a
   * PENDING outbox record that a future adapter must apply and read back.
   */
  resolveDeliveryCycle(input: ResolveDeliveryCycleInput): QueueResolutionResult {
    const target = normalizeResolveTarget(input);
    const replay = this.replayForIdempotency(target, input.idempotencyKey);
    if (replay) return replay;

    const binding = this.requireBinding(target.bindingId);
    const current = this.getOrCreateOpenSlot(target);
    if (current.state !== "OPEN") {
      throw new QueueLockedError("Only an OPEN queue slot can be resolved. Reload the latest slot state.");
    }
    if (this.activeOutboxBySlot.has(slotMapKey(target.bindingId, target.cycleKey))) {
      throw new QueueLockedError("A delivery cycle already has an active outbox item.");
    }

    if (binding.status !== "ACTIVE") {
      return this.attention(current, "BINDING_NOT_ACTIVE", this.cutoffFor(target.shipMonth));
    }

    const schedule = this.fotmSchedules.get(target.shipMonth);
    if (!schedule || schedule.status !== "PUBLISHED") {
      return this.attention(current, "FOTM_NOT_PUBLISHED", schedule?.cutoffAt ?? null);
    }
    if (!isAtOrAfter(this.now(), schedule.cutoffAt)) {
      throw new QueueCutoffError("A delivery cycle cannot resolve before its published FOTM cutoff.");
    }

    const selection = this.selectionForResolution(current, schedule.variantId);
    const guardResult = evaluateGuards(input.guards, binding, target.cycleKey, target.shipMonth, selection.variantId);
    const attentionReason = selection.source === "CUSTOMER"
      ? customerAttentionReason(guardResult)
      : fotmAttentionReason(guardResult);
    if (attentionReason) {
      return this.attention(current, attentionReason, schedule.cutoffAt);
    }

    const locked = this.nextSlot(current, {
      selectedVariantId: selection.variantId,
      source: selection.source,
      state: "LOCKED",
      cutoffAt: schedule.cutoffAt,
      attentionReason: null,
    });
    this.saveSlot(locked);

    const outbox = this.createOutbox(locked, input.idempotencyKey);
    return {
      outcome: "ENQUEUED",
      slot: cloneSlot(locked),
      outbox: cloneOutbox(outbox),
    };
  }

  /**
   * Claims one pending outbox item for an external worker. Claiming alone is
   * not success, and a NEEDS_ATTENTION item has no automatic retry path.
   */
  claimOutbox(outboxId: string): QueueOutboxEntry {
    const entry = this.requireOutbox(outboxId);
    if (entry.status !== "PENDING") {
      throw new QueueLockedError("Only a pending outbox item can be claimed.");
    }

    const slot = this.slots.get(slotMapKey(entry.bindingId, entry.cycleKey));
    if (!slot || slot.state !== "LOCKED" || slot.revision !== entry.slotRevisionAtEnqueue) {
      return this.transitionOutboxToAttention(entry, "STALE_SLOT_REVISION");
    }

    const claimed: QueueOutboxEntry = {
      ...entry,
      status: "APPLYING",
      attempts: entry.attempts + 1,
      updatedAt: this.now(),
    };
    this.outboxes.set(claimed.id, claimed);
    return cloneOutbox(claimed);
  }

  /**
   * Records a verified adapter readback. A mismatch transitions the outbox and
   * its slot to NEEDS_ATTENTION instead of incorrectly reporting success.
   */
  confirmOutboxReadback(
    outboxId: string,
    readbackVariantId: string,
    adapterReceipt: string,
  ): QueueOutboxEntry {
    const entry = this.requireOutbox(outboxId);
    if (entry.status !== "APPLYING") {
      throw new QueueLockedError("Only an applying outbox item can receive a readback.");
    }

    let readback: ProductVariantId;
    try {
      readback = asProductVariantId(readbackVariantId);
    } catch {
      return this.transitionOutboxToAttention(entry, "READBACK_MISMATCH");
    }
    if (readback !== entry.desiredVariantId) {
      return this.transitionOutboxToAttention(entry, "READBACK_MISMATCH");
    }

    const receipt = normalizeReceipt(adapterReceipt);
    const slot = this.slots.get(slotMapKey(entry.bindingId, entry.cycleKey));
    if (!slot || slot.state !== "LOCKED" || slot.revision !== entry.slotRevisionAtEnqueue) {
      return this.transitionOutboxToAttention(entry, "STALE_SLOT_REVISION");
    }

    const applied = this.nextSlot(slot, {
      state: "APPLIED",
      attentionReason: null,
    });
    this.saveSlot(applied);

    const completed: QueueOutboxEntry = {
      ...entry,
      status: "APPLIED",
      adapterReceipt: receipt,
      error: null,
      updatedAt: this.now(),
    };
    this.outboxes.set(completed.id, completed);
    this.clearActiveOutbox(completed);
    return cloneOutbox(completed);
  }

  /** Future adapters can record a sanitized failure code without retrying it. */
  recordOutboxFailure(
    outboxId: string,
    reason: QueueAttentionReason = "ADAPTER_REPORTED_FAILURE",
  ): QueueOutboxEntry {
    const entry = this.requireOutbox(outboxId);
    if (entry.status === "APPLIED") {
      throw new QueueLockedError("An applied outbox item cannot be changed to a failure.");
    }
    if (entry.status === "NEEDS_ATTENTION") return cloneOutbox(entry);
    return this.transitionOutboxToAttention(entry, reason);
  }

  /**
   * Explicit operator-only recovery hook. It never resurrects the old outbox
   * item; a caller must resolve the reopened slot with a new idempotency key.
   */
  reopenAfterAttention(bindingId: string, cycleKey: string, expectedRevision: number): QueueCycleSlot {
    const normalizedBindingId = asBindingId(bindingId);
    const normalizedCycleKey = asCycleKey(cycleKey);
    const slot = this.requireSlot(normalizedBindingId, normalizedCycleKey);
    assertRevision(expectedRevision);
    if (slot.revision !== expectedRevision) {
      throw new QueueRevisionConflictError("The queue slot changed; reload before reopening it.");
    }
    if (slot.state !== "NEEDS_ATTENTION") {
      throw new QueueLockedError("Only a NEEDS_ATTENTION slot may be explicitly reopened.");
    }
    if (this.activeOutboxBySlot.has(slotMapKey(normalizedBindingId, normalizedCycleKey))) {
      throw new QueueLockedError("Cannot reopen a slot with an active outbox item.");
    }

    const reopened = this.nextSlot(slot, {
      state: "OPEN",
      attentionReason: null,
    });
    this.saveSlot(reopened);
    return cloneSlot(reopened);
  }

  listOutbox(bindingId?: string): QueueOutboxEntry[] {
    const normalizedBindingId = bindingId ? asBindingId(bindingId) : null;
    if (normalizedBindingId) this.requireBinding(normalizedBindingId);

    return [...this.outboxes.values()]
      .filter((entry) => !normalizedBindingId || entry.bindingId === normalizedBindingId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .map(cloneOutbox);
  }

  private replayForIdempotency(
    target: ResolveTarget,
    idempotencyKey: string,
  ): QueueResolutionResult | null {
    assertIdempotencyKey(idempotencyKey);
    const outboxId = this.outboxByIdempotency.get(idempotencyKey);
    if (!outboxId) return null;

    const existing = this.requireOutbox(outboxId);
    if (
      existing.bindingId !== target.bindingId
      || existing.cycleKey !== target.cycleKey
      || existing.shipMonth !== target.shipMonth
    ) {
      throw new QueueIdempotencyConflictError(
        "An idempotency key may not be reused for a different delivery cycle.",
      );
    }

    const slot = this.requireSlot(target.bindingId, target.cycleKey);
    if (existing.status === "NEEDS_ATTENTION") {
      return {
        outcome: "NEEDS_ATTENTION",
        slot: cloneSlot(slot),
        reason: existing.error ?? "ADAPTER_REPORTED_FAILURE",
      };
    }
    return {
      outcome: "ENQUEUED",
      slot: cloneSlot(slot),
      outbox: cloneOutbox(existing),
    };
  }

  private requireBinding(bindingId: BindingId): ContractBinding {
    const binding = this.bindings.get(bindingId);
    if (!binding) throw new QueueNotFoundError(`No contract binding exists for ${bindingId}.`);
    return binding;
  }

  private requireActiveBinding(bindingId: BindingId): ContractBinding {
    const binding = this.requireBinding(bindingId);
    if (binding.status !== "ACTIVE") {
      throw new QueueLockedError("Only an active contract binding may be edited.");
    }
    return binding;
  }

  private requireSlot(bindingId: BindingId, cycleKey: CycleKey): QueueCycleSlot {
    const slot = this.slots.get(slotMapKey(bindingId, cycleKey));
    if (!slot) throw new QueueNotFoundError("No queue slot exists for this delivery cycle.");
    return slot;
  }

  private requireOutbox(outboxId: string): QueueOutboxEntry {
    const entry = this.outboxes.get(outboxId as OutboxId);
    if (!entry) throw new QueueNotFoundError(`No outbox item exists for ${outboxId}.`);
    return entry;
  }

  private getOrCreateOpenSlot(target: SlotTarget): QueueCycleSlot {
    const existing = this.slots.get(slotMapKey(target.bindingId, target.cycleKey));
    if (existing) {
      if (existing.shipMonth !== target.shipMonth) {
        throw new QueueServiceError("An exact delivery cycle cannot be reassigned to a different ship month.");
      }
      return existing;
    }

    return {
      bindingId: target.bindingId,
      cycleKey: target.cycleKey,
      shipMonth: target.shipMonth,
      selectedVariantId: null,
      source: "NONE",
      state: "OPEN",
      revision: 0,
      cutoffAt: this.cutoffFor(target.shipMonth),
      updatedAt: this.now(),
      attentionReason: null,
    };
  }

  private assertWritableSlot(slot: QueueCycleSlot, expectedRevision: number): void {
    assertRevision(expectedRevision);
    if (slot.revision !== expectedRevision) {
      throw new QueueRevisionConflictError("The queue slot changed; reload before saving.");
    }
    if (slot.state !== "OPEN") {
      throw new QueueLockedError("Only an OPEN queue slot can be edited.");
    }
  }

  private assertBeforeCutoff(shipMonth: ShipMonth): void {
    const cutoffAt = this.cutoffFor(shipMonth);
    if (cutoffAt && isAtOrAfter(this.now(), cutoffAt)) {
      throw new QueueCutoffError("This delivery cycle is past its merchant cutoff.");
    }
  }

  private cutoffFor(shipMonth: ShipMonth): IsoTimestamp | null {
    return this.fotmSchedules.get(shipMonth)?.cutoffAt ?? null;
  }

  private selectionForResolution(
    slot: QueueCycleSlot,
    fallbackVariantId: ProductVariantId,
  ): { readonly source: Exclude<QueueSelectionSource, "NONE">; readonly variantId: ProductVariantId } {
    if (slot.source === "CUSTOMER" && slot.selectedVariantId) {
      return { source: "CUSTOMER", variantId: slot.selectedVariantId };
    }
    return { source: "FOTM", variantId: fallbackVariantId };
  }

  private attention(
    current: QueueCycleSlot,
    reason: QueueAttentionReason,
    cutoffAt: IsoTimestamp | null,
  ): QueueResolutionResult {
    const attention = this.nextSlot(current, {
      state: "NEEDS_ATTENTION",
      cutoffAt,
      attentionReason: reason,
    });
    this.saveSlot(attention);
    return { outcome: "NEEDS_ATTENTION", slot: cloneSlot(attention), reason };
  }

  private createOutbox(slot: QueueCycleSlot, idempotencyKey: string): QueueOutboxEntry {
    assertIdempotencyKey(idempotencyKey);
    if (!slot.selectedVariantId || slot.source === "NONE") {
      throw new QueueServiceError("Only a locked slot with an exact selected variant may enter the outbox.");
    }

    const id = `outbox-${this.nextOutboxSequence}` as OutboxId;
    this.nextOutboxSequence += 1;
    const now = this.now();
    const entry: QueueOutboxEntry = {
      id,
      bindingId: slot.bindingId,
      cycleKey: slot.cycleKey,
      shipMonth: slot.shipMonth,
      desiredVariantId: slot.selectedVariantId,
      source: slot.source,
      slotRevisionAtEnqueue: slot.revision,
      idempotencyKey,
      status: "PENDING",
      attempts: 0,
      adapterReceipt: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    this.outboxes.set(id, entry);
    this.outboxByIdempotency.set(idempotencyKey, id);
    this.activeOutboxBySlot.set(slotMapKey(slot.bindingId, slot.cycleKey), id);
    return entry;
  }

  private transitionOutboxToAttention(
    entry: QueueOutboxEntry,
    reason: QueueAttentionReason,
  ): QueueOutboxEntry {
    const failed: QueueOutboxEntry = {
      ...entry,
      status: "NEEDS_ATTENTION",
      error: reason,
      updatedAt: this.now(),
    };
    this.outboxes.set(failed.id, failed);
    this.clearActiveOutbox(failed);

    const slot = this.slots.get(slotMapKey(failed.bindingId, failed.cycleKey));
    if (slot && slot.state !== "APPLIED") {
      const attention = this.nextSlot(slot, {
        state: "NEEDS_ATTENTION",
        attentionReason: reason,
      });
      this.saveSlot(attention);
    }
    return cloneOutbox(failed);
  }

  private clearActiveOutbox(entry: QueueOutboxEntry): void {
    const key = slotMapKey(entry.bindingId, entry.cycleKey);
    if (this.activeOutboxBySlot.get(key) === entry.id) {
      this.activeOutboxBySlot.delete(key);
    }
  }

  private nextSlot(
    current: QueueCycleSlot,
    changes: Partial<Pick<QueueCycleSlot, "selectedVariantId" | "source" | "state" | "cutoffAt" | "attentionReason">>,
  ): QueueCycleSlot {
    if (current.revision >= Number.MAX_SAFE_INTEGER) {
      throw new QueueServiceError("Queue slot revision overflow; manual remediation is required.");
    }
    const next: QueueCycleSlot = {
      ...current,
      ...changes,
      revision: current.revision + 1,
      updatedAt: this.now(),
    };
    assertSlotInvariant(next);
    return next;
  }

  private saveSlot(slot: QueueCycleSlot): void {
    assertSlotInvariant(slot);
    this.slots.set(slotMapKey(slot.bindingId, slot.cycleKey), slot);
  }

  private now(): IsoTimestamp {
    const value = this.clock();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new QueueServiceError("Queue service clock returned an invalid date.");
    }
    return asIsoTimestamp(value.toISOString());
  }
}

interface SlotTarget {
  readonly bindingId: BindingId;
  readonly cycleKey: CycleKey;
  readonly shipMonth: ShipMonth;
}

interface MutationTarget extends SlotTarget {
  readonly expectedRevision: number;
}

type ResolveTarget = SlotTarget;

function normalizeMutationTarget(input: CustomerSlotMutationInput): MutationTarget {
  assertRevision(input.expectedRevision);
  return {
    bindingId: asBindingId(input.bindingId),
    cycleKey: asCycleKey(input.cycleKey),
    shipMonth: asShipMonth(input.shipMonth),
    expectedRevision: input.expectedRevision,
  };
}

function normalizeResolveTarget(input: ResolveDeliveryCycleInput): ResolveTarget {
  return {
    bindingId: asBindingId(input.bindingId),
    cycleKey: asCycleKey(input.cycleKey),
    shipMonth: asShipMonth(input.shipMonth),
  };
}

function normalizeBinding(input: CreateContractBindingInput): ContractBinding {
  const nextBillingAt = input.nextBillingAt === undefined || input.nextBillingAt === null
    ? null
    : asIsoTimestamp(input.nextBillingAt);
  return {
    id: asBindingId(input.id),
    adapterOwner: input.adapterOwner,
    canonicalContractId: asSubscriptionContractId(input.canonicalContractId),
    adapterContractRef: asAdapterContractRef(input.adapterContractRef),
    customerId: asCustomerId(input.customerId),
    subscriptionLineId: asSubscriptionLineId(input.subscriptionLineId),
    status: assertBindingStatus(input.status),
    nextBillingAt,
    verifiedAt: asIsoTimestamp(input.verifiedAt),
  };
}

function normalizeSchedule(input: ScheduleFotmInput): FotmSchedule {
  return {
    shipMonth: asShipMonth(input.shipMonth),
    variantId: asProductVariantId(input.variantId),
    merchantTimezone: asMerchantTimezone(input.merchantTimezone),
    cutoffAt: asIsoTimestamp(input.cutoffAt),
    status: "DRAFT",
    publishedAt: null,
  };
}

function assertBindingStatus(value: ContractBindingStatus): ContractBindingStatus {
  if (!["ACTIVE", "PAUSED", "CANCELLED", "EXPIRED", "FAILED"].includes(value)) {
    throw new Error("status must be a supported contract-binding status.");
  }
  return value;
}

function assertRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("expectedRevision must be a non-negative safe integer.");
  }
}

function evaluateGuards(
  guards: VariantResolutionGuards,
  binding: ContractBinding,
  cycleKey: CycleKey,
  shipMonth: ShipMonth,
  variantId: ProductVariantId,
): "OK" | "UNAVAILABLE" | "INCOMPATIBLE" | "FAILED" {
  if (typeof guards?.isAvailable !== "function" || typeof guards?.isCompatible !== "function") {
    return "FAILED";
  }

  const input = { binding: cloneBinding(binding), cycleKey, shipMonth, variantId };
  try {
    if (!guards.isAvailable(input)) return "UNAVAILABLE";
    if (!guards.isCompatible(input)) return "INCOMPATIBLE";
    return "OK";
  } catch {
    return "FAILED";
  }
}

function customerAttentionReason(
  result: ReturnType<typeof evaluateGuards>,
): QueueAttentionReason | null {
  switch (result) {
    case "OK":
      return null;
    case "UNAVAILABLE":
      return "CUSTOMER_SELECTION_UNAVAILABLE";
    case "INCOMPATIBLE":
      return "CUSTOMER_SELECTION_INCOMPATIBLE";
    case "FAILED":
      return "GUARD_EVALUATION_FAILED";
  }
}

function fotmAttentionReason(result: ReturnType<typeof evaluateGuards>): QueueAttentionReason | null {
  switch (result) {
    case "OK":
      return null;
    case "UNAVAILABLE":
      return "FOTM_UNAVAILABLE";
    case "INCOMPATIBLE":
      return "FOTM_INCOMPATIBLE";
    case "FAILED":
      return "GUARD_EVALUATION_FAILED";
  }
}

function assertSlotInvariant(slot: QueueCycleSlot): void {
  const hasSelection = slot.selectedVariantId !== null;
  const hasSelectionSource = slot.source !== "NONE";
  if (hasSelection !== hasSelectionSource) {
    throw new QueueServiceError("A slot must have both an exact selection and a matching source, or neither.");
  }
  if (slot.state === "APPLIED" || slot.state === "LOCKED") {
    if (!slot.selectedVariantId || slot.source === "NONE") {
      throw new QueueServiceError("A locked or applied slot must identify one exact selected variant.");
    }
  }
}

function isAtOrAfter(now: IsoTimestamp, cutoffAt: IsoTimestamp): boolean {
  return Date.parse(now) >= Date.parse(cutoffAt);
}

function slotMapKey(bindingId: BindingId, cycleKey: CycleKey): string {
  return `${bindingId}\u0000${cycleKey}`;
}

function bindingMapKey(contractId: string, lineId: string): string {
  return `${contractId}\u0000${lineId}`;
}

function normalizeReceipt(value: string): string {
  const receipt = value.trim();
  if (receipt.length === 0 || receipt.length > 256) {
    throw new QueueServiceError("An adapter readback requires a non-empty receipt no longer than 256 characters.");
  }
  return receipt;
}

function cloneBinding(binding: ContractBinding): ContractBinding {
  return { ...binding };
}

function cloneSlot(slot: QueueCycleSlot): QueueCycleSlot {
  return { ...slot };
}

function cloneSchedule(schedule: FotmSchedule): FotmSchedule {
  return { ...schedule };
}

function cloneOutbox(entry: QueueOutboxEntry): QueueOutboxEntry {
  return { ...entry };
}
