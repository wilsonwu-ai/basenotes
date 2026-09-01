/**
 * Opaque, high-entropy one-use nonce carried only in a rendered staging form.
 * It is not an authorization credential by itself: consumption is always
 * bound to the verified App Proxy identity and exact server-side queue scope.
 */
export type StagingProfileQueueFormNonce = string & {
  readonly __brand: "StagingProfileQueueFormNonce";
};

const FORM_NONCE = /^pqf_[A-Za-z0-9][A-Za-z0-9._:-]{31,127}$/;

export interface IssueStagingProfileQueueFormNonceInput {
  readonly bindingId: string;
  readonly cycleKey: string;
  readonly expiresAt: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly nonce: StagingProfileQueueFormNonce;
  readonly shipMonth: string;
  readonly shopDomain: string;
  readonly shopifyCustomerId: string;
}

export interface ConsumeStagingProfileQueueFormNonceInput {
  readonly bindingId: string;
  readonly consumedAt: string;
  readonly cycleKey: string;
  readonly expectedRevision: number;
  readonly nonce: StagingProfileQueueFormNonce;
  readonly shipMonth: string;
  readonly shopDomain: string;
  readonly shopifyCustomerId: string;
}

/** A durable, one-use CSRF/form-intent boundary for signed App Proxy forms. */
export interface StagingProfileQueueFormNonceRepository {
  consume(input: ConsumeStagingProfileQueueFormNonceInput): Promise<void>;
  issue(input: IssueStagingProfileQueueFormNonceInput): Promise<void>;
}

export function asStagingProfileQueueFormNonce(value: string): StagingProfileQueueFormNonce {
  if (!FORM_NONCE.test(value)) {
    throw new Error("Profile Queue form nonce must be a high-entropy opaque pqf_ value.");
  }
  return value as StagingProfileQueueFormNonce;
}
