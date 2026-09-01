import type { NormalizedProfileQueueCustomerMutation } from "../profile-queue/contracts.js";
import { asProductVariantId, type ProductVariantId } from "../domain/ids.js";
import type { StagingWorkerEnv } from "./contracts.js";

const MAX_STAGING_TEST_VARIANTS = 24;

export interface StagingTestVariant {
  readonly label: string;
  readonly variantId: ProductVariantId;
}

export class StagingTestVariantConfigError extends Error {
  override name = "StagingTestVariantConfigError";
}

export class StagingTestVariantNotAllowedError extends Error {
  override name = "StagingTestVariantNotAllowedError";
}

/**
 * The disposable-test catalog is intentionally static runtime configuration.
 * This Worker has no Admin API token, catalog egress, title lookup, or product
 * cache. Labels are generic so configuration cannot leak product/customer data.
 */
export function readStagingTestVariants(environment: StagingWorkerEnv): readonly StagingTestVariant[] {
  const configured = environment.STAGING_TEST_VARIANT_IDS;
  if (!configured?.trim() || configured.trim().toUpperCase().startsWith("REPLACE_")) {
    throw new StagingTestVariantConfigError("No staging test variants are configured.");
  }
  const values = configured.split(",").map((value) => value.trim());
  if (
    values.length === 0
    || values.length > MAX_STAGING_TEST_VARIANTS
    || values.some((value) => value.length === 0)
  ) {
    throw new StagingTestVariantConfigError("The staging test variant allowlist is invalid.");
  }

  const seen = new Set<ProductVariantId>();
  return values.map((value, index) => {
    let variantId: ProductVariantId;
    try {
      variantId = asProductVariantId(value);
    } catch {
      throw new StagingTestVariantConfigError("The staging test variant allowlist is invalid.");
    }
    if (seen.has(variantId)) {
      throw new StagingTestVariantConfigError("The staging test variant allowlist must not repeat a variant.");
    }
    seen.add(variantId);
    return { label: `Eligible test fragrance ${index + 1}`, variantId };
  });
}

export function assertStagingMutationVariantAllowed(
  mutation: NormalizedProfileQueueCustomerMutation,
  variants: readonly StagingTestVariant[],
): void {
  if (mutation.kind === "REMOVE_ADD_ON" || mutation.kind === "CLEAR_MEMBER_FRAGRANCE") return;
  assertStagingVariantAllowed(mutation.variantId, variants);
}

/** Reused by the authenticated staging scheduler; no catalog lookup occurs. */
export function assertStagingVariantAllowed(
  variantId: string,
  variants: readonly StagingTestVariant[],
): ProductVariantId {
  const normalized = asProductVariantId(variantId);
  if (!variants.some((variant) => variant.variantId === normalized)) {
    throw new StagingTestVariantNotAllowedError("The requested variant is not in the staging test allowlist.");
  }
  return normalized;
}
