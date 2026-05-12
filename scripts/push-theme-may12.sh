#!/usr/bin/env bash
# One-shot theme push for the May 12 sprint — modal handler + queue listener fix.
# Run from repo root:  bash scripts/push-theme-may12.sh
set -euo pipefail
cd "$(dirname "$0")/.."
shopify theme push \
  --store base-note.myshopify.com \
  --theme 158692901082 \
  --allow-live \
  --only sections/main-product.liquid \
  --only assets/queue-scheduler.js
