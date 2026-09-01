import {
  FUTURE_ADD_ON_UNIT_PRICE_CENTS,
  MAX_FUTURE_ADD_ONS_PER_CYCLE,
  type ProfileQueueCycle,
} from "./contracts.js";

export interface QueueDropdownFragranceOption {
  /** Exact catalog variant ID supplied by a future server-side catalog read. */
  readonly variantId: string;
  readonly label: string;
}

export interface ProfileQueueDropdownView {
  readonly availableFragrances: readonly QueueDropdownFragranceOption[];
  readonly cycle: ProfileQueueCycle;
  /** Keeps the scaffold presentation-only until an authenticated route exists. */
  readonly readOnly?: boolean;
}

/**
 * Staging-only queue markup. It has no URL, contract ID, JavaScript handler,
 * or mutation side effect. A future signed App Proxy route may attach only
 * after authorization, idempotency, and catalog-compatibility checks exist.
 */
export function renderProfileQueueDropdown(view: ProfileQueueDropdownView): string {
  const addOnCount = view.cycle.addOns.length;
  const atCapacity = addOnCount >= MAX_FUTURE_ADD_ONS_PER_CYCLE;
  const locked = view.cycle.state !== "OPEN";
  const disabled = Boolean(view.readOnly) || atCapacity || locked;
  const disabledAttribute = disabled ? " disabled" : "";
  const readonlyAttribute = view.readOnly ? " data-read-only=\"true\"" : "";
  const fotmLabel = view.cycle.fotm.variantId
    ? "Included FOTM default is pre-selected; save an override only if you want a different fragrance this month."
    : "Included FOTM default will appear after Base Note publishes this ship-month schedule.";

  const options = view.availableFragrances
    .map(
      (option) => `<option value="${escapeHtml(option.variantId)}">${escapeHtml(option.label)}</option>`,
    )
    .join("");
  const addOnRows = view.cycle.addOns
    .map(
      (addOn) => `
        <li class="bn-profile-queue__add-on" data-add-on-id="${escapeHtml(addOn.id)}">
          <span>Extra fragrance ${addOn.position}</span>
          <span class="bn-profile-queue__price">${formatUsd(addOn.unitPriceCents)}</span>
          <button type="button" data-queue-action="remove-add-on"${disabledAttribute}>Remove</button>
        </li>`,
    )
    .join("");

  const capacityMessage = atCapacity
    ? `You have reached the ${MAX_FUTURE_ADD_ONS_PER_CYCLE}-add-on limit for this shipment.`
    : `${MAX_FUTURE_ADD_ONS_PER_CYCLE - addOnCount} add-on${MAX_FUTURE_ADD_ONS_PER_CYCLE - addOnCount === 1 ? "" : "s"} remaining.`;

  return `
    <section class="bn-profile-queue" data-basenote-staging-queue="true"${readonlyAttribute}>
      <header>
        <h2>Profile Queue</h2>
        <p>${fotmLabel}</p>
        <p>One included fragrance defaults to FOTM. Add up to ${MAX_FUTURE_ADD_ONS_PER_CYCLE} separate extra fragrances to this future shipment for ${formatUsd(FUTURE_ADD_ON_UNIT_PRICE_CENTS)} each.</p>
      </header>
      <ol class="bn-profile-queue__add-ons">${addOnRows}</ol>
      <p class="bn-profile-queue__capacity" aria-live="polite">${capacityMessage}</p>
      <label for="bn-profile-queue-fragrance">Add an extra fragrance</label>
      <select id="bn-profile-queue-fragrance" name="variantId"${disabledAttribute}>
        <option value="">Choose a fragrance</option>${options}
      </select>
      <button type="button" data-queue-action="add-add-on"${disabledAttribute}>Add for ${formatUsd(FUTURE_ADD_ON_UNIT_PRICE_CENTS)}</button>
      <p class="bn-profile-queue__staging-note">Staging scaffold only; changes are not sent until an authenticated queue route is connected.</p>
    </section>`;
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
