/**
 * Local, in-memory consent ledger.
 *
 * This module deliberately holds only opaque messaging profile references. It
 * has no recipient lookup, persistence, Shopify, Klaviyo, or network code.
 * A production repository must preserve the same append-only and suppression
 * semantics transactionally before a delivery adapter may rely on it.
 */

import {
  asIsoTimestamp,
  asMessagingEventId,
  asMessagingProfileId,
  type ConsentChannel,
  type ConsentRecord,
  type ConsentSnapshot,
  type ConsentSource,
  type ConsentState,
  type IsoTimestamp,
  type MessagingEventId,
  type MessagingProfileId,
} from "./contracts.js";

const CHANNELS = new Set<ConsentChannel>(["EMAIL"]);
const STATES = new Set<ConsentState>(["SUBSCRIBED", "UNSUBSCRIBED", "SUPPRESSED", "UNKNOWN"]);
const SOURCES = new Set<ConsentSource>([
  "SHOPIFY",
  "BASE_NOTE_FORM",
  "KLAVIYO_IMPORT",
  "CUSTOMER_UNSUBSCRIBE",
  "HARD_BOUNCE",
  "SPAM_COMPLAINT",
  "MERCHANT_REVIEW",
]);

/** Opaque audit IDs only; this intentionally rejects email addresses and prose. */
const REFERENCE = /^(?:review|case)_[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const LEGAL_TEXT_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type ConsentEventKind = "CONSENT" | "SUPPRESSION_RELEASE";

/**
 * Immutable audit entry. A release remains an unsubscribe until the customer
 * provides a later eligible opt-in; it never silently turns into consent.
 */
export interface ConsentLedgerEvent {
  readonly kind: ConsentEventKind;
  readonly record: ConsentRecord;
  /** Opaque merchant-review audit ID; always null for ordinary consent events. */
  readonly reviewReference: string | null;
}

/**
 * This deliberately separate input makes a permanent-suppression release a
 * conspicuous privileged action at the future route boundary.
 */
export interface SuppressionReleaseInput {
  readonly channel: ConsentChannel;
  readonly eventId: MessagingEventId;
  readonly occurredAt: IsoTimestamp;
  readonly profileId: MessagingProfileId;
  readonly reviewReference: string;
}

export type ConsentRejectionReason =
  | "invalid_record"
  | "invalid_profile_id"
  | "invalid_event_id"
  | "invalid_channel"
  | "invalid_state"
  | "invalid_source"
  | "invalid_timestamp"
  | "invalid_legal_text_version"
  | "subscription_requires_legal_text_version"
  | "invalid_source_state"
  | "merchant_review_requires_release_path"
  | "invalid_review_reference"
  | "release_requires_active_suppression"
  | "event_id_conflict";

export type ConsentAppendResult =
  | {
      readonly outcome: "APPLIED";
      readonly event: ConsentLedgerEvent;
      readonly snapshot: ConsentSnapshot | null;
    }
  | {
      readonly outcome: "BLOCKED_BY_SUPPRESSION";
      readonly event: ConsentLedgerEvent;
      readonly snapshot: ConsentSnapshot;
    }
  | {
      readonly outcome: "IDEMPOTENT";
      readonly event: ConsentLedgerEvent;
      readonly snapshot: ConsentSnapshot | null;
    }
  | {
      readonly outcome: "REJECTED";
      readonly reason: ConsentRejectionReason;
      readonly snapshot: ConsentSnapshot | null;
    };

interface Derivation {
  readonly blockedEventIds: ReadonlySet<MessagingEventId>;
  readonly current: ConsentRecord | null;
}

type RecordNormalization =
  | { readonly ok: true; readonly record: ConsentRecord }
  | { readonly ok: false; readonly reason: ConsentRejectionReason };

type ReleaseNormalization =
  | { readonly ok: true; readonly event: ConsentLedgerEvent }
  | { readonly ok: false; readonly reason: ConsentRejectionReason };

/**
 * An append-only, local implementation of consent state.
 *
 * Events are ordered by occurredAt when deriving a current snapshot, not by
 * arrival order. That lets a late historical import be preserved without
 * overwriting a newer unsubscribe or suppression. A SUPPRESSED event is a
 * latch: ordinary events are retained for audit but cannot clear it. The only
 * release path is releaseSuppression(), which records an explicit merchant
 * review as UNSUBSCRIBED and still requires a later fresh opt-in.
 */
export class InMemoryConsentLedger {
  private readonly eventById = new Map<MessagingEventId, ConsentLedgerEvent>();
  private readonly eventsByProfileChannel = new Map<string, ConsentLedgerEvent[]>();
  private readonly snapshots = new Map<string, ConsentSnapshot>();

  /**
   * Validates and appends an ordinary consent/suppression event. It never
   * throws for malformed runtime input and it never mutates state on reject.
   */
  record(input: unknown): ConsentAppendResult {
    let normalized: RecordNormalization;
    try {
      normalized = normalizeConsentRecord(input);
    } catch {
      return rejectedWithoutSnapshot("invalid_record");
    }
    if (!normalized.ok) return this.rejected(normalized.reason, input);

    const event = freezeEvent({
      kind: "CONSENT",
      record: normalized.record,
      reviewReference: null,
    });
    return this.append(event);
  }

  /**
   * Releases an existing suppression only after a specifically identified
   * merchant review. The release state is UNSUBSCRIBED, never SUBSCRIBED.
   */
  releaseSuppression(input: unknown): ConsentAppendResult {
    let normalized: ReleaseNormalization;
    try {
      normalized = normalizeSuppressionRelease(input);
    } catch {
      return rejectedWithoutSnapshot("invalid_record");
    }
    if (!normalized.ok) return this.rejected(normalized.reason, input);

    const existing = this.eventById.get(normalized.event.record.eventId);
    if (existing) return this.resolveDuplicate(existing, normalized.event);

    const key = profileChannelKey(normalized.event.record.profileId, normalized.event.record.channel);
    const priorEvents = this.eventsByProfileChannel.get(key) ?? [];
    if (!hasActiveSuppressionAt(priorEvents, normalized.event.record)) {
      return {
        outcome: "REJECTED",
        reason: "release_requires_active_suppression",
        snapshot: this.snapshotForKey(key),
      };
    }

    return this.appendNew(key, normalized.event);
  }

  /** Returns a defensive immutable copy of the current state, or null. */
  getSnapshot(profileId: string, channel: ConsentChannel = "EMAIL"): ConsentSnapshot | null {
    if (!isValidProfileId(profileId) || !CHANNELS.has(channel)) return null;
    return this.snapshotForKey(profileChannelKey(profileId as MessagingProfileId, channel));
  }

  /**
   * Returns append-only event history in causal order. Callers receive copies,
   * so modifying a returned object cannot change ledger state.
   */
  listEvents(profileId: string, channel: ConsentChannel = "EMAIL"): readonly ConsentLedgerEvent[] {
    if (!isValidProfileId(profileId) || !CHANNELS.has(channel)) return [];
    const events = this.eventsByProfileChannel.get(
      profileChannelKey(profileId as MessagingProfileId, channel),
    ) ?? [];
    return orderEvents(events).map(cloneEvent);
  }

  private append(event: ConsentLedgerEvent): ConsentAppendResult {
    const existing = this.eventById.get(event.record.eventId);
    if (existing) return this.resolveDuplicate(existing, event);

    const key = profileChannelKey(event.record.profileId, event.record.channel);
    return this.appendNew(key, event);
  }

  private appendNew(key: string, event: ConsentLedgerEvent): ConsentAppendResult {
    const events = this.eventsByProfileChannel.get(key) ?? [];
    const nextEvents = [...events, event];
    const derivation = derive(nextEvents);

    this.eventById.set(event.record.eventId, event);
    this.eventsByProfileChannel.set(key, nextEvents);
    this.storeSnapshot(key, event.record.profileId, event.record.channel, derivation.current);

    const snapshot = this.snapshotForKey(key);
    if (derivation.blockedEventIds.has(event.record.eventId)) {
      // A blocked event is deliberately retained as audit history, but cannot
      // make a suppressed profile eligible for delivery.
      if (!snapshot) throw new Error("A suppressed event must retain a current snapshot.");
      return { outcome: "BLOCKED_BY_SUPPRESSION", event: cloneEvent(event), snapshot };
    }
    return { outcome: "APPLIED", event: cloneEvent(event), snapshot };
  }

  private resolveDuplicate(existing: ConsentLedgerEvent, attempted: ConsentLedgerEvent): ConsentAppendResult {
    const key = profileChannelKey(existing.record.profileId, existing.record.channel);
    if (!sameEvent(existing, attempted)) {
      return {
        outcome: "REJECTED",
        reason: "event_id_conflict",
        // An event ID is globally idempotent. Do not reveal another profile's
        // snapshot merely because an untrusted caller guessed an existing ID.
        snapshot: existing.record.profileId === attempted.record.profileId
          && existing.record.channel === attempted.record.channel
          ? this.snapshotForKey(key)
          : null,
      };
    }
    return {
      outcome: "IDEMPOTENT",
      event: cloneEvent(existing),
      snapshot: this.snapshotForKey(key),
    };
  }

  private rejected(reason: ConsentRejectionReason, input: unknown): ConsentAppendResult {
    const key = keyForPossiblyValidInput(input);
    return { outcome: "REJECTED", reason, snapshot: key ? this.snapshotForKey(key) : null };
  }

  private snapshotForKey(key: string): ConsentSnapshot | null {
    const snapshot = this.snapshots.get(key);
    return snapshot ? cloneSnapshot(snapshot) : null;
  }

  private storeSnapshot(
    key: string,
    profileId: MessagingProfileId,
    channel: ConsentChannel,
    current: ConsentRecord | null,
  ): void {
    if (!current) {
      this.snapshots.delete(key);
      return;
    }
    this.snapshots.set(key, freezeSnapshot({ profileId, channel, current }));
  }
}

function normalizeConsentRecord(input: unknown): RecordNormalization {
  if (!isRecord(input)) return { ok: false, reason: "invalid_record" };

  const profileId = normalizeProfileId(input.profileId);
  if (!profileId) return { ok: false, reason: "invalid_profile_id" };
  const eventId = normalizeEventId(input.eventId);
  if (!eventId) return { ok: false, reason: "invalid_event_id" };
  if (!isChannel(input.channel)) return { ok: false, reason: "invalid_channel" };
  if (!isState(input.state)) return { ok: false, reason: "invalid_state" };
  if (!isSource(input.source)) return { ok: false, reason: "invalid_source" };
  const occurredAt = normalizeTimestamp(input.occurredAt);
  if (!occurredAt) return { ok: false, reason: "invalid_timestamp" };

  const legalText = normalizeLegalTextVersion(input.legalTextVersion);
  if (legalText === undefined) return { ok: false, reason: "invalid_legal_text_version" };
  if (input.state === "SUBSCRIBED" && legalText === null) {
    return { ok: false, reason: "subscription_requires_legal_text_version" };
  }
  if (input.state !== "SUBSCRIBED" && legalText !== null) {
    return { ok: false, reason: "invalid_legal_text_version" };
  }
  if (input.source === "MERCHANT_REVIEW") {
    return { ok: false, reason: "merchant_review_requires_release_path" };
  }
  if (!isSourceStateAllowed(input.source, input.state)) {
    return { ok: false, reason: "invalid_source_state" };
  }

  return {
    ok: true,
    record: freezeRecord({
      profileId,
      channel: input.channel,
      eventId,
      occurredAt,
      source: input.source,
      state: input.state,
      legalTextVersion: legalText,
    }),
  };
}

function normalizeSuppressionRelease(input: unknown): ReleaseNormalization {
  if (!isRecord(input)) return { ok: false, reason: "invalid_record" };

  const profileId = normalizeProfileId(input.profileId);
  if (!profileId) return { ok: false, reason: "invalid_profile_id" };
  const eventId = normalizeEventId(input.eventId);
  if (!eventId) return { ok: false, reason: "invalid_event_id" };
  if (!isChannel(input.channel)) return { ok: false, reason: "invalid_channel" };
  const occurredAt = normalizeTimestamp(input.occurredAt);
  if (!occurredAt) return { ok: false, reason: "invalid_timestamp" };
  if (typeof input.reviewReference !== "string" || !REFERENCE.test(input.reviewReference)) {
    return { ok: false, reason: "invalid_review_reference" };
  }

  return {
    ok: true,
    event: freezeEvent({
      kind: "SUPPRESSION_RELEASE",
      record: freezeRecord({
        profileId,
        channel: input.channel,
        eventId,
        occurredAt,
        source: "MERCHANT_REVIEW",
        state: "UNSUBSCRIBED",
        legalTextVersion: null,
      }),
      reviewReference: input.reviewReference,
    }),
  };
}

function derive(events: readonly ConsentLedgerEvent[]): Derivation {
  let current: ConsentRecord | null = null;
  let suppressionActive = false;
  const blockedEventIds = new Set<MessagingEventId>();

  for (const event of orderEvents(events)) {
    const record = event.record;
    if (event.kind === "SUPPRESSION_RELEASE") {
      // releaseSuppression verifies this precondition before append. Retaining
      // this guard keeps a malformed internal event fail-closed if one appears.
      if (suppressionActive) {
        suppressionActive = false;
        current = record;
      } else {
        blockedEventIds.add(record.eventId);
      }
      continue;
    }

    if (record.state === "SUPPRESSED") {
      suppressionActive = true;
      current = record;
      continue;
    }

    if (suppressionActive) {
      blockedEventIds.add(record.eventId);
      continue;
    }

    current = record;
  }

  return { current, blockedEventIds };
}

/** Determines whether a release happened after an active prior suppression. */
function hasActiveSuppressionAt(events: readonly ConsentLedgerEvent[], release: ConsentRecord): boolean {
  const candidates = orderEvents([
    ...events,
    freezeEvent({ kind: "SUPPRESSION_RELEASE", record: release, reviewReference: "review_probe_00000000" }),
  ]);
  let suppressionActive = false;

  for (const event of candidates) {
    if (event.record.eventId === release.eventId) return suppressionActive;
    if (event.kind === "SUPPRESSION_RELEASE") {
      suppressionActive = false;
    } else if (event.record.state === "SUPPRESSED") {
      suppressionActive = true;
    }
  }
  return false;
}

function orderEvents(events: readonly ConsentLedgerEvent[]): ConsentLedgerEvent[] {
  return [...events].sort((left, right) => {
    const occurredComparison = left.record.occurredAt.localeCompare(right.record.occurredAt);
    if (occurredComparison !== 0) return occurredComparison;

    // At an identical instant, order from least to most protective. A later
    // state in this order wins, so unsubscribe/suppression cannot lose a tie
    // to an opt-in. A suppression always wins a tie fail-closed.
    const kindComparison = eventOrder(left) - eventOrder(right);
    if (kindComparison !== 0) return kindComparison;
    return left.record.eventId.localeCompare(right.record.eventId);
  });
}

function eventOrder(event: ConsentLedgerEvent): number {
  if (event.kind === "SUPPRESSION_RELEASE") return 3;
  switch (event.record.state) {
    case "SUBSCRIBED":
      return 0;
    case "UNKNOWN":
      return 1;
    case "UNSUBSCRIBED":
      return 2;
    case "SUPPRESSED":
      return 4;
  }
}

function isSourceStateAllowed(source: ConsentSource, state: ConsentState): boolean {
  switch (source) {
    case "HARD_BOUNCE":
    case "SPAM_COMPLAINT":
      return state === "SUPPRESSED";
    case "CUSTOMER_UNSUBSCRIBE":
      return state === "UNSUBSCRIBED";
    case "BASE_NOTE_FORM":
      return state === "SUBSCRIBED";
    case "MERCHANT_REVIEW":
      return false;
    case "SHOPIFY":
    case "KLAVIYO_IMPORT":
      return true;
  }
}

function sameEvent(left: ConsentLedgerEvent, right: ConsentLedgerEvent): boolean {
  return left.kind === right.kind
    && left.reviewReference === right.reviewReference
    && sameRecord(left.record, right.record);
}

function sameRecord(left: ConsentRecord, right: ConsentRecord): boolean {
  return left.profileId === right.profileId
    && left.channel === right.channel
    && left.eventId === right.eventId
    && left.occurredAt === right.occurredAt
    && left.source === right.source
    && left.state === right.state
    && left.legalTextVersion === right.legalTextVersion;
}

function cloneEvent(event: ConsentLedgerEvent): ConsentLedgerEvent {
  return freezeEvent({
    kind: event.kind,
    record: cloneRecord(event.record),
    reviewReference: event.reviewReference,
  });
}

function cloneSnapshot(snapshot: ConsentSnapshot): ConsentSnapshot {
  return freezeSnapshot({
    profileId: snapshot.profileId,
    channel: snapshot.channel,
    current: cloneRecord(snapshot.current),
  });
}

function freezeEvent(event: ConsentLedgerEvent): ConsentLedgerEvent {
  return Object.freeze({
    kind: event.kind,
    record: freezeRecord(event.record),
    reviewReference: event.reviewReference,
  });
}

function freezeSnapshot(snapshot: ConsentSnapshot): ConsentSnapshot {
  return Object.freeze({
    profileId: snapshot.profileId,
    channel: snapshot.channel,
    current: freezeRecord(snapshot.current),
  });
}

function freezeRecord(record: ConsentRecord): ConsentRecord {
  return Object.freeze({
    profileId: record.profileId,
    channel: record.channel,
    eventId: record.eventId,
    occurredAt: record.occurredAt,
    source: record.source,
    state: record.state,
    legalTextVersion: record.legalTextVersion,
  });
}

function cloneRecord(record: ConsentRecord): ConsentRecord {
  return freezeRecord(record);
}

function keyForPossiblyValidInput(input: unknown): string | null {
  if (!isRecord(input) || !isChannel(input.channel)) return null;
  const profileId = normalizeProfileId(input.profileId);
  return profileId ? profileChannelKey(profileId, input.channel) : null;
}

function rejectedWithoutSnapshot(reason: ConsentRejectionReason): ConsentAppendResult {
  return { outcome: "REJECTED", reason, snapshot: null };
}

function profileChannelKey(profileId: MessagingProfileId, channel: ConsentChannel): string {
  return `${profileId}\u0000${channel}`;
}

function normalizeProfileId(value: unknown): MessagingProfileId | null {
  if (typeof value !== "string") return null;
  try {
    return asMessagingProfileId(value);
  } catch {
    return null;
  }
}

function isValidProfileId(value: string): boolean {
  return normalizeProfileId(value) !== null;
}

function normalizeEventId(value: unknown): MessagingEventId | null {
  if (typeof value !== "string") return null;
  try {
    return asMessagingEventId(value);
  } catch {
    return null;
  }
}

function normalizeTimestamp(value: unknown): IsoTimestamp | null {
  if (typeof value !== "string") return null;
  try {
    const timestamp = asIsoTimestamp(value);
    // Date.parse accepts impossible dates such as February 30 by rolling them
    // forward. Require an exact UTC round trip instead.
    const normalized = value.includes(".") ? value : value.replace("Z", ".000Z");
    if (new Date(timestamp).toISOString() !== normalized) return null;
    return timestamp;
  } catch {
    return null;
  }
}

function normalizeLegalTextVersion(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || !LEGAL_TEXT_VERSION.test(value)) return undefined;
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChannel(value: unknown): value is ConsentChannel {
  return typeof value === "string" && CHANNELS.has(value as ConsentChannel);
}

function isState(value: unknown): value is ConsentState {
  return typeof value === "string" && STATES.has(value as ConsentState);
}

function isSource(value: unknown): value is ConsentSource {
  return typeof value === "string" && SOURCES.has(value as ConsentSource);
}
