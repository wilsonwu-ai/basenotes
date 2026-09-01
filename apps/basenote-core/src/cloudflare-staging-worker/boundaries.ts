import type {
  ProfileQueueOwnershipResolver,
  SignedProxyBoundary,
} from "./contracts.js";

/** Returned by a future verifier for an invalid/missing Shopify signature. */
export class SignedProxyRejectedError extends Error {
  override name = "SignedProxyRejectedError";
}

/**
 * The checked-in Worker has no App Proxy secret and consequently cannot accept
 * a customer request. This prevents a staging deployment becoming an unsigned
 * D1 write API while Shopify setup is incomplete.
 */
export class SignedProxyBoundaryNotConfiguredError extends Error {
  override name = "SignedProxyBoundaryNotConfiguredError";
}

/**
 * A valid signature alone is not authority over a subscription. The resolver
 * is intentionally separate and unavailable until an exact binding readback
 * implementation is reviewed.
 */
export class ProfileQueueOwnershipNotConfiguredError extends Error {
  override name = "ProfileQueueOwnershipNotConfiguredError";
}

/** Returned by a future resolver when the signed customer does not own a cycle. */
export class ProfileQueueOwnershipDeniedError extends Error {
  override name = "ProfileQueueOwnershipDeniedError";
}

export const unconfiguredSignedProxyBoundary: SignedProxyBoundary = {
  async verify() {
    throw new SignedProxyBoundaryNotConfiguredError(
      "A reviewed Shopify App Proxy verifier has not been configured for staging.",
    );
  },
};

export const unconfiguredProfileQueueOwnershipResolver: ProfileQueueOwnershipResolver = {
  async resolve() {
    throw new ProfileQueueOwnershipNotConfiguredError(
      "An exact customer-to-binding resolver has not been configured for staging.",
    );
  },
};
