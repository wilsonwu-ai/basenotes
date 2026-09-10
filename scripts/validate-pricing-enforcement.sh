#!/usr/bin/env bash
# Static guardrail for the pricing decision record. This does not contact Shopify
# or Appstle and cannot prove live discounts or customer eligibility.
set -euo pipefail

script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
repo_root="$(CDPATH='' cd -- "$script_dir/.." && pwd)"
cd "$repo_root"

failures=0

require_text() {
  local file="$1"
  local text="$2"
  local label="$3"

  if rg -Fq -- "$text" "$file"; then
    printf 'PASS  %s\n' "$label"
  else
    printf 'FAIL  %s\n' "$label" >&2
    failures=$((failures + 1))
  fi
}

require_text \
  config/settings_schema.json \
  'subscription_first_order_price' \
  'theme retains a first-order display setting'
require_text \
  sections/main-product.liquid \
  'name="selling_plan"' \
  'PDP posts a Shopify selling plan for subscription purchases'
require_text \
  snippets/subscription-pricing-summary.liquid \
  'actual first-month discount is enforced by the Appstle selling plan' \
  'theme explicitly treats Appstle as the price authority'
require_text \
  templates/cart.liquid \
  'if has_subscription' \
  'add-on picker is only exposed in a subscription cart'
require_text \
  snippets/cart-addon-picker.liquid \
  'body: JSON.stringify({ id: Number(btn.getAttribute(' \
  'add-on picker creates a one-time cart line'
require_text \
  snippets/cart-addon-picker.liquid \
  'Add-on vials $18' \
  'source records the external add-on discount dependency'

if (( failures > 0 )); then
  printf '\nStatic result: FAILED (%d invariant(s) missing).\n' "$failures" >&2
  exit 1
fi

cat <<'EOF'

Static result: PASSED.

Not verifiable from this theme repository:
  - Appstle selling-plan IDs, first-cycle adjustments, and product attachment.
  - Whether a former subscriber is identified or blocked at checkout.
  - Shopify automatic-discount configuration, combination rules, and $18 totals.
  - Subscription renewal pricing after the initial order.

Before a live launch, run the checkout matrix in
docs/operations/2026-08-31-pricing-enforcement.md.
EOF
