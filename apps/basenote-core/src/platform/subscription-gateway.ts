import type { ProductVariantId, SubscriptionContractId } from "../domain/ids.js";

export interface OwnedSubscriptionContract {
  readonly appId: string;
  readonly id: SubscriptionContractId;
  readonly status: "ACTIVE" | "PAUSED" | "CANCELLED" | "EXPIRED" | "FAILED";
}

export interface UpdateNextShipmentInput {
  readonly contractId: SubscriptionContractId;
  readonly idempotencyKey: string;
  readonly variantId: ProductVariantId;
}

/**
 * Future boundary around Shopify's Subscription Contract API.
 *
 * An implementation must prove `contract.appId === baseNoteAppId` before it
 * reads or changes the contract. Appstle-owned contracts are intentionally
 * unsupported here because Shopify scopes subscription access to the app that
 * owns the contract.
 */
export interface BaseNoteOwnedSubscriptionGateway {
  getOwnedContract(contractId: SubscriptionContractId): Promise<OwnedSubscriptionContract | null>;
  updateNextShipment(input: UpdateNextShipmentInput): Promise<void>;
}

export function assertBaseNoteContractOwnership(
  contract: OwnedSubscriptionContract,
  baseNoteAppId: string,
): void {
  if (contract.appId !== baseNoteAppId) {
    throw new Error("Refusing to mutate a subscription contract not owned by Base Note Core.");
  }
}
