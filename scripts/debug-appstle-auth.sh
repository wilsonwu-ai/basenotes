#!/usr/bin/env bash
# Probe what's wrong with Appstle Admin API auth, without revealing the secret.
# Tries a few canonical patterns and prints HTTP codes only.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
set -a; source "$REPO_ROOT/.env"; set +a

if [ -z "${APPSTLE_API_KEY:-}" ] || [ -z "${APPSTLE_API_BASE:-}" ]; then
  echo "missing key or base in .env"; exit 1
fi

echo "API base: $APPSTLE_API_BASE"
echo "Key prefix: ${APPSTLE_API_KEY:0:5}…  (length=${#APPSTLE_API_KEY})"
echo

ENDPOINT="$APPSTLE_API_BASE/subscription-contract-details?page=0&size=1"

echo "=== A: X-API-Key header ==="
curl -sS -o /tmp/a.txt -w "HTTP %{http_code}\n" \
  -H "X-API-Key: $APPSTLE_API_KEY" "$ENDPOINT"
head -c 300 /tmp/a.txt; echo; echo

echo "=== B: api_key query param ==="
curl -sS -o /tmp/b.txt -w "HTTP %{http_code}\n" \
  "${APPSTLE_API_BASE}/subscription-contract-details?api_key=${APPSTLE_API_KEY}&page=0&size=1"
head -c 300 /tmp/b.txt; echo; echo

echo "=== C: Authorization: Bearer ==="
curl -sS -o /tmp/c.txt -w "HTTP %{http_code}\n" \
  -H "Authorization: Bearer $APPSTLE_API_KEY" "$ENDPOINT"
head -c 300 /tmp/c.txt; echo; echo

echo "=== D: X-Api-Key (different case) ==="
curl -sS -o /tmp/d.txt -w "HTTP %{http_code}\n" \
  -H "X-Api-Key: $APPSTLE_API_KEY" "$ENDPOINT"
head -c 300 /tmp/d.txt; echo; echo

echo "=== E: ping a no-auth-required endpoint to confirm reachability ==="
curl -sS -o /tmp/e.txt -w "HTTP %{http_code}\n" "https://subscription-admin.appstle.com/v3/api-docs" | head -1
echo "spec endpoint reachable if HTTP 200 above"
