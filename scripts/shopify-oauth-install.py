#!/usr/bin/env python3
"""
Base Note — one-time Shopify OAuth install helper.

Walks the OAuth install flow end-to-end on your machine. The client
secret never leaves your laptop; only the final access token is
written to .env. Delete this script after the token is obtained.

Usage:
    python3 scripts/shopify-oauth-install.py

You will be prompted for:
  - SHOPIFY_BLOG_API_CLIENT_ID
  - SHOPIFY_BLOG_API_CLIENT_SECRET
  - The full redirect URL from your browser after approving install

On success:
  - Appends SHOPIFY_ADMIN_API_ACCESS_TOKEN=<shpat_...> to .env (gitignored)
  - Verifies the token by calling GET /admin/api/2024-10/shop.json
"""
from __future__ import annotations

import getpass
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

SHOP = "base-note.myshopify.com"
REDIRECT_URI = "http://localhost:8080/auth/callback"
SCOPES = "write_content,read_content"
STATE = "basenote-oauth-2026"
ENV_PATH = Path(__file__).resolve().parent.parent / ".env"


def prompt(label: str, secret: bool = False) -> str:
    value = (getpass.getpass if secret else input)(f"{label}: ").strip()
    if not value:
        print(f"ERROR: {label} cannot be empty", file=sys.stderr)
        sys.exit(1)
    return value


def main() -> int:
    print("\nBase Note Shopify OAuth install helper\n" + "=" * 40)

    client_id = prompt("SHOPIFY_BLOG_API_CLIENT_ID (visible, paste from the app's Settings page)")
    client_secret = prompt("SHOPIFY_BLOG_API_CLIENT_SECRET (hidden input, paste and press enter)", secret=True)

    auth_url = (
        f"https://{SHOP}/admin/oauth/authorize?"
        + urllib.parse.urlencode(
            {
                "client_id": client_id,
                "scope": SCOPES,
                "redirect_uri": REDIRECT_URI,
                "state": STATE,
            }
        )
    )

    print("\nStep 1. Open this URL in your browser (you must be logged into Shopify admin for base-note.myshopify.com):\n")
    print(auth_url)
    print(
        "\nStep 2. Click the Install button when Shopify prompts you. Your browser will be redirected to"
        f" {REDIRECT_URI}?code=...&hmac=...&shop=...&state=... — the page will fail to load (nothing is running"
        " on localhost:8080, that's expected).\n"
    )
    print("Step 3. Copy the FULL URL from your browser's address bar and paste it below.\n")
    redirect_back = prompt("Full redirect URL from browser")

    parsed = urllib.parse.urlparse(redirect_back)
    qs = dict(urllib.parse.parse_qsl(parsed.query))
    code = qs.get("code")
    returned_state = qs.get("state")
    if not code:
        print("ERROR: no `code` parameter in the URL you pasted. Did Shopify redirect correctly?", file=sys.stderr)
        return 1
    if returned_state != STATE:
        print(
            f"ERROR: state mismatch. expected {STATE!r}, got {returned_state!r}. Aborting (possible CSRF).",
            file=sys.stderr,
        )
        return 1

    print("\nExchanging code for access_token…")
    token_url = f"https://{SHOP}/admin/oauth/access_token"
    payload = json.dumps({"client_id": client_id, "client_secret": client_secret, "code": code}).encode()
    req = urllib.request.Request(
        token_url,
        data=payload,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        print(f"ERROR: token exchange failed ({e.code}): {body}", file=sys.stderr)
        return 1

    access_token = data.get("access_token")
    if not access_token:
        print(f"ERROR: no access_token in Shopify response: {data!r}", file=sys.stderr)
        return 1

    print("✓ Got access token.")
    print(f"  Scope granted: {data.get('scope', '(not returned)')}")

    print("\nVerifying token with GET /admin/api/2024-10/shop.json …")
    shop_req = urllib.request.Request(
        f"https://{SHOP}/admin/api/2024-10/shop.json",
        headers={"X-Shopify-Access-Token": access_token, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(shop_req, timeout=30) as resp:
            shop = json.loads(resp.read()).get("shop", {})
    except urllib.error.HTTPError as e:
        print(f"WARN: shop.json verification failed ({e.code}): {e.read().decode(errors='replace')}", file=sys.stderr)
    else:
        print(f"✓ Token works. Store: {shop.get('name')} ({shop.get('myshopify_domain')})")
        print(f"  Plan: {shop.get('plan_name')}  Email: {shop.get('email')}")

    # Append to .env (idempotent: replace existing line if present)
    env_text = ENV_PATH.read_text() if ENV_PATH.exists() else ""
    lines = [ln for ln in env_text.splitlines() if not ln.startswith("SHOPIFY_ADMIN_API_ACCESS_TOKEN=")]
    lines.append(f"SHOPIFY_ADMIN_API_ACCESS_TOKEN={access_token}")
    ENV_PATH.write_text("\n".join(lines) + "\n")
    print(f"\n✓ Wrote SHOPIFY_ADMIN_API_ACCESS_TOKEN to {ENV_PATH} (existing line replaced if present).")
    print("\nYou can now tell Claude 'token is saved' and it will read from .env to create blog posts.")
    print("If you rotate or revoke the token later, re-run this script.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
