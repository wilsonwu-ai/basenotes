export type SubscriptionContractId = `gid://shopify/SubscriptionContract/${string}`;
export type ProductVariantId = `gid://shopify/ProductVariant/${string}`;

const CONTRACT_GID = /^gid:\/\/shopify\/SubscriptionContract\/[1-9]\d*$/;
const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/;
const SHIP_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export class DomainValidationError extends Error {
  override name = "DomainValidationError";
}

export function asSubscriptionContractId(value: string): SubscriptionContractId {
  if (!CONTRACT_GID.test(value)) {
    throw new DomainValidationError("A queue operation requires an exact Shopify SubscriptionContract GID.");
  }
  return value as SubscriptionContractId;
}

export function asProductVariantId(value: string): ProductVariantId {
  if (!VARIANT_GID.test(value)) {
    throw new DomainValidationError("A queue operation requires an exact Shopify ProductVariant GID.");
  }
  return value as ProductVariantId;
}

export function assertShipMonth(value: string): void {
  if (!SHIP_MONTH.test(value)) {
    throw new DomainValidationError("shipMonth must use YYYY-MM and contain a valid month.");
  }
}
