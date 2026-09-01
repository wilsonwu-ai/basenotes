import {
  FUTURE_ADD_ON_UNIT_PRICE_CENTS,
  MEMBER_FRAGRANCE_CUTOFF_TIMEZONE,
  MAX_FUTURE_ADD_ONS_PER_CYCLE,
  type ProfileQueueCycle,
} from "../profile-queue/contracts.js";
import type { StagingTestVariant } from "./staging-test-variants.js";
import type { StagingProfileQueueFormNonce } from "./form-nonce.js";
import { compareIsoTimestamps } from "../queue/types.js";

export interface ProfileQueuePageInput {
  readonly createIdempotencyKey: () => string;
  readonly cycle: ProfileQueueCycle;
  /** One-use server-issued nonce bound to this exact signed customer/cycle. */
  readonly formNonce: StagingProfileQueueFormNonce;
  /** Signed `path_prefix` plus the known Profile Queue child route. */
  readonly formAction: string;
  /** Server time, used only to render safe pre/post-cutoff semantics. */
  readonly now: string;
  readonly status?: "success";
  readonly variants: readonly StagingTestVariant[];
}

/**
 * Server-rendered, no-script Profile Queue surface for a disposable staging
 * shop. The mutation forms post back through Shopify's storefront App Proxy,
 * so each submission receives a fresh signed proxy request.
 */
export function renderProfileQueuePage(input: ProfileQueuePageInput): string {
  const variantsById = new Map(input.variants.map((variant) => [variant.variantId, variant]));
  const cutoffReached = input.cycle.fotm.cutoffAt !== null
    && compareIsoTimestamps(input.now, input.cycle.fotm.cutoffAt) >= 0;
  const editable = input.cycle.state === "OPEN" && !cutoffReached;
  const atCapacity = input.cycle.addOns.length >= MAX_FUTURE_ADD_ONS_PER_CYCLE;
  const formAction = escapeHtml(input.formAction);
  const status = input.status === "success"
    ? '<p class="bn-queue__status" role="status" tabindex="-1">Queue updated.</p>'
    : "";
  const fotmDescription = input.cycle.fotm.status === "UNPUBLISHED"
    ? "Base Note has not published the fallback fragrance for this shipment yet."
    : "The published Fragrance of the Month is used only when no included member choice is saved before the Central Time cutoff.";
  const memberChoice = renderMemberChoice({
    createIdempotencyKey: input.createIdempotencyKey,
    cycle: input.cycle,
    editable,
    formAction,
    formNonce: input.formNonce,
    idempotencyKey: input.createIdempotencyKey(),
    variants: input.variants,
    variantsById,
  });
  const addOnRows = renderSlots(input, variantsById, editable, formAction);
  const dropdown = renderAddOnForm({
    atCapacity,
    cycle: input.cycle,
    editable,
    formAction,
    formNonce: input.formNonce,
    idempotencyKey: input.createIdempotencyKey(),
    variants: input.variants,
  });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Profile Queue · Base Note</title>
    <style>
      :root {
        color-scheme: light;
        --bn-ink: #171513;
        --bn-paper: #f5f0e7;
        --bn-panel: #fffcf7;
        --bn-muted: #6a625a;
        --bn-line: #d4c8b7;
        --bn-gold: #9d7140;
        --bn-success: #285b41;
        --bn-focus: #1f5d9d;
      }
      * { box-sizing: border-box; }
      body {
        background: var(--bn-paper);
        color: var(--bn-ink);
        font-family: Georgia, "Times New Roman", serif;
        line-height: 1.5;
        margin: 0;
      }
      .bn-queue {
        margin: 0 auto;
        max-width: 48rem;
        padding: clamp(1.25rem, 5vw, 3.5rem) clamp(1rem, 4vw, 2rem) 3rem;
      }
      .bn-queue__eyebrow {
        color: var(--bn-gold);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: .72rem;
        letter-spacing: .12em;
        margin: 0 0 .5rem;
        text-transform: uppercase;
      }
      h1, h2 { font-weight: 400; line-height: 1.1; }
      h1 { font-size: clamp(2rem, 8vw, 3.6rem); margin: 0 0 .75rem; }
      h2 { font-size: 1.15rem; margin: 0 0 .65rem; }
      .bn-queue__lede, .bn-queue__help { color: var(--bn-muted); margin: 0; }
      .bn-queue__status {
        background: #e3f0e8;
        border-left: .25rem solid var(--bn-success);
        color: #173e2b;
        margin: 1.25rem 0 0;
        padding: .8rem 1rem;
      }
      .bn-queue__locked {
        background: #f0ebe2;
        border-left: .25rem solid var(--bn-muted);
        color: #403a34;
        margin: 1rem 0 0;
        padding: .8rem 1rem;
      }
      .bn-queue__panel {
        background: var(--bn-panel);
        border: 1px solid var(--bn-line);
        margin-top: 1.25rem;
        padding: clamp(1rem, 3vw, 1.5rem);
      }
      .bn-queue__fotm { border-left: .25rem solid var(--bn-gold); }
      .bn-queue__slots { list-style: none; margin: 0; padding: 0; }
      .bn-queue__slot {
        align-items: center;
        border-top: 1px solid var(--bn-line);
        display: grid;
        gap: .75rem;
        grid-template-columns: minmax(0, 1fr) auto;
        padding: .9rem 0;
      }
      .bn-queue__slot:first-child { border-top: 0; padding-top: 0; }
      .bn-queue__slot--empty { color: var(--bn-muted); font-style: italic; }
      .bn-queue__slot-title { display: block; }
      .bn-queue__price { color: var(--bn-muted); font-size: .9rem; }
      form { margin: 0; }
      label { display: block; font-weight: 700; margin-bottom: .45rem; }
      select, button {
        border-radius: 0;
        font: inherit;
        min-height: 2.75rem;
      }
      select {
        background: #fff;
        border: 1px solid var(--bn-ink);
        padding: .55rem .7rem;
        width: 100%;
      }
      button {
        background: var(--bn-ink);
        border: 1px solid var(--bn-ink);
        color: #fff;
        cursor: pointer;
        padding: .55rem .9rem;
      }
      button:hover { background: #3b332b; }
      .bn-queue__remove { background: transparent; color: var(--bn-ink); }
      .bn-queue__remove:hover { background: #eee6da; }
      button:disabled, select:disabled { cursor: not-allowed; opacity: .55; }
      button:focus-visible, select:focus-visible, a:focus-visible {
        outline: 3px solid var(--bn-focus);
        outline-offset: 3px;
      }
      .bn-queue__add-form { display: grid; gap: .85rem; }
      .bn-queue__add-form fieldset { border: 0; margin: 0; padding: 0; }
      .bn-queue__capacity { color: var(--bn-muted); font-size: .92rem; margin: .1rem 0 0; }
      .bn-queue__default {
        background: #f3eadc;
        border-left: .25rem solid var(--bn-gold);
        color: #40301e;
        margin: .8rem 0;
        padding: .7rem .85rem;
      }
      @media (max-width: 33rem) {
        .bn-queue__slot { align-items: start; grid-template-columns: 1fr; }
        .bn-queue__slot form, .bn-queue__slot button { width: 100%; }
      }
      @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto; } }
    </style>
  </head>
  <body>
    <main class="bn-queue" aria-labelledby="profile-queue-title">
      <p class="bn-queue__eyebrow">Base Note · Staging</p>
      <h1 id="profile-queue-title">Profile Queue</h1>
      <p class="bn-queue__lede">Choose one included fragrance, then add up to four separate extras for this future shipment.</p>
      ${status}
      <section class="bn-queue__panel bn-queue__fotm" aria-labelledby="fotm-title">
        <h2 id="fotm-title">Published Fragrance of the Month fallback</h2>
        <p class="bn-queue__help">${escapeHtml(fotmDescription)}</p>
      </section>
      <section class="bn-queue__panel" aria-labelledby="member-choice-title">
        <h2 id="member-choice-title">Included member fragrance</h2>
        <p class="bn-queue__help">One fragrance is included with this shipment. A fragrance selected in a prior month remains eligible here.</p>
        ${memberChoice}
      </section>
      <section class="bn-queue__panel" aria-labelledby="add-ons-title">
        <h2 id="add-ons-title">Extra fragrances</h2>
        <p class="bn-queue__help">Up to ${MAX_FUTURE_ADD_ONS_PER_CYCLE} extra fragrances may be added for ${formatUsd(FUTURE_ADD_ON_UNIT_PRICE_CENTS)} each.</p>
        <ol class="bn-queue__slots">${addOnRows}</ol>
      </section>
      <section class="bn-queue__panel" aria-labelledby="add-title">
        <h2 id="add-title">Add an eligible test fragrance</h2>
        ${dropdown}
      </section>
    </main>
  </body>
</html>`;
}

export function renderProfileQueueErrorPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Profile Queue unavailable · Base Note</title>
  </head>
  <body>
    <main>
      <h1>Profile Queue unavailable</h1>
      <p role="alert">We could not update the queue. Please reopen the Queue link from your Base Note account and try again.</p>
    </main>
  </body>
</html>`;
}

function renderMemberChoice(input: {
  readonly createIdempotencyKey: () => string;
  readonly cycle: ProfileQueueCycle;
  readonly editable: boolean;
  readonly formAction: string;
  readonly formNonce: StagingProfileQueueFormNonce;
  readonly idempotencyKey: string;
  readonly variants: readonly StagingTestVariant[];
  readonly variantsById: ReadonlyMap<string, StagingTestVariant>;
}): string {
  const selected = input.cycle.memberChoice;
  const selectedLabel = selected.variantId === null
    ? null
    : input.variantsById.get(selected.variantId)?.label ?? "Configured test fragrance";
  if (!input.editable) {
    const lockedMessage = selected.source === "MEMBER_SELECTED"
      ? `The Central Time choice window is closed. This shipment is locked to your included selection: ${selectedLabel ?? "Configured test fragrance"}.`
      : selected.source === "FOTM_FALLBACK"
        ? "The Central Time choice window is closed. This shipment is locked to the published Fragrance of the Month fallback."
        : "The Central Time choice window is closed. No included override was saved, so the published Fragrance of the Month is the included default while Base Note finalizes the durable lock.";
    return `<p class="bn-queue__locked" role="status">${escapeHtml(lockedMessage)}</p>`;
  }

  if (input.variants.length === 0) {
    return "<p class=\"bn-queue__locked\" role=\"status\">No eligible staging fragrance is configured for the included choice.</p>";
  }

  const options = input.variants
    .map((variant) => {
      const selectedAttribute = variant.variantId === selected.variantId ? " selected" : "";
      return `<option value="${escapeHtml(variant.variantId)}"${selectedAttribute}>${escapeHtml(variant.label)}</option>`;
    })
    .join("");
  const actionLabel = selected.source === "MEMBER_SELECTED"
    ? "Update included override"
    : "Save included override";
  const fotmLabel = input.cycle.fotm.variantId === null
    ? "the published FOTM once Base Note schedules it"
    : input.variantsById.get(input.cycle.fotm.variantId)?.label ?? "the published Fragrance of the Month";
  const currentStatus = selected.source === "MEMBER_SELECTED"
    ? `<p class="bn-queue__capacity">Current included override: ${escapeHtml(selectedLabel ?? "Configured test fragrance")}.</p>`
    : `<div class="bn-queue__default" role="status"><strong>Included by default: ${escapeHtml(fotmLabel)}</strong><br>FOTM is pre-selected for this shipment. Do nothing to keep it; save an override below only to replace it for this month.</div>`;
  const clearForm = selected.source === "MEMBER_SELECTED"
    ? `<form method="post" action="${input.formAction}">
        ${hiddenFields(input.cycle, input.createIdempotencyKey(), input.formNonce, "CLEAR_MEMBER_FRAGRANCE")}
        <button class="bn-queue__remove" type="submit">Use FOTM default</button>
      </form>`
    : "";

  return `<p class="bn-queue__capacity">Selections close exactly at 12:01 AM ${escapeHtml(MEMBER_FRAGRANCE_CUTOFF_TIMEZONE)} time on the configured shipment cutoff date.</p>
    ${currentStatus}
    <form class="bn-queue__add-form" method="post" action="${input.formAction}">
      ${hiddenFields(input.cycle, input.idempotencyKey, input.formNonce, "SET_MEMBER_FRAGRANCE")}
      <fieldset>
        <label for="bn-staging-member-fragrance">Override included fragrance</label>
        <select id="bn-staging-member-fragrance" name="variantId" required>
          <option value="">Choose an eligible test fragrance</option>
          ${options}
        </select>
      </fieldset>
      <button type="submit">${escapeHtml(actionLabel)}</button>
    </form>
    ${clearForm}`;
}

function renderSlots(
  input: ProfileQueuePageInput,
  variantsById: ReadonlyMap<string, StagingTestVariant>,
  editable: boolean,
  formAction: string,
): string {
  const rows = input.cycle.addOns.map((addOn) => {
    const label = variantsById.get(addOn.variantId)?.label ?? "Configured test fragrance";
    const remove = editable
      ? `<form method="post" action="${formAction}">
          ${hiddenFields(input.cycle, input.createIdempotencyKey(), input.formNonce, "REMOVE_ADD_ON")}
          <input type="hidden" name="addOnId" value="${escapeHtml(addOn.id)}">
          <button class="bn-queue__remove" type="submit">Remove</button>
        </form>`
      : "";
    return `<li class="bn-queue__slot">
      <span><strong class="bn-queue__slot-title">${escapeHtml(label)}</strong><span class="bn-queue__price">${formatUsd(addOn.unitPriceCents)} extra fragrance</span></span>
      ${remove}
    </li>`;
  });
  for (let position = input.cycle.addOns.length + 1; position <= MAX_FUTURE_ADD_ONS_PER_CYCLE; position += 1) {
    rows.push(`<li class="bn-queue__slot bn-queue__slot--empty">Slot ${position} is available.</li>`);
  }
  return rows.join("");
}

function renderAddOnForm(input: {
  readonly atCapacity: boolean;
  readonly cycle: ProfileQueueCycle;
  readonly editable: boolean;
  readonly formAction: string;
  readonly formNonce: StagingProfileQueueFormNonce;
  readonly idempotencyKey: string;
  readonly variants: readonly StagingTestVariant[];
}): string {
  if (!input.editable) {
    return `<p class="bn-queue__locked" role="status">The Central Time choice window is closed; paid extras are locked with this shipment.</p>`;
  }
  const disabled = !input.editable || input.atCapacity || input.variants.length === 0;
  const disabledAttribute = disabled ? " disabled" : "";
  const message = !input.editable
    ? "This future shipment is no longer editable."
    : input.atCapacity
      ? `All ${MAX_FUTURE_ADD_ONS_PER_CYCLE} extra-fragrance slots are filled.`
      : `${MAX_FUTURE_ADD_ONS_PER_CYCLE - input.cycle.addOns.length} slot${MAX_FUTURE_ADD_ONS_PER_CYCLE - input.cycle.addOns.length === 1 ? "" : "s"} remaining.`;
  const options = input.variants
    .map((variant) => `<option value="${escapeHtml(variant.variantId)}">${escapeHtml(variant.label)} · ${formatUsd(FUTURE_ADD_ON_UNIT_PRICE_CENTS)}</option>`)
    .join("");
  return `<form class="bn-queue__add-form" method="post" action="${input.formAction}">
    ${hiddenFields(input.cycle, input.idempotencyKey, input.formNonce, "ADD_ADD_ON")}
    <fieldset${disabledAttribute}>
      <label for="bn-staging-queue-variant">Eligible fragrance</label>
      <select id="bn-staging-queue-variant" name="variantId" required>
        <option value="">Choose an eligible test fragrance</option>
        ${options}
      </select>
    </fieldset>
    <button type="submit"${disabledAttribute}>Add for ${formatUsd(FUTURE_ADD_ON_UNIT_PRICE_CENTS)}</button>
    <p class="bn-queue__capacity">${escapeHtml(message)}</p>
  </form>`;
}

function hiddenFields(
  cycle: ProfileQueueCycle,
  idempotencyKey: string,
  formNonce: StagingProfileQueueFormNonce,
  action: "SET_MEMBER_FRAGRANCE" | "CLEAR_MEMBER_FRAGRANCE" | "ADD_ADD_ON" | "REMOVE_ADD_ON",
): string {
  return `<input type="hidden" name="action" value="${action}">
    <input type="hidden" name="cycleKey" value="${escapeHtml(cycle.cycleKey)}">
    <input type="hidden" name="shipMonth" value="${escapeHtml(cycle.shipMonth)}">
    <input type="hidden" name="expectedRevision" value="${cycle.revision}">
    <input type="hidden" name="formNonce" value="${escapeHtml(formNonce)}">
    <input type="hidden" name="idempotencyKey" value="${escapeHtml(idempotencyKey)}">`;
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
