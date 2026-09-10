#!/bin/sh

set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

require() {
  rg -F -q -- "$1" "$2" || {
    printf 'FAIL: %s is missing %s\n' "$2" "$1" >&2
    exit 1
  }
}

require 'Find scents that work for you.' sections/jeff-storefront.liquid
require '$20 for your first fragrance' sections/jeff-storefront.liquid
require '$18 for each one after' sections/jeff-storefront.liquid
require "images['gLmqu.jpg']" sections/jeff-storefront.liquid
require "render 'vial-illustration'" sections/jeff-storefront.liquid
require 'Monthly Rotation' sections/jeff-storefront.liquid
require 'Our flexible fragrance subscription' sections/jeff-storefront.liquid

require 'data-artifact-size="vial"' sections/main-product.liquid
require 'data-artifact-size="bottle"' sections/main-product.liquid
require 'data-artifact-product-form' sections/main-product.liquid
require 'INTERNAL_ADDON_GUARD_COPY_START' sections/main-product.liquid

require 'How would you like to order?' templates/cart.liquid
require 'One-time purchase' templates/cart.liquid
require 'Subscribe &amp; save' templates/cart.liquid
require 'Monthly Rotation is a subscription' templates/cart.liquid
require 'data-cart-consent' templates/cart.liquid

if rg -F -q 'case-forest' sections/jeff-storefront.liquid templates/index.json; then
  printf 'FAIL: retired homepage image is still referenced\n' >&2
  exit 1
fi

printf 'PASS: Claude artifact storefront contract is present\n'
