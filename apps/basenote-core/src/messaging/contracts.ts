/**
 * Base Note Messaging Core contracts.
 *
 * These types deliberately identify people by internal/profile references,
 * rather than storing raw email addresses in event or delivery records. A
 * future encrypted recipient resolver may map a profile to an address only at
 * delivery time, after consent and suppression checks have passed.
 */

export type MessagingProfileId = string & { readonly __brand: "MessagingProfileId" };
export type MessagingEventId = string & { readonly __brand: "MessagingEventId" };
export type MessageIntentId = string & { readonly __brand: "MessageIntentId" };
export type IdempotencyKey = string & { readonly __brand: "IdempotencyKey" };
export type IsoTimestamp = string & { readonly __brand: "IsoTimestamp" };

export type ConsentChannel = "EMAIL";
export type ConsentState = "SUBSCRIBED" | "UNSUBSCRIBED" | "SUPPRESSED" | "UNKNOWN";
export type ConsentSource =
  | "SHOPIFY"
  | "BASE_NOTE_FORM"
  | "KLAVIYO_IMPORT"
  | "CUSTOMER_UNSUBSCRIBE"
  | "HARD_BOUNCE"
  | "SPAM_COMPLAINT"
  | "MERCHANT_REVIEW";

export interface ConsentRecord {
  readonly channel: ConsentChannel;
  readonly eventId: MessagingEventId;
  readonly legalTextVersion: string | null;
  readonly occurredAt: IsoTimestamp;
  readonly profileId: MessagingProfileId;
  readonly source: ConsentSource;
  readonly state: ConsentState;
}

/** Current derived state plus the immutable record that established it. */
export interface ConsentSnapshot {
  readonly channel: ConsentChannel;
  readonly current: ConsentRecord;
  readonly profileId: MessagingProfileId;
}

/**
 * This list covers the existing browser-side Klaviyo hooks and the events
 * needed for future owned flows. It contains no raw customer or quiz answers.
 */
export type MessagingEventType =
  | "QUIZ_COMPLETED"
  | "QUEUE_SELECTION_CHANGED"
  | "QUEUE_SELECTION_REMOVED"
  | "CANCELLATION_REQUESTED"
  | "RETENTION_REQUESTED"
  | "SUBSCRIPTION_CREATED"
  | "SUBSCRIPTION_CANCELLED"
  | "SUBSCRIPTION_BILLING_SUCCEEDED"
  | "SUBSCRIPTION_BILLING_FAILED"
  | "ORDER_PAID";

export type MessagingEventSource = "STOREFRONT" | "SHOPIFY_WEBHOOK" | "BASE_NOTE_SYSTEM";
export type SafeEventAttribute = boolean | number | string | null;

export interface MessagingEvent {
  readonly attributes: Readonly<Record<string, SafeEventAttribute>>;
  readonly occurredAt: IsoTimestamp;
  readonly profileId: MessagingProfileId;
  readonly source: MessagingEventSource;
  readonly type: MessagingEventType;
}

export type MessagePurpose = "MARKETING" | "TRANSACTIONAL" | "INTERNAL_ALERT";
export type MessageOutboxStatus = "PENDING" | "CLAIMED" | "SENT" | "SUPPRESSED" | "FAILED";
export type MessageStatusReason = string & { readonly __brand: "MessageStatusReason" };

/**
 * A delivery intent is content-free. Template rendering and recipient lookup
 * belong to a future secure delivery adapter, never browser code.
 */
export interface MessageIntent {
  readonly createdAt: IsoTimestamp;
  readonly eventId: MessagingEventId | null;
  readonly id: MessageIntentId;
  readonly idempotencyKey: IdempotencyKey;
  readonly profileId: MessagingProfileId;
  readonly purpose: MessagePurpose;
  /** Safe categorical code only; never a provider payload or recipient data. */
  readonly statusReason: MessageStatusReason | null;
  readonly status: MessageOutboxStatus;
  readonly templateKey: string;
  readonly updatedAt: IsoTimestamp;
}

const PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const EVENT_ID = /^evt_[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const INTENT_ID = /^msg_[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const TEMPLATE_KEY = /^[a-z0-9][a-z0-9._-]{2,127}$/;
const STATUS_REASON = /^[A-Z][A-Z0-9_]{2,63}$/;

export function asMessagingProfileId(value: string): MessagingProfileId {
  if (!PROFILE_ID.test(value)) {
    throw new Error("profileId must be 3-128 URL-safe characters.");
  }
  return value as MessagingProfileId;
}

export function asMessagingEventId(value: string): MessagingEventId {
  if (!EVENT_ID.test(value)) {
    throw new Error("eventId must begin with evt_ and contain 12-128 URL-safe characters.");
  }
  return value as MessagingEventId;
}

export function asMessageIntentId(value: string): MessageIntentId {
  if (!INTENT_ID.test(value)) {
    throw new Error("message intent ID must begin with msg_ and contain 12-128 URL-safe characters.");
  }
  return value as MessageIntentId;
}

export function asIdempotencyKey(value: string): IdempotencyKey {
  if (!IDEMPOTENCY_KEY.test(value)) {
    throw new Error("idempotencyKey must be 8-200 URL-safe characters.");
  }
  return value as IdempotencyKey;
}

export function asIsoTimestamp(value: string): IsoTimestamp {
  if (!ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error("timestamp must be a valid UTC ISO-8601 value.");
  }
  return value as IsoTimestamp;
}

export function asTemplateKey(value: string): string {
  if (!TEMPLATE_KEY.test(value)) {
    throw new Error("templateKey must be 3-128 lowercase URL-safe characters.");
  }
  return value;
}

export function asMessageStatusReason(value: string): MessageStatusReason {
  if (!STATUS_REASON.test(value)) {
    throw new Error("message status reason must be a 3-64 character uppercase code.");
  }
  return value as MessageStatusReason;
}
