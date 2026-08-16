#!/usr/bin/env bash
# One-shot: publish the pillar now, schedule the 14 existing drafts + 12 new posts, then verify.
# Safe to re-run: the publisher is idempotent by handle (existing articles are updated, never duplicated).
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/blog_publish.py --manifest growth-audit/blog-manifest-pillar.json
python3 scripts/blog_publish.py --manifest growth-audit/blog-manifest.json
python3 scripts/blog_publish.py --manifest growth-audit/blog-manifest-new.json
python3 scripts/blog_publish.py --verify
