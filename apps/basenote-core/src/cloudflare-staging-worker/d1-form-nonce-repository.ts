import { ProfileQueueFormNonceDeniedError } from "./boundaries.js";
import {
  asStagingProfileQueueFormNonce,
  type ConsumeStagingProfileQueueFormNonceInput,
  type IssueStagingProfileQueueFormNonceInput,
  type StagingProfileQueueFormNonceRepository,
} from "./form-nonce.js";
import { asBindingId, asCycleKey, asIsoTimestamp, asShipMonth } from "../queue/types.js";
import type { D1DatabasePort } from "../staging-runtime/d1.js";

const INSERT_FORM_NONCE = `
  INSERT INTO staging_profile_queue_form_nonces (
    form_nonce, shop_domain, shopify_customer_id, binding_id, cycle_key,
    ship_month, expected_revision, issued_at, expires_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const CONSUME_FORM_NONCE = `
  UPDATE staging_profile_queue_form_nonces
  SET consumed_at = ?
  WHERE form_nonce = ?
    AND shop_domain = ?
    AND shopify_customer_id = ?
    AND binding_id = ?
    AND cycle_key = ?
    AND ship_month = ?
    AND expected_revision = ?
    AND consumed_at IS NULL
    AND expires_at > ?`;

/**
 * Durable one-time form boundary for the disposable staging shop. A nonce is
 * deliberately bound to every server-derived authorization dimension so a
 * cross-site or stale form cannot retarget a future queue cycle.
 */
export class D1StagingProfileQueueFormNonceRepository implements StagingProfileQueueFormNonceRepository {
  constructor(private readonly database: D1DatabasePort) {}

  async issue(input: IssueStagingProfileQueueFormNonceInput): Promise<void> {
    const normalized = normalizeIssue(input);
    const result = await this.database.prepare(INSERT_FORM_NONCE).bind(
      normalized.nonce,
      normalized.shopDomain,
      normalized.shopifyCustomerId,
      normalized.bindingId,
      normalized.cycleKey,
      normalized.shipMonth,
      normalized.expectedRevision,
      normalized.issuedAt,
      normalized.expiresAt,
    ).run();
    if (result.meta?.changes !== 1) {
      throw new Error("The staging form nonce could not be issued.");
    }
  }

  async consume(input: ConsumeStagingProfileQueueFormNonceInput): Promise<void> {
    let normalized: ReturnType<typeof normalizeConsume>;
    try {
      normalized = normalizeConsume(input);
    } catch {
      throw denied();
    }
    const result = await this.database.prepare(CONSUME_FORM_NONCE).bind(
      normalized.consumedAt,
      normalized.nonce,
      normalized.shopDomain,
      normalized.shopifyCustomerId,
      normalized.bindingId,
      normalized.cycleKey,
      normalized.shipMonth,
      normalized.expectedRevision,
      normalized.consumedAt,
    ).run();
    if (result.meta?.changes !== 1) throw denied();
  }
}

function normalizeIssue(input: IssueStagingProfileQueueFormNonceInput) {
  const normalized = normalizeShared(input);
  const issuedAt = asIsoTimestamp(input.issuedAt);
  const expiresAt = asIsoTimestamp(input.expiresAt);
  if (expiresAt <= issuedAt) {
    throw new Error("The staging form nonce expiry must be after issuance.");
  }
  return { ...normalized, expiresAt, issuedAt };
}

function normalizeConsume(input: ConsumeStagingProfileQueueFormNonceInput) {
  return { ...normalizeShared(input), consumedAt: asIsoTimestamp(input.consumedAt) };
}

function normalizeShared(input: {
  readonly bindingId: string;
  readonly cycleKey: string;
  readonly expectedRevision: number;
  readonly nonce: string;
  readonly shipMonth: string;
  readonly shopDomain: string;
  readonly shopifyCustomerId: string;
}) {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(input.shopDomain)) {
    throw new Error("The staging form nonce shop is invalid.");
  }
  if (!/^[1-9]\d*$/.test(input.shopifyCustomerId)) {
    throw new Error("The staging form nonce customer is invalid.");
  }
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new Error("The staging form nonce revision is invalid.");
  }
  return {
    bindingId: asBindingId(input.bindingId),
    cycleKey: asCycleKey(input.cycleKey),
    expectedRevision: input.expectedRevision,
    nonce: asStagingProfileQueueFormNonce(input.nonce),
    shipMonth: asShipMonth(input.shipMonth),
    shopDomain: input.shopDomain,
    shopifyCustomerId: input.shopifyCustomerId,
  };
}

function denied(): ProfileQueueFormNonceDeniedError {
  return new ProfileQueueFormNonceDeniedError("The Profile Queue form is expired or has already been used.");
}
