import { StagingAdminIdTokenReplayError } from "./boundaries.js";
import type { StagingAdminTokenReplayRepository } from "./contracts.js";
import { asIsoTimestamp, compareIsoTimestamps } from "../queue/types.js";
import type { D1DatabasePort } from "../staging-runtime/d1.js";

const TOKEN_DIGEST = /^[A-Za-z0-9_-]{43}$/;

/**
 * D1-backed one-time guard for unsafe embedded Admin POSTs. It receives only
 * a SHA-256 digest of Shopify's random `jti`, never the bearer JWT, raw nonce,
 * staff subject, email, or name. Duplicate inserts fail closed.
 */
export class D1StagingAdminIdTokenReplayRepository implements StagingAdminTokenReplayRepository {
  constructor(private readonly database: D1DatabasePort) {}

  async consume(input: {
    readonly consumedAt: string;
    readonly tokenDigest: string;
    readonly tokenExpiresAt: string;
  }): Promise<void> {
    validateReplayInput(input);
    try {
      const result = await this.database.prepare(`
        INSERT INTO staging_admin_id_token_replays (token_digest, expires_at, consumed_at)
        VALUES (?, ?, ?)`)
        .bind(input.tokenDigest, input.tokenExpiresAt, input.consumedAt)
        .run();
      if (result.meta?.changes !== 1) {
        throw new StagingAdminIdTokenReplayError("The Shopify Admin ID token has already been used for a write.");
      }
    } catch (error) {
      if (error instanceof StagingAdminIdTokenReplayError) throw error;
      // SQLite/D1 reports a duplicate primary-key error as a rejected write;
      // do not expose its detail or let the caller retry an unsafe token.
      throw new StagingAdminIdTokenReplayError("The Shopify Admin ID token has already been used for a write.");
    }
  }
}

/** In-memory test double; it has no Cloudflare or provider connection. */
export class InMemoryStagingAdminIdTokenReplayRepository implements StagingAdminTokenReplayRepository {
  private readonly consumed = new Set<string>();

  async consume(input: {
    readonly consumedAt: string;
    readonly tokenDigest: string;
    readonly tokenExpiresAt: string;
  }): Promise<void> {
    validateReplayInput(input);
    if (this.consumed.has(input.tokenDigest)) {
      throw new StagingAdminIdTokenReplayError("The Shopify Admin ID token has already been used for a write.");
    }
    this.consumed.add(input.tokenDigest);
  }
}

function validateReplayInput(input: {
  readonly consumedAt: string;
  readonly tokenDigest: string;
  readonly tokenExpiresAt: string;
}): void {
  if (!TOKEN_DIGEST.test(input.tokenDigest)) {
    throw new StagingAdminIdTokenReplayError("The Shopify Admin ID token replay digest is invalid.");
  }
  const consumedAt = asIsoTimestamp(input.consumedAt);
  const expiresAt = asIsoTimestamp(input.tokenExpiresAt);
  if (compareIsoTimestamps(expiresAt, consumedAt) <= 0) {
    throw new StagingAdminIdTokenReplayError("The Shopify Admin ID token is already expired.");
  }
}
