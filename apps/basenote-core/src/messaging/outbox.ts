import { createHash } from "node:crypto";

import {
  asIdempotencyKey,
  asIsoTimestamp,
  asMessageIntentId,
  asMessagingEventId,
  asMessagingProfileId,
  asMessageStatusReason,
  asTemplateKey,
  compareIsoTimestamps,
  type IdempotencyKey,
  type IsoTimestamp,
  type MessageIntent,
  type MessageIntentId,
  type MessageOutboxStatus,
  type MessagePurpose,
  type MessageStatusReason,
  type MessagingEventId,
  type MessagingProfileId,
} from "./contracts.js";

/**
 * A caller-owned decision made immediately before a delivery adapter would be
 * allowed to act. This module intentionally does not infer consent, sender
 * identity, or any other eligibility rule.
 */
export type DeliveryEligibility =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: string };

type NormalizedDeliveryEligibility =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: MessageStatusReason };

/** Content-free input for an eventual message delivery. */
export interface EnqueueMessageIntentInput {
  readonly eventId?: string | null;
  readonly idempotencyKey: string;
  readonly profileId: string;
  readonly purpose: MessagePurpose;
  readonly templateKey: string;
}

/** A fresh, explicit eligibility decision is required to leave PENDING. */
export interface ClaimMessageIntentInput {
  readonly eligibility: DeliveryEligibility;
  readonly intentId: string;
}

/** Suppression can interrupt a pending or claimed delivery without sending it. */
export interface SuppressMessageIntentInput {
  readonly eligibility: Extract<DeliveryEligibility, { readonly eligible: false }>;
  readonly intentId: string;
}

export interface MessageOutboxOptions {
  /** Inject a deterministic clock in tests; defaults to the system clock. */
  readonly clock?: () => Date;
}

export class MessageOutboxIdempotencyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageOutboxIdempotencyConflictError";
  }
}

export class MessageOutboxTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageOutboxTransitionError";
  }
}

interface NormalizedEnqueueMessageIntentInput {
  readonly eventId: MessagingEventId | null;
  readonly idempotencyKey: IdempotencyKey;
    readonly profileId: MessagingProfileId;
  readonly purpose: MessagePurpose;
  readonly templateKey: string;
}

interface StoredMessageIntent {
  readonly intent: MessageIntent;
}

const MESSAGE_PURPOSES: ReadonlySet<MessagePurpose> = new Set([
  "MARKETING",
  "TRANSACTIONAL",
  "INTERNAL_ALERT",
]);

/**
 * A deliberately local delivery-intent state machine.
 *
 * It has no recipient resolver, template renderer, sender, retry loop,
 * persistence, secret, or network dependency. A future delivery adapter must
 * obtain a fresh explicit eligibility decision and use a claimed intent as its
 * own boundary before it performs any external work.
 */
export class InMemoryMessageOutbox {
  private readonly clock: () => Date;
  private readonly intents = new Map<MessageIntentId, StoredMessageIntent>();
  private readonly intentByIdempotencyKey = new Map<IdempotencyKey, MessageIntentId>();

  constructor(options: MessageOutboxOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
  }

  /**
   * Adds one PENDING delivery intent, or returns the existing intent for an
   * exact idempotency replay. A reused key with a different immutable message
   * envelope is rejected rather than silently retargeting a message.
   */
  enqueue(input: EnqueueMessageIntentInput): MessageIntent {
    const normalized = normalizeEnqueueInput(input);
    const existingId = this.intentByIdempotencyKey.get(normalized.idempotencyKey);
    if (existingId) {
      const existing = this.requireIntent(existingId);
      if (!hasSameEnvelope(existing, normalized)) {
        throw new MessageOutboxIdempotencyConflictError(
          "An idempotency key cannot be reused for a different message intent.",
        );
      }
      return cloneIntent(existing);
    }

    const id = deterministicIntentId(normalized.idempotencyKey);
    const collision = this.intents.get(id);
    if (collision && collision.intent.idempotencyKey !== normalized.idempotencyKey) {
      throw new MessageOutboxIdempotencyConflictError(
        "Deterministic message intent ID collision; refusing to overwrite an existing intent.",
      );
    }

    const now = this.now();
    const intent: MessageIntent = {
      id,
      idempotencyKey: normalized.idempotencyKey,
      profileId: normalized.profileId,
      eventId: normalized.eventId,
      purpose: normalized.purpose,
      templateKey: normalized.templateKey,
      status: "PENDING",
      statusReason: null,
      createdAt: now,
      updatedAt: now,
    };
    this.intents.set(id, { intent });
    this.intentByIdempotencyKey.set(normalized.idempotencyKey, id);
    return cloneIntent(intent);
  }

  get(intentId: string): MessageIntent | null {
    const intent = this.intents.get(asMessageIntentId(intentId))?.intent;
    return intent ? cloneIntent(intent) : null;
  }

  list(): MessageIntent[] {
    return [...this.intents.values()]
      .map(({ intent }) => intent)
      .sort((left, right) => {
        const byCreatedAt = compareIsoTimestamps(left.createdAt, right.createdAt);
        return byCreatedAt === 0 ? left.id.localeCompare(right.id) : byCreatedAt;
      })
      .map(cloneIntent);
  }

  /**
   * Transitions PENDING to CLAIMED only when the caller explicitly says the
   * intent is eligible. An explicit ineligible decision instead transitions
   * PENDING directly to SUPPRESSED. The reason is caller-owned and is neither
   * interpreted nor persisted by this content-free outbox.
   */
  claim(input: ClaimMessageIntentInput): MessageIntent {
    const intent = this.requireIntent(asMessageIntentId(input.intentId));
    this.requireStatus(intent, ["PENDING"], "claim");
    const eligibility = normalizeEligibility(input.eligibility);
    return eligibility.eligible
      ? this.transition(intent, "CLAIMED", null)
      : this.transition(intent, "SUPPRESSED", eligibility.reason);
  }

  /** Records that an external adapter completed a claimed delivery. */
  markSent(intentId: string): MessageIntent {
    const intent = this.requireIntent(asMessageIntentId(intentId));
    this.requireStatus(intent, ["CLAIMED"], "mark as sent");
    return this.transition(intent, "SENT", null);
  }

  /**
   * Records a terminal failed attempt. There is intentionally no retry or
   * reset transition: a human-approved future workflow must create a distinct
   * intent if a failed message should ever be reconsidered.
   */
  markFailed(intentId: string, reason: string): MessageIntent {
    const intent = this.requireIntent(asMessageIntentId(intentId));
    this.requireStatus(intent, ["CLAIMED"], "mark as failed");
    return this.transition(intent, "FAILED", asMessageStatusReason(reason));
  }

  /**
   * Stops a PENDING or CLAIMED intent upon an explicit ineligible decision.
   * Terminal intents cannot be changed or implicitly retried.
   */
  suppress(input: SuppressMessageIntentInput): MessageIntent {
    const intent = this.requireIntent(asMessageIntentId(input.intentId));
    this.requireStatus(intent, ["PENDING", "CLAIMED"], "suppress");
    const eligibility = normalizeEligibility(input.eligibility);
    if (eligibility.eligible) {
      throw new MessageOutboxTransitionError("Suppression requires an explicit ineligible decision.");
    }
    return this.transition(intent, "SUPPRESSED", eligibility.reason);
  }

  private requireIntent(id: MessageIntentId): MessageIntent {
    const intent = this.intents.get(id)?.intent;
    if (!intent) throw new MessageOutboxTransitionError(`Message intent ${id} was not found.`);
    return intent;
  }

  private requireStatus(
    intent: MessageIntent,
    expected: readonly MessageOutboxStatus[],
    action: string,
  ): void {
    if (!expected.includes(intent.status)) {
      throw new MessageOutboxTransitionError(
        `Cannot ${action} a ${intent.status} message intent; expected ${expected.join(" or ")}.`,
      );
    }
  }

  private transition(
    intent: MessageIntent,
    status: MessageOutboxStatus,
    statusReason: MessageStatusReason | null,
  ): MessageIntent {
    const updated: MessageIntent = {
      ...intent,
      status,
      statusReason,
      updatedAt: this.now(),
    };
    this.intents.set(updated.id, { intent: updated });
    return cloneIntent(updated);
  }

  private now(): IsoTimestamp {
    const date = this.clock();
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new Error("Message outbox clock must return a valid Date.");
    }
    return asIsoTimestamp(date.toISOString());
  }
}

function normalizeEnqueueInput(input: EnqueueMessageIntentInput): NormalizedEnqueueMessageIntentInput {
  if (!isMessagePurpose(input.purpose)) {
    throw new Error("purpose must be MARKETING, TRANSACTIONAL, or INTERNAL_ALERT.");
  }
  return {
    idempotencyKey: asIdempotencyKey(input.idempotencyKey),
    profileId: asMessagingProfileId(input.profileId),
    eventId: input.eventId === null || input.eventId === undefined ? null : asMessagingEventId(input.eventId),
    purpose: input.purpose,
    templateKey: asTemplateKey(input.templateKey),
  };
}

function normalizeEligibility(input: DeliveryEligibility): NormalizedDeliveryEligibility {
  if (!input || typeof input !== "object" || typeof input.eligible !== "boolean") {
    throw new Error("An explicit delivery eligibility decision is required.");
  }
  if (input.eligible) return { eligible: true };
  if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
    throw new Error("An ineligible delivery decision requires a non-empty caller-provided reason.");
  }
  return { eligible: false, reason: asMessageStatusReason(input.reason) };
}

function hasSameEnvelope(
  intent: MessageIntent,
  input: NormalizedEnqueueMessageIntentInput,
): boolean {
  return intent.profileId === input.profileId
    && intent.eventId === input.eventId
    && intent.purpose === input.purpose
    && intent.templateKey === input.templateKey;
}

function deterministicIntentId(idempotencyKey: IdempotencyKey): MessageIntentId {
  const digest = createHash("sha256")
    .update("basenote.messaging.outbox.v1\u0000")
    .update(idempotencyKey)
    .digest("hex");
  return asMessageIntentId(`msg_${digest}`);
}

function isMessagePurpose(value: unknown): value is MessagePurpose {
  return typeof value === "string" && MESSAGE_PURPOSES.has(value as MessagePurpose);
}

function cloneIntent(intent: MessageIntent): MessageIntent {
  return { ...intent };
}
