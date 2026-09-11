#!/bin/sh

set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

require_literal() {
  needle=$1
  file=$2
  rg -F -q -- "$needle" "$file" || fail "$file is missing: $needle"
}

# The helper product remains addressable as Shopify product JSON, but its HTML
# route must be non-indexable and must never advertise an unverified price.
require_literal "product.handle == 'extra-5ml-vial-add-on'" layout/theme.liquid
require_literal '<meta name="robots" content="noindex, follow">' layout/theme.liquid
require_literal "assign is_internal_addon_page = true" layout/theme.liquid
require_literal "assign is_commercial_product = false" snippets/meta-tags.liquid
require_literal "product.handle != 'extra-5ml-vial-add-on'" snippets/meta-tags.liquid

metadata_guard_count=$(rg -F -c "if is_commercial_product" snippets/meta-tags.liquid)
[ "$metadata_guard_count" -eq 2 ] || fail 'the add-on must be excluded from both OG price tags and Product offer JSON-LD'

guard_markup=$(sed -n '/INTERNAL_ADDON_GUARD_COPY_START/,/INTERNAL_ADDON_GUARD_COPY_END/p' sections/main-product.liquid)
printf '%s\n' "$guard_markup" | rg -F -q 'data-internal-addon-route-guard' || fail 'standalone add-on notice is missing'
printf '%s\n' "$guard_markup" | rg -q '<button[^>]+disabled' || fail 'standalone add-on control must be disabled'
if printf '%s\n' "$guard_markup" | rg -i -q '\$|money|selling_plan|<form'; then
  fail 'standalone add-on notice contains a price, selling-plan field, or purchase form'
fi

addon_copy=$(jq -r '.products.internal_addon[]' locales/en.default.json)
if printf '%s\n' "$addon_copy" | rg -i -q '\$|\bprice\b|13[.]50|\b18\b|\b20\b'; then
  fail 'standalone add-on copy contains a price promise'
fi

# Ordinary PDP commerce remains present, but only in the else branch.
purchase_markup=$(sed -n '/INTERNAL_ADDON_PURCHASE_UI_START/,/INTERNAL_ADDON_PURCHASE_UI_END/p' sections/main-product.liquid)
printf '%s\n' "$purchase_markup" | rg -F -q "form 'product', product" || fail 'ordinary PDP product form is missing'
printf '%s\n' "$purchase_markup" | rg -F -q 'data-product-form' || fail 'ordinary PDP form hook is missing'
printf '%s\n' "$purchase_markup" | rg -F -q 'id="addToCartButton"' || fail 'ordinary PDP add-to-cart control is missing'
require_literal '{%- unless is_internal_addon_product -%}' sections/main-product.liquid

if rg -q 'data-extra-vial-offer|addExtraVialToCartIfSelected|BaseNoteComparePrice|product-founding-proof|show_founding_proof|product-card__compare' sections/main-product.liquid snippets/product-card.liquid; then
  fail 'unsafe PR #47 add-on, comparison, or founding-proof implementation is present'
fi

# Narrow-screen fixes constrain their components; masking overflow on the page
# root is not an acceptable substitute.
mobile_guards=$(awk '
  /MOBILE_OVERFLOW_GUARD_START/ { capture = 1 }
  capture { print }
  /MOBILE_OVERFLOW_GUARD_END/ { capture = 0 }
' sections/header.liquid sections/hero.liquid snippets/cookie-consent.liquid)

if printf '%s\n' "$mobile_guards" | rg -U -i -q '(body|html)[^{]*\{[^}]*overflow(-x)?:[[:space:]]*hidden'; then
  fail 'mobile fix masks overflow on body or html'
fi

require_literal 'flex: 0 0 44px;' sections/header.liquid
require_literal 'width: min(100%, 300px);' sections/hero.liquid
require_literal 'grid-template-columns: repeat(2, minmax(0, 1fr));' snippets/cookie-consent.liquid
require_literal '.delivery-section .btn {' sections/delivery-explainer.liquid
require_literal 'white-space: normal;' sections/delivery-explainer.liquid
require_literal '.featured-collection-section .btn {' sections/featured-collection.liquid
require_literal 'white-space: normal;' sections/featured-collection.liquid

# Authored article SEO must survive rendering without title replacement or
# description truncation; ordinary page fallbacks retain their existing policy.
require_literal 'assign seo_title = page_title | default: article.title' layout/theme.liquid
require_literal "template.name == 'article' and page_description != blank" layout/theme.liquid
require_literal '{{ page_description | strip_html | escape_once }}' layout/theme.liquid
require_literal 'CART_ADDON_CONFIGURATION_GUARD' templates/cart.liquid
if rg -q "render 'cart-addon-picker'" templates/cart.liquid; then
  fail 'legacy one-time add-on picker must stay unrendered until recurring plan verification'
fi
require_literal '.featured-grid .product-card--placeholder .product-card__image {' sections/featured-collection.liquid
require_literal 'overflow-wrap: anywhere;' snippets/product-card.liquid
require_literal "product.handle == 'extra-5ml-vial-add-on'" snippets/product-card.liquid
require_literal "if (p.handle === 'extra-5ml-vial-add-on') return false;" sections/scent-quiz.liquid
selector_guard_count=$(rg -F -c "product.handle == 'extra-5ml-vial-add-on'" snippets/fragrance-selector.liquid)
[ "$selector_guard_count" -eq 2 ] || fail 'both account selector passes must skip the internal helper'

printf 'PASS: add-on route guard and responsive overflow invariants are present\n'
