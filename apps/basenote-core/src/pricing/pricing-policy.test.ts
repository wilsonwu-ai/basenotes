import assert from "node:assert/strict";
import test from "node:test";

import {
  ADD_ON_TARGET_UNIT_PRICE_CENTS,
  INTRO_FIRST_CYCLE_PRICE_CENTS,
  STANDARD_CYCLE_PRICE_CENTS,
  evaluateAddOnDiscounts,
  evaluateIntroEligibility,
  type AddOnDiscountInput,
  type IntroEligibilityInput,
  type PricingCartLine,
  type PricingPolicy,
  validatePricingPolicy,
} from "./pricing-policy.js";

const CUSTOMER = {
  kind: "authenticated" as const,
  customerId: "gid://shopify/Customer/1",
  subscriptionHistory: "durably_never_subscribed" as const,
};

const INTRO_PLAN_ID = "gid://shopify/SellingPlan/11";
const STANDARD_PLAN_ID = "gid://shopify/SellingPlan/12";
const SUBSCRIPTION_VARIANT_ID = "gid://shopify/ProductVariant/101";
const ADD_ON_VIAL_VARIANT_ID = "gid://shopify/ProductVariant/201";

const policy: PricingPolicy = {
  plans: [
    {
      id: INTRO_PLAN_ID,
      kind: "intro",
      firstCyclePriceCents: INTRO_FIRST_CYCLE_PRICE_CENTS,
      recurringCyclePriceCents: STANDARD_CYCLE_PRICE_CENTS,
    },
    {
      id: STANDARD_PLAN_ID,
      kind: "standard",
      firstCyclePriceCents: STANDARD_CYCLE_PRICE_CENTS,
      recurringCyclePriceCents: STANDARD_CYCLE_PRICE_CENTS,
    },
  ],
  baseNoteSubscriptionVariantIds: [SUBSCRIPTION_VARIANT_ID],
  eligibleAddOnVialVariantIds: [ADD_ON_VIAL_VARIANT_ID],
};

function introInput(overrides: Partial<IntroEligibilityInput> = {}): IntroEligibilityInput {
  return {
    customer: CUSTOMER,
    requestedSellingPlanId: INTRO_PLAN_ID,
    policy,
    ...overrides,
  };
}

function subscriptionLine(overrides: Partial<PricingCartLine> = {}): PricingCartLine {
  return {
    id: "subscription-line",
    variantId: SUBSCRIPTION_VARIANT_ID,
    quantity: 1,
    unitPriceCents: STANDARD_CYCLE_PRICE_CENTS,
    currencyCode: "USD",
    purchase: { kind: "subscription", sellingPlanId: STANDARD_PLAN_ID },
    exclusion: "none",
    ...overrides,
  };
}

function addOnLine(overrides: Partial<PricingCartLine> = {}): PricingCartLine {
  return {
    id: "add-on-line",
    variantId: ADD_ON_VIAL_VARIANT_ID,
    quantity: 1,
    unitPriceCents: 2_000,
    currencyCode: "USD",
    purchase: { kind: "one_time" },
    exclusion: "none",
    ...overrides,
  };
}

function addOnInput(overrides: Partial<AddOnDiscountInput> = {}): AddOnDiscountInput {
  return {
    lines: [subscriptionLine(), addOnLine()],
    policy,
    ...overrides,
  };
}

test("intro is available only to an authenticated customer with durable never-subscribed history", () => {
  assert.deepEqual(evaluateIntroEligibility(introInput()), {
    eligible: true,
    sellingPlanId: INTRO_PLAN_ID,
    firstCyclePriceCents: 1_500,
    recurringCyclePriceCents: 2_000,
  });
});

test("intro fails closed for guests, unknown history, and former members", () => {
  assert.deepEqual(evaluateIntroEligibility(introInput({ customer: { kind: "guest" } })), {
    eligible: false,
    reason: "guest_checkout",
  });
  assert.deepEqual(
    evaluateIntroEligibility(
      introInput({ customer: { ...CUSTOMER, subscriptionHistory: "unknown" } }),
    ),
    { eligible: false, reason: "subscription_history_not_verified" },
  );
  assert.deepEqual(
    evaluateIntroEligibility(
      introInput({ customer: { ...CUSTOMER, subscriptionHistory: "durably_ever_subscribed" } }),
    ),
    { eligible: false, reason: "customer_has_subscription_history" },
  );
});

test("intro refuses standard, unknown, and incorrectly-priced plans", () => {
  assert.deepEqual(evaluateIntroEligibility(introInput({ requestedSellingPlanId: STANDARD_PLAN_ID })), {
    eligible: false,
    reason: "requested_plan_is_not_intro",
  });
  assert.deepEqual(
    evaluateIntroEligibility(introInput({ requestedSellingPlanId: "gid://shopify/SellingPlan/999" })),
    { eligible: false, reason: "selling_plan_unknown" },
  );
  const mispricedPolicy: PricingPolicy = {
    ...policy,
    plans: policy.plans.map((plan) =>
      plan.kind === "intro" ? { ...plan, firstCyclePriceCents: 1_499 } : plan,
    ),
  };
  assert.deepEqual(evaluateIntroEligibility(introInput({ policy: mispricedPolicy })), {
    eligible: false,
    reason: "policy_configuration_invalid",
  });
});

test("a valid subscription line makes a qualifying one-time vial exactly $18 per unit", () => {
  const result = evaluateAddOnDiscounts(
    addOnInput({ lines: [subscriptionLine(), addOnLine({ quantity: 2 })] }),
  );
  assert.equal(result.cartEligible, true);
  if (!result.cartEligible) return assert.fail("expected a cart-eligible result");
  assert.equal(result.subscriptionSellingPlanId, STANDARD_PLAN_ID);
  assert.deepEqual(result.discounts, [
    {
      lineId: "add-on-line",
      variantId: ADD_ON_VIAL_VARIANT_ID,
      quantity: 2,
      originalUnitPriceCents: 2_000,
      targetUnitPriceCents: ADD_ON_TARGET_UNIT_PRICE_CENTS,
      totalDiscountCents: 400,
    },
  ]);
  assert.deepEqual(result.rejectedLines, []);
});

test("add-on pricing requires a current-cart Base Note subscription", () => {
  assert.deepEqual(evaluateAddOnDiscounts(addOnInput({ lines: [addOnLine()] })), {
    cartEligible: false,
    reason: "base_note_subscription_missing",
    discounts: [],
    rejectedLines: [],
  });
});

test("ambiguous, unknown, and tampered subscription plans never unlock the add-on", () => {
  assert.deepEqual(
    evaluateAddOnDiscounts(
      addOnInput({ lines: [subscriptionLine(), subscriptionLine({ id: "subscription-line-2" }), addOnLine()] }),
    ),
    {
      cartEligible: false,
      reason: "ambiguous_base_note_subscription_lines",
      discounts: [],
      rejectedLines: [],
    },
  );
  assert.deepEqual(
    evaluateAddOnDiscounts(
      addOnInput({
        lines: [
          subscriptionLine({ purchase: { kind: "subscription", sellingPlanId: "gid://shopify/SellingPlan/99" } }),
          addOnLine(),
        ],
      }),
    ),
    {
      cartEligible: false,
      reason: "subscription_plan_unknown",
      discounts: [],
      rejectedLines: [],
    },
  );
  assert.deepEqual(
    evaluateAddOnDiscounts(
      addOnInput({ lines: [subscriptionLine({ unitPriceCents: 1_900 }), addOnLine()] }),
    ),
    {
      cartEligible: false,
      reason: "subscription_plan_price_mismatch",
      discounts: [],
      rejectedLines: [],
    },
  );
});

test("under-target prices and excluded or non-one-time merchandise are never discounted", () => {
  const result = evaluateAddOnDiscounts(
    addOnInput({
      lines: [
        subscriptionLine(),
        addOnLine({ id: "under", unitPriceCents: 1_799 }),
        addOnLine({ id: "at-target", unitPriceCents: 1_800 }),
        addOnLine({ id: "giveaway", exclusion: "giveaway" }),
        addOnLine({ id: "subscription-vial", purchase: { kind: "subscription", sellingPlanId: STANDARD_PLAN_ID } }),
      ],
    }),
  );
  assert.equal(result.cartEligible, true);
  if (!result.cartEligible) return assert.fail("expected a cart-eligible result");
  assert.deepEqual(result.discounts, []);
  assert.deepEqual(result.rejectedLines, [
    { lineId: "under", reason: "price_below_target" },
    { lineId: "at-target", reason: "price_already_at_target" },
    { lineId: "giveaway", reason: "excluded_merchandise" },
    { lineId: "subscription-vial", reason: "not_a_one_time_purchase" },
  ]);
});

test("invalid reviewed configuration fails closed before it can grant a benefit", () => {
  const invalidPolicy: PricingPolicy = {
    ...policy,
    eligibleAddOnVialVariantIds: [ADD_ON_VIAL_VARIANT_ID, ADD_ON_VIAL_VARIANT_ID],
  };
  assert.deepEqual(validatePricingPolicy(invalidPolicy), ["duplicate_add_on_vial_variant_id"]);
  assert.deepEqual(evaluateAddOnDiscounts(addOnInput({ policy: invalidPolicy })), {
    cartEligible: false,
    reason: "policy_configuration_invalid",
    discounts: [],
    rejectedLines: [],
  });
});
