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

require '"type": "scent-studio-home"' templates/index.json
require '"type": "fragrance-catalog"' templates/collection.json
require 'Find scents that work for you.' sections/fragrance-catalog.liquid
require '$20 for your first fragrance' sections/fragrance-catalog.liquid
require '$18 for each one after' sections/fragrance-catalog.liquid
require "images['gLmqu.jpg']" sections/scent-studio-home.liquid
require "render 'vial-studio'" sections/scent-studio-home.liquid
require 'Monthly Rotation' sections/scent-studio-home.liquid
require 'monthly fragrance subscription' sections/scent-studio-home.liquid

require 'type="radio" name="id" value="{{ variant.id }}"' sections/main-product.liquid
require 'data-product-main-image' sections/main-product.liquid
require 'Your 5ml vial' sections/main-product.liquid
require 'Original fragrance' sections/main-product.liquid
require 'Ask about a full bottle' sections/main-product.liquid
require 'data-artifact-product-form' sections/main-product.liquid
require 'INTERNAL_ADDON_GUARD_COPY_START' sections/main-product.liquid
require 'data-artifact-consent' sections/main-product.liquid

require 'How would you like to order?' templates/cart.liquid
require 'One-time purchase' templates/cart.liquid
require 'Monthly Rotation <em>Subscription</em>' templates/cart.liquid
require "item.properties['Selected scent']" templates/cart.liquid
require 'item.url_to_remove' templates/cart.liquid
require 'name="updates[]"' templates/cart.liquid
require 'data-cart-consent' templates/cart.liquid
require 'window.__bnFetch' assets/basenote-commerce.js
require 'subscription option was not applied' assets/basenote-commerce.js

if rg -F -q 'case-forest' sections/scent-studio-home.liquid templates/index.json; then
  printf 'FAIL: retired homepage image is still referenced\n' >&2
  exit 1
fi

if rg -q 'default: 36000|4\.9.*214|4\.8 average rating|1,240\+ orders|Long-lasting drydown|Authentic house composition' sections/main-product.liquid templates/cart.liquid sections/scent-studio-home.liquid sections/fragrance-catalog.liquid; then
  printf 'FAIL: placeholder pricing, reviews, or fragrance facts are present\n' >&2
  exit 1
fi

printf 'PASS: Claude artifact storefront contract is present\n'
