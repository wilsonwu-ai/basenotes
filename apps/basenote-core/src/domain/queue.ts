import {
  asProductVariantId,
  asSubscriptionContractId,
  assertShipMonth,
  type ProductVariantId,
  type SubscriptionContractId,
} from "./ids.js";

export interface QueueSlot {
  readonly contractId: SubscriptionContractId;
  readonly productTitle: string;
  readonly shipMonth: string;
  readonly variantId: ProductVariantId;
}

export interface QueueSlotInput {
  readonly contractId: string;
  readonly productTitle: string;
  readonly shipMonth: string;
  readonly variantId: string;
}

export interface FragranceOfTheMonth {
  readonly productTitle: string;
  readonly variantId: ProductVariantId;
}

export type ShipmentSelection =
  | { readonly source: "queue"; readonly slot: QueueSlot }
  | { readonly source: "fotm"; readonly fragrance: FragranceOfTheMonth };

/**
 * Upserts exactly one month on exactly one subscription contract.
 *
 * Callers must derive contractId from their authenticated session and authorize
 * it server-side. Never infer it from a customer-wide list or select the first
 * active contract.
 */
export function upsertQueueSlot(queue: readonly QueueSlot[], input: QueueSlotInput): QueueSlot[] {
  const slot = toQueueSlot(input);
  assertSingleContract(queue, slot.contractId);

  const withoutTargetMonth = queue.filter((existing) => existing.shipMonth !== slot.shipMonth);
  return [...withoutTargetMonth, slot].sort(compareSlots);
}

export function clearQueueSlot(
  queue: readonly QueueSlot[],
  contractId: string,
  shipMonth: string,
): QueueSlot[] {
  const normalizedContractId = asSubscriptionContractId(contractId);
  assertShipMonth(shipMonth);
  assertSingleContract(queue, normalizedContractId);
  return queue.filter((slot) => slot.shipMonth !== shipMonth);
}

/**
 * Resolves an empty next-shipment slot explicitly to FOTM instead of leaving the
 * subscription provider to choose an arbitrary existing contract line.
 */
export function resolveShipment(
  queue: readonly QueueSlot[],
  contractId: string,
  shipMonth: string,
  fragranceOfTheMonth: FragranceOfTheMonth,
): ShipmentSelection {
  const normalizedContractId = asSubscriptionContractId(contractId);
  assertShipMonth(shipMonth);
  assertSingleContract(queue, normalizedContractId);

  const queued = queue.find((slot) => slot.shipMonth === shipMonth);
  if (queued) return { source: "queue", slot: queued };
  return { source: "fotm", fragrance: fragranceOfTheMonth };
}

function toQueueSlot(input: QueueSlotInput): QueueSlot {
  const title = input.productTitle.trim();
  if (title.length === 0 || title.length > 180) {
    throw new Error("productTitle must be between 1 and 180 characters.");
  }

  return {
    contractId: asSubscriptionContractId(input.contractId),
    productTitle: title,
    shipMonth: normalizeShipMonth(input.shipMonth),
    variantId: asProductVariantId(input.variantId),
  };
}

function normalizeShipMonth(value: string): string {
  assertShipMonth(value);
  return value;
}

function assertSingleContract(queue: readonly QueueSlot[], contractId: SubscriptionContractId): void {
  const wrongContract = queue.find((slot) => slot.contractId !== contractId);
  if (wrongContract) {
    throw new Error("Queue reads and writes must be isolated to one subscription contract.");
  }
}

function compareSlots(left: QueueSlot, right: QueueSlot): number {
  return left.shipMonth.localeCompare(right.shipMonth);
}
