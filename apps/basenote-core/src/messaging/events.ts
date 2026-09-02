import {
  asIdempotencyKey,
  asIsoTimestamp,
  asMessagingEventId,
  asMessagingProfileId,
  type IdempotencyKey,
  type IsoTimestamp,
  type MessagingEvent,
  type MessagingEventId,
  type MessagingEventSource,
  type MessagingEventType,
  type MessagingProfileId,
  type SafeEventAttribute,
} from "./contracts.js";

/**
 * The canonical, local audit record for a safe messaging event.
 *
 * It contains an opaque profile reference only. Recipient resolution, consent
 * checks, template rendering, and delivery must remain outside this ledger.
 */
export interface RecordedMessagingEvent extends MessagingEvent {
  readonly eventId: MessagingEventId;
  readonly idempotencyKey: IdempotencyKey;
  /** The ledger's timestamp, distinct from the source event's occurredAt. */
  readonly recordedAt: IsoTimestamp;
}

/**
 * Boundary input intentionally uses unknown for fields received from a route
 * or a webhook decoder. The ledger validates every value before recording it.
 */
export interface RecordMessagingEventInput {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly profileId: string;
  readonly occurredAt: string;
  readonly source: unknown;
  readonly type: unknown;
  readonly attributes: unknown;
}

export type RecordMessagingEventResult =
  | { readonly outcome: "RECORDED"; readonly event: RecordedMessagingEvent }
  | { readonly outcome: "DEDUPLICATED"; readonly event: RecordedMessagingEvent };

export interface MessagingEventLedgerOptions {
  /** Inject a deterministic clock for tests. The default is the system clock. */
  readonly clock?: () => Date;
}

export class MessagingEventLedgerError extends Error {
  override name = "MessagingEventLedgerError";
}

export class MessagingEventValidationError extends MessagingEventLedgerError {
  override name = "MessagingEventValidationError";
}

export class MessagingEventIdempotencyConflictError extends MessagingEventLedgerError {
  override name = "MessagingEventIdempotencyConflictError";
}

const EVENT_SOURCES = ["STOREFRONT", "SHOPIFY_WEBHOOK", "BASE_NOTE_SYSTEM"] as const;
const EVENT_TYPES = [
  "QUIZ_COMPLETED",
  "QUEUE_SELECTION_CHANGED",
  "QUEUE_SELECTION_REMOVED",
  "CANCELLATION_REQUESTED",
  "RETENTION_REQUESTED",
  "SUBSCRIPTION_CREATED",
  "SUBSCRIPTION_CANCELLED",
  "SUBSCRIPTION_BILLING_SUCCEEDED",
  "SUBSCRIPTION_BILLING_FAILED",
  "ORDER_PAID",
] as const;

const STOREFRONT_EVENT_TYPES = new Set<MessagingEventType>([
  "QUIZ_COMPLETED",
  "QUEUE_SELECTION_CHANGED",
  "QUEUE_SELECTION_REMOVED",
  "CANCELLATION_REQUESTED",
  "RETENTION_REQUESTED",
]);

const SHOPIFY_WEBHOOK_EVENT_TYPES = new Set<MessagingEventType>([
  "SUBSCRIPTION_CREATED",
  "SUBSCRIPTION_CANCELLED",
  "SUBSCRIPTION_BILLING_SUCCEEDED",
  "SUBSCRIPTION_BILLING_FAILED",
  "ORDER_PAID",
]);

const ATTRIBUTE_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const SAFE_STRING_ATTRIBUTE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const SENSITIVE_ATTRIBUTE_KEY = /(?:^|_)(?:address|answer|city|cookie|country|customer|email|first_name|ip|last_name|mail|message|mobile|name|note|phone|postal|profile|session|state|street|user_agent|zip)(?:_|$)/;
const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SHOPIFY_CUSTOMER_GID = /^gid:\/\/shopify\/Customer\//;
const MAX_ATTRIBUTE_COUNT = 24;

/** Runtime guard for the closed MessagingEventSource catalog. */
export function isMessagingEventSource(value: unknown): value is MessagingEventSource {
  return typeof value === "string" && (EVENT_SOURCES as readonly string[]).includes(value);
}

/** Runtime guard for the closed MessagingEventType catalog. */
export function isMessagingEventType(value: unknown): value is MessagingEventType {
  return typeof value === "string" && (EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Validates and copies the deliberately tiny event attribute shape.
 *
 * The ledger accepts categorical and opaque-reference values only. It rejects
 * nested data, raw contact-shaped fields, raw customer GIDs, free-form text,
 * and common PII attribute names. New safe fields should be added through a
 * reviewed contract change instead of smuggling customer data into an event.
 */
export function validateSafeEventAttributes(
  value: unknown,
): Readonly<Record<string, SafeEventAttribute>> {
  if (!isPlainRecord(value)) {
    throw new MessagingEventValidationError("event attributes must be a plain object.");
  }

  const entries = Object.entries(value);
  if (entries.length > MAX_ATTRIBUTE_COUNT) {
    throw new MessagingEventValidationError(
      `event attributes may contain at most ${MAX_ATTRIBUTE_COUNT} fields.`,
    );
  }

  const attributes: Record<string, SafeEventAttribute> = {};
  for (const [key, attribute] of entries) {
    if (!ATTRIBUTE_KEY.test(key) || SENSITIVE_ATTRIBUTE_KEY.test(key)) {
      throw new MessagingEventValidationError(`event attribute ${JSON.stringify(key)} is not safe.`);
    }
    if (!isSafeEventAttribute(attribute)) {
      throw new MessagingEventValidationError(
        `event attribute ${JSON.stringify(key)} must be a safe scalar value.`,
      );
    }
    attributes[key] = attribute;
  }

  return Object.freeze(attributes);
}

/**
 * Pure, in-memory event ledger. It has no persistence, external adapter,
 * recipient lookup, email sending, or customer-authorisation logic. A future
 * route must authorise the caller before it retrieves a profile's events.
 */
export class InMemoryMessagingEventLedger {
  private readonly eventsById = new Map<MessagingEventId, RecordedMessagingEvent>();
  private readonly eventsByIdempotencyKey = new Map<IdempotencyKey, RecordedMessagingEvent>();
  private readonly eventsByProfile = new Map<MessagingProfileId, RecordedMessagingEvent[]>();
  private readonly clock: () => Date;

  constructor(options: MessagingEventLedgerOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
  }

  /** Number of immutable records currently held by this local-only ledger. */
  get size(): number {
    return this.eventsById.size;
  }

  /**
   * Appends one validated event or returns the matching immutable record when
   * both its event ID and idempotency key refer to the exact same payload.
   * Reusing either identifier for a different payload is a hard conflict.
   */
  record(input: RecordMessagingEventInput): RecordMessagingEventResult {
    const candidate = normalizeEvent(input, this.recordedNow());
    const byEventId = this.eventsById.get(candidate.eventId);
    const byIdempotencyKey = this.eventsByIdempotencyKey.get(candidate.idempotencyKey);

    if (byEventId || byIdempotencyKey) {
      if (byEventId && byIdempotencyKey && byEventId !== byIdempotencyKey) {
        throw new MessagingEventIdempotencyConflictError(
          "event ID and idempotency key refer to different immutable events.",
        );
      }

      const existing = byEventId ?? byIdempotencyKey;
      if (!existing || !sameImmutableEvent(existing, candidate)) {
        throw new MessagingEventIdempotencyConflictError(
          "event ID or idempotency key has already been used for a different event.",
        );
      }
      return { outcome: "DEDUPLICATED", event: cloneEvent(existing) };
    }

    const stored = freezeEvent(candidate);
    this.eventsById.set(stored.eventId, stored);
    this.eventsByIdempotencyKey.set(stored.idempotencyKey, stored);
    const profileEvents = this.eventsByProfile.get(stored.profileId) ?? [];
    profileEvents.push(stored);
    this.eventsByProfile.set(stored.profileId, profileEvents);

    return { outcome: "RECORDED", event: cloneEvent(stored) };
  }

  /** Returns one defensive copy by opaque event ID, or null when absent. */
  getEvent(eventId: string): RecordedMessagingEvent | null {
    const stored = this.eventsById.get(asMessagingEventId(eventId));
    return stored ? cloneEvent(stored) : null;
  }

  /**
   * Returns a profile's audit records in append order. It never performs a
   * global profile search and it never resolves an email address or other PII.
   */
  listEventsForProfile(profileId: string): readonly RecordedMessagingEvent[] {
    const stored = this.eventsByProfile.get(asMessagingProfileId(profileId)) ?? [];
    return Object.freeze(stored.map(cloneEvent));
  }

  private recordedNow(): IsoTimestamp {
    const now = this.clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw new MessagingEventLedgerError("ledger clock must return a valid Date.");
    }
    return asIsoTimestamp(now.toISOString());
  }
}

function normalizeEvent(
  input: RecordMessagingEventInput,
  recordedAt: IsoTimestamp,
): RecordedMessagingEvent {
  const source = assertEventSource(input.source);
  const type = assertEventType(input.type);
  assertSourceMayRecordType(source, type);

  return {
    eventId: asMessagingEventId(input.eventId),
    idempotencyKey: asIdempotencyKey(input.idempotencyKey),
    profileId: asMessagingProfileId(input.profileId),
    occurredAt: asIsoTimestamp(input.occurredAt),
    source,
    type,
    attributes: validateSafeEventAttributes(input.attributes),
    recordedAt,
  };
}

function assertEventSource(value: unknown): MessagingEventSource {
  if (!isMessagingEventSource(value)) {
    throw new MessagingEventValidationError("event source is not in the safe source catalog.");
  }
  return value;
}

function assertEventType(value: unknown): MessagingEventType {
  if (!isMessagingEventType(value)) {
    throw new MessagingEventValidationError("event type is not in the safe event catalog.");
  }
  return value;
}

function assertSourceMayRecordType(source: MessagingEventSource, type: MessagingEventType): void {
  if (source === "BASE_NOTE_SYSTEM") return;
  const permittedTypes = source === "STOREFRONT"
    ? STOREFRONT_EVENT_TYPES
    : SHOPIFY_WEBHOOK_EVENT_TYPES;
  if (!permittedTypes.has(type)) {
    throw new MessagingEventValidationError(
      `event type ${type} is not permitted from source ${source}.`,
    );
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSafeEventAttribute(value: unknown): value is SafeEventAttribute {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  return isSafeOpaqueString(value);
}

function isSafeOpaqueString(value: string): boolean {
  if (!SAFE_STRING_ATTRIBUTE.test(value)) return false;
  if (EMAIL_ADDRESS.test(value) || SHOPIFY_CUSTOMER_GID.test(value)) return false;
  return !isLikelyPhoneNumber(value);
}

function isLikelyPhoneNumber(value: string): boolean {
  if (!/^[+(). -]*\d[+(). \d-]*$/.test(value)) return false;
  return (value.match(/\d/g)?.length ?? 0) >= 7;
}

function sameImmutableEvent(left: RecordedMessagingEvent, right: RecordedMessagingEvent): boolean {
  return left.eventId === right.eventId
    && left.idempotencyKey === right.idempotencyKey
    && left.profileId === right.profileId
    && left.occurredAt === right.occurredAt
    && left.source === right.source
    && left.type === right.type
    && sameAttributes(left.attributes, right.attributes);
}

function sameAttributes(
  left: Readonly<Record<string, SafeEventAttribute>>,
  right: Readonly<Record<string, SafeEventAttribute>>,
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;

  for (let index = 0; index < leftKeys.length; index += 1) {
    const key = leftKeys[index];
    if (!key || key !== rightKeys[index] || left[key] !== right[key]) return false;
  }
  return true;
}

function freezeEvent(event: RecordedMessagingEvent): RecordedMessagingEvent {
  return Object.freeze({
    ...event,
    attributes: Object.freeze({ ...event.attributes }),
  });
}

function cloneEvent(event: RecordedMessagingEvent): RecordedMessagingEvent {
  return freezeEvent(event);
}
