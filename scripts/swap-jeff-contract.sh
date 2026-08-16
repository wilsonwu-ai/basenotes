#!/usr/bin/env bash
# One-shot fix for Jeff's contract #173377067226: swap line item from
# Creed Green Irish Tweed → Parfums de Marly Perseus.
#
# Reads APPSTLE_API_KEY + APPSTLE_API_BASE from .env at the repo root.
# Uses the external v2 admin API (path: /api/external/v2/…), v3 swap.
#
# Usage from repo root:
#   bash scripts/swap-jeff-contract.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
CONTRACT_ID="173377067226"
SHOP="ath7ay-1y.myshopify.com"
PERSEUS_HANDLE="parfums-de-marly-perseus"
SHOP_BASE="https://basenotescent.com"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

if [ -z "${APPSTLE_API_KEY:-}" ] || [ -z "${APPSTLE_API_BASE:-}" ]; then
  echo "ERROR: APPSTLE_API_KEY or APPSTLE_API_BASE missing from .env" >&2
  exit 1
fi

echo "==> Fetching contract $CONTRACT_ID via list filter …"
curl -sS -H "X-API-Key: $APPSTLE_API_KEY" \
  "$APPSTLE_API_BASE/subscription-contract-details?subscriptionContractId=$CONTRACT_ID&page=0&size=1" \
  -o /tmp/jeff-contract.json

python3 -c "
import json, sys
with open('/tmp/jeff-contract.json') as f: raw = f.read()
try: d = json.loads(raw)
except Exception as e:
    print('Parse error:', e); print('Raw (first 400):', raw[:400]); sys.exit(2)
items = d if isinstance(d, list) else (d.get('content') or d.get('data') or [])
if not items:
    print('Contract not found. Raw response (first 400):'); print(raw[:400]); sys.exit(3)
c = items[0]
lines = c.get('lines') or c.get('lineItems') or []
line = lines[0] if lines else {}
old_variant = line.get('variantId') or (line.get('variant') or {}).get('id')
old_line_id = line.get('id') or line.get('lineId')
title = line.get('title') or line.get('productTitle') or ''
status = c.get('status', '')
import os
with open('/tmp/jeff-contract-state.env', 'w') as f:
    f.write(f'OLD_VARIANT={old_variant}\nOLD_LINE_ID={old_line_id}\nOLD_TITLE={title}\nSTATUS={status}\n')
print(f'    status        : {status}')
print(f'    current title : {title}')
print(f'    current variant: {old_variant}')
print(f'    line id       : {old_line_id}')
"

# shellcheck disable=SC1091
source /tmp/jeff-contract-state.env

if [ -z "${OLD_VARIANT:-}" ]; then
  echo "ERROR: failed to extract current variant from contract response" >&2
  exit 4
fi

echo "==> Resolving Perseus variant id from storefront …"
NEW_VARIANT="$(curl -sS "$SHOP_BASE/products/$PERSEUS_HANDLE.js" | python3 -c "
import json, sys
p = json.load(sys.stdin)
v = p.get('variants') or []
print(v[0]['id'] if v else '')
")"

if [ -z "$NEW_VARIANT" ]; then
  echo "ERROR: could not resolve $PERSEUS_HANDLE variant id from $SHOP_BASE" >&2
  exit 5
fi
echo "    new variant id: $NEW_VARIANT"

if [ "$NEW_VARIANT" = "$OLD_VARIANT" ]; then
  echo "==> No-op: contract already on target variant. Nothing to do."
  exit 0
fi

# Build v3 JSON body. Use oldVariants (array of one current variant ID) per schema.
BODY=$(python3 -c "
import json
print(json.dumps({
  'shop': '$SHOP',
  'contractId': int('$CONTRACT_ID'),
  'oldVariants': [int('$OLD_VARIANT')],
  'newVariants': { str('$NEW_VARIANT'): 1 }
}))
")

echo "==> Calling replace-variants-v3 …"
echo "    body: $BODY"
RESP_CODE="$(curl -sS -o /tmp/swap-resp.txt -w '%{http_code}' \
  -X POST \
  -H "X-API-Key: $APPSTLE_API_KEY" \
  -H "Content-Type: application/json" \
  --data "$BODY" \
  "$APPSTLE_API_BASE/subscription-contract-details/replace-variants-v3")"

echo "    HTTP $RESP_CODE"
if [ "$RESP_CODE" != "200" ] && [ "$RESP_CODE" != "201" ] && [ "$RESP_CODE" != "204" ]; then
  echo "ERROR: swap failed. Response body:" >&2
  cat /tmp/swap-resp.txt >&2
  echo >&2
  exit 6
fi

echo "==> Verifying — re-fetching contract …"
curl -sS -H "X-API-Key: $APPSTLE_API_KEY" \
  "$APPSTLE_API_BASE/subscription-contract-details?subscriptionContractId=$CONTRACT_ID&page=0&size=1" \
  | python3 -c "
import json, sys
d = json.load(sys.stdin)
items = d if isinstance(d, list) else (d.get('content') or d.get('data') or [])
if not items: print('verify: empty response'); sys.exit(0)
c = items[0]
lines = c.get('lines') or c.get('lineItems') or []
for l in lines:
    print(f'    line: title={l.get(\"title\") or l.get(\"productTitle\")} variantId={l.get(\"variantId\")}')
"

echo
echo "✅ Contract $CONTRACT_ID swap call returned $RESP_CODE."
echo "   Refresh Appstle admin → Upcoming Orders to see the change propagate."
