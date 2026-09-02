/**
 * Pure pricing policy for Base Note.
 *
 * This module intentionally has no Shopify SDK, network, database, or browser
 * dependencies. Callers must supply customer history from a durable,
 * server-controlled record (for example, the permanent customer tag/metafield
 * plus the subscription audit store), never from a cart attribute.
 */

export const INTRO_FIRST_CYCLE_PRICE_CENTS = 1_500 as const;
export const STANDARD_CYCLE_PRICE_CENTS = 2_000 as const;
export const ADD_ON_TARGET_UNIT_PRICE_CENTS = 1_800 as const;

export type DurableSubscriptionHistory =
  | "durably_never_subscribed"
  | "durably_ever_subscribed"
  | "unknown";

export type CustomerPricingContext =
  | { readonly kind: "guest" }
  | {
      readonly kind: "authenticated";
      /** Exact Shopify Customer GID obtained from an authenticated server session. */
      readonly customerId: string;
      readonly subscriptionHistory: DurableSubscriptionHistory;
    };

export interface BaseNoteSellingPlan {
  /** Exact Shopify SellingPlan GID. */
  readonly id: string;
  readonly kind: "intro" | "standard";
  readonly firstCyclePriceCents: number;
  readonly recurringCyclePriceCents: number;
}

/**
 * Explicit IDs are required: product titles, handles, collections, and browser
 * supplied labels must never make a product eligible for a price benefit.
 */
export interface PricingPolicy {
  readonly plans: readonly BaseNoteSellingPlan[];
  readonly baseNoteSubscriptionVariantIds: readonly string[];
  readonly eligibleAddOnVialVariantIds: readonly string[];
}

export type IntroIneligibilityReason =
  | "guest_checkout"
  | "invalid_authenticated_customer"
  | "subscription_history_not_verified"
  | "customer_has_subscription_history"
  | "selling_plan_missing"
  | "selling_plan_unknown"
  | "selling_plan_ambiguous"
  | "requested_plan_is_not_intro"
  | "intro_plan_price_mismatch"
  | "policy_configuration_invalid";

export type IntroEligibility =
  | {
      readonly eligible: true;
      readonly sellingPlanId: string;
      readonly firstCyclePriceCents: typeof INTRO_FIRST_CYCLE_PRICE_CENTS;
      readonly recurringCyclePriceCents: typeof STANDARD_CYCLE_PRICE_CENTS;
    }
  | { readonly eligible: false; readonly reason: IntroIneligibilityReason };

export interface IntroEligibilityInput {
  readonly customer: CustomerPricingContext;
  /** The selling plan selected in the cart, as trusted cart/checkout input. */
  readonly requestedSellingPlanId: string | null | undefined;
  readonly policy: PricingPolicy;
}

/**
 * The introductory plan is allowed only for a signed-in customer whose durable
 * history positively establishes that they have never had a subscription.
 */
export function evaluateIntroEligibility(input: IntroEligibilityInput): IntroEligibility {
  if (input.customer.kind === "guest") {
    return denyIntro("guest_checkout");
  }

  if (!isCustomerGid(input.customer.customerId)) {
    return denyIntro("invalid_authenticated_customer");
  }

  if (input.customer.subscriptionHistory === "unknown") {
    return denyIntro("subscription_history_not_verified");
  }

  if (input.customer.subscriptionHistory === "durably_ever_subscribed") {
    return denyIntro("customer_has_subscription_history");
  }

  if (validatePricingPolicy(input.policy).length > 0) {
    return denyIntro("policy_configuration_invalid");
  }

  const planId = input.requestedSellingPlanId;
  if (!planId || !isSellingPlanGid(planId)) {
    return denyIntro("selling_plan_missing");
  }

  const matchingPlans = input.policy.plans.filter((plan) => plan.id === planId);
  if (matchingPlans.length === 0) return denyIntro("selling_plan_unknown");
  if (matchingPlans.length !== 1) return denyIntro("selling_plan_ambiguous");

  const plan = matchingPlans[0];
  if (!plan) return denyIntro("selling_plan_unknown");
  if (plan.kind !== "intro") return denyIntro("requested_plan_is_not_intro");
  if (!hasCanonicalPlanPricing(plan)) return denyIntro("intro_plan_price_mismatch");

  return {
    eligible: true,
    sellingPlanId: plan.id,
    firstCyclePriceCents: INTRO_FIRST_CYCLE_PRICE_CENTS,
    recurringCyclePriceCents: STANDARD_CYCLE_PRICE_CENTS,
  };
}

export type AddOnExclusion =
  | "none"
  | "gift_card"
  | "giveaway"
  | "full_bottle"
  | "bundle"
  | "merchant_excluded";

export type CartPurchase =
  | { readonly kind: "one_time" }
  | { readonly kind: "subscription"; readonly sellingPlanId: string | null | undefined };

export interface PricingCartLine {
  /** Stable cart-line identifier used as the discount target. */
  readonly id: string;
  readonly variantId: string;
  readonly quantity: number;
  /** Integer USD cents before this policy's product discount. */
  readonly unitPriceCents: number;
  readonly currencyCode: string;
  readonly purchase: CartPurchase;
  /** Merchant-derived product classification; any value other than none is excluded. */
  readonly exclusion: AddOnExclusion;
}

export interface AddOnDiscountInput {
  readonly lines: readonly PricingCartLine[];
  readonly policy: PricingPolicy;
}

export interface AddOnDiscount {
  readonly lineId: string;
  readonly variantId: string;
  readonly quantity: number;
  readonly originalUnitPriceCents: number;
  readonly targetUnitPriceCents: typeof ADD_ON_TARGET_UNIT_PRICE_CENTS;
  readonly totalDiscountCents: number;
}

export type AddOnLineRejectionReason =
  | "not_a_one_time_purchase"
  | "excluded_merchandise"
  | "invalid_quantity"
  | "unsupported_currency"
  | "price_already_at_target"
  | "price_below_target"
  | "unsafe_discount_total";

export interface AddOnLineRejection {
  readonly lineId: string;
  readonly reason: AddOnLineRejectionReason;
}

export type AddOnCartIneligibilityReason =
  | "policy_configuration_invalid"
  | "duplicate_cart_line_id"
  | "base_note_subscription_missing"
  | "ambiguous_base_note_subscription_lines"
  | "subscription_selling_plan_missing"
  | "subscription_plan_unknown"
  | "subscription_plan_ambiguous"
  | "subscription_plan_price_mismatch"
  | "subscription_currency_not_supported"
  | "subscription_quantity_invalid";

export type AddOnDiscountEvaluation =
  | {
      readonly cartEligible: false;
      readonly reason: AddOnCartIneligibilityReason;
      readonly discounts: readonly [];
      readonly rejectedLines: readonly [];
    }
  | {
      readonly cartEligible: true;
      /** The exact plan that established current-cart subscription entitlement. */
      readonly subscriptionSellingPlanId: string;
      readonly discounts: readonly AddOnDiscount[];
      readonly rejectedLines: readonly AddOnLineRejection[];
    };

/**
 * Produces discounts that set each qualified one-time vial's unit price to
 * exactly $18.00. It never increases a price or infers a subscription from a
 * product name or a customer's past state.
 *
 * A former subscriber may use the add-on only when their current cart contains
 * one valid Base Note subscription line. Their past history still blocks the
 * introductory plan through evaluateIntroEligibility.
 */
export function evaluateAddOnDiscounts(input: AddOnDiscountInput): AddOnDiscountEvaluation {
  if (validatePricingPolicy(input.policy).length > 0) {
    return denyCart("policy_configuration_invalid");
  }
  if (hasDuplicateLineId(input.lines)) return denyCart("duplicate_cart_line_id");

  const subscription = resolveCartSubscription(input.lines, input.policy);
  if ("reason" in subscription) return denyCart(subscription.reason);

  const discounts: AddOnDiscount[] = [];
  const rejectedLines: AddOnLineRejection[] = [];
  const eligibleVialIds = new Set(input.policy.eligibleAddOnVialVariantIds);

  for (const line of input.lines) {
    if (!eligibleVialIds.has(line.variantId)) continue;

    const rejection = addOnLineRejection(line);
    if (rejection) {
      rejectedLines.push({ lineId: line.id, reason: rejection });
      continue;
    }

    const perUnitDiscount = line.unitPriceCents - ADD_ON_TARGET_UNIT_PRICE_CENTS;
    const totalDiscountCents = perUnitDiscount * line.quantity;
    if (!Number.isSafeInteger(totalDiscountCents) || totalDiscountCents <= 0) {
      rejectedLines.push({ lineId: line.id, reason: "unsafe_discount_total" });
      continue;
    }

    discounts.push({
      lineId: line.id,
      variantId: line.variantId,
      quantity: line.quantity,
      originalUnitPriceCents: line.unitPriceCents,
      targetUnitPriceCents: ADD_ON_TARGET_UNIT_PRICE_CENTS,
      totalDiscountCents,
    });
  }

  return {
    cartEligible: true,
    subscriptionSellingPlanId: subscription.plan.id,
    discounts,
    rejectedLines,
  };
}

export type PolicyConfigurationIssue =
  | "no_plans"
  | "invalid_selling_plan_id"
  | "duplicate_selling_plan_id"
  | "missing_intro_plan"
  | "missing_standard_plan"
  | "invalid_plan_pricing"
  | "no_subscription_variants"
  | "invalid_subscription_variant_id"
  | "duplicate_subscription_variant_id"
  | "no_add_on_vial_variants"
  | "invalid_add_on_vial_variant_id"
  | "duplicate_add_on_vial_variant_id"
  | "subscription_and_add_on_variant_overlap";

/**
 * Validates the small, reviewed ID allowlists before a caller enables a price
 * rule. Invalid configuration yields no promotional outcome in the evaluators.
 */
export function validatePricingPolicy(policy: PricingPolicy): readonly PolicyConfigurationIssue[] {
  const issues: PolicyConfigurationIssue[] = [];
  if (policy.plans.length === 0) issues.push("no_plans");

  const planIds = new Set<string>();
  let introPlanCount = 0;
  let standardPlanCount = 0;
  for (const plan of policy.plans) {
    if (!isSellingPlanGid(plan.id)) issues.push("invalid_selling_plan_id");
    if (planIds.has(plan.id)) issues.push("duplicate_selling_plan_id");
    planIds.add(plan.id);
    if (plan.kind === "intro") introPlanCount += 1;
    if (plan.kind === "standard") standardPlanCount += 1;
    if (!hasCanonicalPlanPricing(plan)) issues.push("invalid_plan_pricing");
  }
  if (introPlanCount === 0) issues.push("missing_intro_plan");
  if (standardPlanCount === 0) issues.push("missing_standard_plan");

  validateVariantAllowlist(
    policy.baseNoteSubscriptionVariantIds,
    "no_subscription_variants",
    "invalid_subscription_variant_id",
    "duplicate_subscription_variant_id",
    issues,
  );
  validateVariantAllowlist(
    policy.eligibleAddOnVialVariantIds,
    "no_add_on_vial_variants",
    "invalid_add_on_vial_variant_id",
    "duplicate_add_on_vial_variant_id",
    issues,
  );

  const subscriptionIds = new Set(policy.baseNoteSubscriptionVariantIds);
  if (policy.eligibleAddOnVialVariantIds.some((variantId) => subscriptionIds.has(variantId))) {
    issues.push("subscription_and_add_on_variant_overlap");
  }
  return [...new Set(issues)];
}

function denyIntro(reason: IntroIneligibilityReason): IntroEligibility {
  return { eligible: false, reason };
}

function denyCart(reason: AddOnCartIneligibilityReason): AddOnDiscountEvaluation {
  return { cartEligible: false, reason, discounts: [], rejectedLines: [] };
}

function resolveCartSubscription(
  lines: readonly PricingCartLine[],
  policy: PricingPolicy,
):
  | { readonly plan: BaseNoteSellingPlan }
  | { readonly reason: AddOnCartIneligibilityReason } {
  const subscriptionVariantIds = new Set(policy.baseNoteSubscriptionVariantIds);
  const candidates = lines.filter(
    (line) =>
      line.purchase.kind === "subscription" && subscriptionVariantIds.has(line.variantId),
  );

  if (candidates.length === 0) return { reason: "base_note_subscription_missing" };
  if (candidates.length !== 1) return { reason: "ambiguous_base_note_subscription_lines" };

  const line = candidates[0];
  if (!line) return { reason: "base_note_subscription_missing" };
  const purchase = line.purchase;
  if (purchase.kind !== "subscription") return { reason: "base_note_subscription_missing" };
  if (!purchase.sellingPlanId || !isSellingPlanGid(purchase.sellingPlanId)) {
    return { reason: "subscription_selling_plan_missing" };
  }
  if (line.currencyCode !== "USD") return { reason: "subscription_currency_not_supported" };
  if (line.quantity !== 1) return { reason: "subscription_quantity_invalid" };

  const matches = policy.plans.filter((plan) => plan.id === purchase.sellingPlanId);
  if (matches.length === 0) return { reason: "subscription_plan_unknown" };
  if (matches.length !== 1) return { reason: "subscription_plan_ambiguous" };
  const plan = matches[0];
  if (!plan || !hasCanonicalPlanPricing(plan) || line.unitPriceCents !== plan.firstCyclePriceCents) {
    return { reason: "subscription_plan_price_mismatch" };
  }
  return { plan };
}

function addOnLineRejection(line: PricingCartLine): AddOnLineRejectionReason | null {
  if (line.purchase.kind !== "one_time") return "not_a_one_time_purchase";
  if (line.exclusion !== "none") return "excluded_merchandise";
  if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) return "invalid_quantity";
  if (line.currencyCode !== "USD") return "unsupported_currency";
  if (!Number.isSafeInteger(line.unitPriceCents) || line.unitPriceCents < 0) {
    return "unsafe_discount_total";
  }
  if (line.unitPriceCents < ADD_ON_TARGET_UNIT_PRICE_CENTS) return "price_below_target";
  if (line.unitPriceCents === ADD_ON_TARGET_UNIT_PRICE_CENTS) return "price_already_at_target";
  return null;
}

function validateVariantAllowlist(
  variantIds: readonly string[],
  noEntriesIssue: PolicyConfigurationIssue,
  invalidIdIssue: PolicyConfigurationIssue,
  duplicateIdIssue: PolicyConfigurationIssue,
  issues: PolicyConfigurationIssue[],
): void {
  if (variantIds.length === 0) issues.push(noEntriesIssue);
  const seen = new Set<string>();
  for (const variantId of variantIds) {
    if (!isProductVariantGid(variantId)) issues.push(invalidIdIssue);
    if (seen.has(variantId)) issues.push(duplicateIdIssue);
    seen.add(variantId);
  }
}

function hasCanonicalPlanPricing(plan: BaseNoteSellingPlan): boolean {
  if (!isSafeNonNegativeInteger(plan.firstCyclePriceCents)) return false;
  if (!isSafeNonNegativeInteger(plan.recurringCyclePriceCents)) return false;
  return plan.kind === "intro"
    ? plan.firstCyclePriceCents === INTRO_FIRST_CYCLE_PRICE_CENTS &&
        plan.recurringCyclePriceCents === STANDARD_CYCLE_PRICE_CENTS
    : plan.firstCyclePriceCents === STANDARD_CYCLE_PRICE_CENTS &&
        plan.recurringCyclePriceCents === STANDARD_CYCLE_PRICE_CENTS;
}

function hasDuplicateLineId(lines: readonly PricingCartLine[]): boolean {
  const ids = new Set<string>();
  for (const line of lines) {
    if (line.id.trim().length === 0 || ids.has(line.id)) return true;
    ids.add(line.id);
  }
  return false;
}

function isSafeNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isCustomerGid(value: string): boolean {
  return /^gid:\/\/shopify\/Customer\/[1-9]\d*$/.test(value);
}

function isSellingPlanGid(value: string): boolean {
  return /^gid:\/\/shopify\/SellingPlan\/[1-9]\d*$/.test(value);
}

function isProductVariantGid(value: string): boolean {
  return /^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/.test(value);
}
