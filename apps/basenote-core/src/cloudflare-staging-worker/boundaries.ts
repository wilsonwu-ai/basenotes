import type {
  ProfileQueueOwnershipResolver,
  SignedProxyBoundary,
} from "./contracts.js";

/** Returned by the verifier for an invalid or missing Shopify signature. */
export class SignedProxyRejectedError extends Error {
  override name = "SignedProxyRejectedError";
}

/**
 * The checked-in source has no App Proxy runtime secret. This error prevents a
 * staging deployment becoming an unsigned D1 write API while setup is
 * incomplete.
 */
export class SignedProxyBoundaryNotConfiguredError extends Error {
  override name = "SignedProxyBoundaryNotConfiguredError";
}

/**
 * A valid signature alone is not authority over a subscription. The default
 * staging resolver permits only an exact seeded disposable binding; this error
 * remains available for deliberately unconfigured dependency injection.
 */
export class ProfileQueueOwnershipNotConfiguredError extends Error {
  override name = "ProfileQueueOwnershipNotConfiguredError";
}

/** Returned when the signed customer is not authorized for an exact cycle. */
export class ProfileQueueOwnershipDeniedError extends Error {
  override name = "ProfileQueueOwnershipDeniedError";
}

/** Returned when a signed Profile Queue form nonce is absent, stale, or reused. */
export class ProfileQueueFormNonceDeniedError extends Error {
  override name = "ProfileQueueFormNonceDeniedError";
}

/** Returned for a malformed, stale, mismatched, or unsigned embedded Admin ID token. */
export class StagingAdminIdTokenRejectedError extends Error {
  override name = "StagingAdminIdTokenRejectedError";
}

/** The embedded Admin scheduler cannot safely start without its runtime-only app credentials. */
export class StagingAdminIdTokenNotConfiguredError extends Error {
  override name = "StagingAdminIdTokenNotConfiguredError";
}

/** A genuine Shopify Admin identity is not automatically authorized to schedule staging FOTM. */
export class StagingAdminStaffDeniedError extends Error {
  override name = "StagingAdminStaffDeniedError";
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
