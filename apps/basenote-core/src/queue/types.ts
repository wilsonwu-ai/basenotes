import type { ProductVariantId, SubscriptionContractId } from "../domain/ids.js";

export type BindingId = string & { readonly __brand: "BindingId" };
export type CycleKey = string & { readonly __brand: "CycleKey" };
export type ShipMonth = string & { readonly __brand: "ShipMonth" };
export type CustomerId = `gid://shopify/Customer/${string}`;
export type SubscriptionLineId = `gid://shopify/SubscriptionLine/${string}`;
export type IsoTimestamp = string & { readonly __brand: "IsoTimestamp" };
export type OutboxId = string & { readonly __brand: "OutboxId" };

export type AdapterOwner = "APPSTLE" | "BASE_NOTE";
export type ContractBindingStatus = "ACTIVE" | "PAUSED" | "CANCELLED" | "EXPIRED" | "FAILED";
export type QueueSlotState = "OPEN" | "LOCKED" | "APPLIED" | "NEEDS_ATTENTION";
export type QueueSelectionSource = "CUSTOMER" | "FOTM" | "NONE";
export type FotmScheduleStatus = "DRAFT" | "PUBLISHED" | "RETIRED";
export type OutboxStatus = "PENDING" | "APPLYING" | "APPLIED" | "NEEDS_ATTENTION";

/**
 * The one exact contract line a future adapter is permitted to address.
 * `adapterContractRef` is an opaque provider-side reference; it is never
 * inferred from a customer or a list of active contracts.
 */
export interface ContractBinding {
  readonly id: BindingId;
  readonly adapterOwner: AdapterOwner;
  readonly canonicalContractId: SubscriptionContractId;
  readonly adapterContractRef: string;
  readonly customerId: CustomerId;
  readonly subscriptionLineId: SubscriptionLineId;
  readonly status: ContractBindingStatus;
  readonly nextBillingAt: IsoTimestamp | null;
  readonly verifiedAt: IsoTimestamp;
}

export interface CreateContractBindingInput {
  readonly id: string;
  readonly adapterOwner: AdapterOwner;
  readonly canonicalContractId: string;
  readonly adapterContractRef: string;
  readonly customerId: string;
  readonly subscriptionLineId: string;
  readonly status: ContractBindingStatus;
  readonly nextBillingAt?: string | null;
  readonly verifiedAt: string;
}

/**
 * A single selectable delivery cycle. An empty OPEN slot deliberately records
 * an explicit "use published FOTM at cutoff" intent rather than allowing a
 * provider to choose an arbitrary line.
 */
export interface QueueCycleSlot {
  readonly bindingId: BindingId;
  /**
   * The provider's exact delivery-cycle identifier. It is intentionally not a
   * month, because a contract can have more than one delivery in a month.
   */
  readonly cycleKey: CycleKey;
  /** Display and FOTM lookup value only; never the uniqueness key. */
  readonly shipMonth: ShipMonth;
  readonly selectedVariantId: ProductVariantId | null;
  readonly source: QueueSelectionSource;
  readonly state: QueueSlotState;
  readonly revision: number;
  readonly cutoffAt: IsoTimestamp | null;
  readonly updatedAt: IsoTimestamp;
  readonly attentionReason: QueueAttentionReason | null;
}

export interface FotmSchedule {
  readonly shipMonth: ShipMonth;
  readonly variantId: ProductVariantId;
  readonly merchantTimezone: string;
  readonly cutoffAt: IsoTimestamp;
  readonly status: FotmScheduleStatus;
  readonly publishedAt: IsoTimestamp | null;
}

export interface ScheduleFotmInput {
  readonly shipMonth: string;
  readonly variantId: string;
  readonly merchantTimezone: string;
  readonly cutoffAt: string;
}

/**
 * The resolver requires both checks. A future integration must provide these
 * from an exact catalog/plan readback; an omitted, false, or throwing check is
 * treated as unsafe and therefore fails closed.
 */
export interface VariantResolutionGuards {
  readonly isAvailable: (input: {
    readonly binding: ContractBinding;
    readonly cycleKey: CycleKey;
    readonly shipMonth: ShipMonth;
    readonly variantId: ProductVariantId;
  }) => boolean;
  readonly isCompatible: (input: {
    readonly binding: ContractBinding;
    readonly cycleKey: CycleKey;
    readonly shipMonth: ShipMonth;
    readonly variantId: ProductVariantId;
  }) => boolean;
}

export type QueueAttentionReason =
  | "BINDING_NOT_ACTIVE"
  | "FOTM_NOT_PUBLISHED"
  | "CUSTOMER_SELECTION_UNAVAILABLE"
  | "CUSTOMER_SELECTION_INCOMPATIBLE"
  | "FOTM_UNAVAILABLE"
  | "FOTM_INCOMPATIBLE"
  | "GUARD_EVALUATION_FAILED"
  | "STALE_SLOT_REVISION"
  | "READBACK_MISMATCH"
  | "ADAPTER_REPORTED_FAILURE";

/**
 * A durable future worker would persist this record before contacting an
 * adapter. This local service never invokes an adapter itself.
 */
export interface QueueOutboxEntry {
  readonly id: OutboxId;
  readonly bindingId: BindingId;
  readonly cycleKey: CycleKey;
  readonly shipMonth: ShipMonth;
  readonly desiredVariantId: ProductVariantId;
  readonly source: Exclude<QueueSelectionSource, "NONE">;
  readonly slotRevisionAtEnqueue: number;
  readonly idempotencyKey: string;
  readonly status: OutboxStatus;
  readonly attempts: number;
  readonly adapterReceipt: string | null;
  readonly error: QueueAttentionReason | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export type QueueResolutionResult =
  | {
      readonly outcome: "ENQUEUED";
      readonly slot: QueueCycleSlot;
      readonly outbox: QueueOutboxEntry;
    }
  | {
      readonly outcome: "NEEDS_ATTENTION";
      readonly slot: QueueCycleSlot;
      readonly reason: QueueAttentionReason;
    };

const BINDING_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const CUSTOMER_GID = /^gid:\/\/shopify\/Customer\/[1-9]\d*$/;
const SUBSCRIPTION_LINE_GID = /^gid:\/\/shopify\/SubscriptionLine\/[1-9]\d*$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;

export function asBindingId(value: string): BindingId {
  if (!BINDING_ID.test(value)) {
    throw new Error("bindingId must be 3-128 URL-safe characters.");
  }
  return value as BindingId;
}

export function asCycleKey(value: string): CycleKey {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,199}$/.test(value)) {
    throw new Error("cycleKey must be a 3-200 character exact provider delivery-cycle identifier.");
  }
  return value as CycleKey;
}

export function asShipMonth(value: string): ShipMonth {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new Error("shipMonth must use YYYY-MM and contain a valid month.");
  }
  return value as ShipMonth;
}

export function asCustomerId(value: string): CustomerId {
  if (!CUSTOMER_GID.test(value)) {
    throw new Error("customerId must be an exact Shopify Customer GID.");
  }
  return value as CustomerId;
}

export function asSubscriptionLineId(value: string): SubscriptionLineId {
  if (!SUBSCRIPTION_LINE_GID.test(value)) {
    throw new Error("subscriptionLineId must be an exact Shopify SubscriptionLine GID.");
  }
  return value as SubscriptionLineId;
}

export function asIsoTimestamp(value: string): IsoTimestamp {
  if (!ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error("timestamp must be a valid UTC ISO-8601 value.");
  }
  return value as IsoTimestamp;
}

export function asAdapterContractRef(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 256) {
    throw new Error("adapterContractRef must be between 1 and 256 characters.");
  }
  return normalized;
}

export function asMerchantTimezone(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 100) {
    throw new Error("merchantTimezone must be between 1 and 100 characters.");
  }

  try {
    Intl.DateTimeFormat("en-US", { timeZone: normalized });
  } catch {
    throw new Error("merchantTimezone must be a valid IANA timezone.");
  }

  return normalized;
}

export function assertIdempotencyKey(value: string): void {
  if (!IDEMPOTENCY_KEY.test(value)) {
    throw new Error("idempotencyKey must be 8-200 URL-safe characters.");
  }
}
