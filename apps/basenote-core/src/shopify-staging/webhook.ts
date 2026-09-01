import { createHmac, timingSafeEqual } from "node:crypto";

import type { ShopifyShopDomain } from "../auth/app-proxy.js";

const SHOP_DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/;
const TOPIC = /^[a-z0-9][a-z0-9_/-]{0,127}$/;
const DELIVERY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const BASE64_SHA256 = /^[A-Za-z0-9+/]{43}=$/;

export type ShopifyWebhookVerificationErrorCode =
  | "invalid_input"
  | "missing_hmac"
  | "malformed_hmac"
  | "invalid_hmac"
  | "missing_metadata"
  | "malformed_metadata"
  | "shop_mismatch";

/**
 * This error intentionally omits raw webhook bodies, signatures, and secrets.
 * Route adapters should log only a request correlation ID and this stable code.
 */
export class ShopifyWebhookVerificationError extends Error {
  override name = "ShopifyWebhookVerificationError";

  constructor(
    readonly code: ShopifyWebhookVerificationErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface VerifyShopifyWebhookInput {
  /** Raw bytes exactly as received. Parse JSON only after this verifier returns. */
  readonly rawBody: Uint8Array;
  /** Value of `X-Shopify-Hmac-SHA256`; never read from JSON. */
  readonly hmacHeader: string | null | undefined;
  /** Client secret injected by a secret manager, never browser or source input. */
  readonly appClientSecret: string;
  /** Value of `X-Shopify-Shop-Domain`. */
  readonly shopHeader: string | null | undefined;
  /** Value of `X-Shopify-Topic`. */
  readonly topicHeader: string | null | undefined;
  /** Value of `X-Shopify-Webhook-Id`; used to deduplicate after verification. */
  readonly deliveryIdHeader: string | null | undefined;
  /** Single development-store domain expected by the staging deployment. */
  readonly expectedShop: string;
}

export interface VerifiedShopifyWebhook {
  readonly deliveryId: string;
  readonly shop: ShopifyShopDomain;
  readonly topic: string;
}

/**
 * Verifies a Shopify HTTPS webhook before reading topic/shop metadata or JSON.
 * This module has no HTTP client, persistence import, or delivery side effect.
 */
export function verifyShopifyWebhook(
  input: VerifyShopifyWebhookInput,
): VerifiedShopifyWebhook {
  assertInput(input);
  verifyRawBodyHmac(input.rawBody, input.hmacHeader, input.appClientSecret);

  // Metadata is untrusted until the body HMAC has been established above.
  const shop = parseShop(readRequiredHeader(input.shopHeader, "shop"));
  const expectedShop = parseShop(input.expectedShop);
  if (shop !== expectedShop) {
    throw new ShopifyWebhookVerificationError("shop_mismatch", "Webhook is for another shop.");
  }

  const topic = readRequiredHeader(input.topicHeader, "topic");
  if (!TOPIC.test(topic)) {
    throw new ShopifyWebhookVerificationError("malformed_metadata", "Webhook topic is malformed.");
  }

  const deliveryId = readRequiredHeader(input.deliveryIdHeader, "delivery ID");
  if (!DELIVERY_ID.test(deliveryId)) {
    throw new ShopifyWebhookVerificationError("malformed_metadata", "Webhook delivery ID is malformed.");
  }

  return { deliveryId, shop, topic };
}

/**
 * Raw HMAC primitive for framework adapters that use Shopify's maintained
 * library for metadata handling. It is exported to make raw-body preservation
 * testable; callers must still verify and deduplicate before parsing.
 */
export function verifyRawBodyHmac(
  rawBody: Uint8Array,
  hmacHeader: string | null | undefined,
  appClientSecret: string,
): void {
  if (!(rawBody instanceof Uint8Array) || typeof appClientSecret !== "string" || appClientSecret.length === 0) {
    throw new ShopifyWebhookVerificationError("invalid_input", "Webhook verifier requires raw bytes and a secret.");
  }
  if (typeof hmacHeader !== "string" || hmacHeader.length === 0) {
    throw new ShopifyWebhookVerificationError("missing_hmac", "Webhook HMAC is missing.");
  }
  if (hmacHeader.trim() !== hmacHeader || !BASE64_SHA256.test(hmacHeader)) {
    throw new ShopifyWebhookVerificationError("malformed_hmac", "Webhook HMAC is malformed.");
  }

  const expected = createHmac("sha256", appClientSecret).update(rawBody).digest();
  const received = Buffer.from(hmacHeader, "base64");
  if (received.length !== expected.length || !timingSafeEqual(expected, received)) {
    throw new ShopifyWebhookVerificationError("invalid_hmac", "Webhook HMAC is invalid.");
  }
}

function assertInput(input: VerifyShopifyWebhookInput): void {
  if (!input || typeof input !== "object") {
    throw new ShopifyWebhookVerificationError("invalid_input", "Webhook verifier input is invalid.");
  }
}

function readRequiredHeader(value: string | null | undefined, name: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new ShopifyWebhookVerificationError("missing_metadata", `Webhook ${name} is missing.`);
  }
  return value;
}

function parseShop(value: string): ShopifyShopDomain {
  if (!SHOP_DOMAIN.test(value)) {
    throw new ShopifyWebhookVerificationError("malformed_metadata", "Webhook shop domain is malformed.");
  }
  return value as ShopifyShopDomain;
}
