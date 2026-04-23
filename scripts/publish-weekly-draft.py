#!/usr/bin/env python3
"""
Base Note — publish a weekly draft blog post to Shopify as UNPUBLISHED DRAFT.

Called by Wilson locally after pulling the weekly routine's commit:
    git pull
    python3 scripts/publish-weekly-draft.py growth-audit/blog-post-03-*.html

The script:
  1. Reads the HTML file and extracts title / slug / meta description heuristically.
  2. POSTs to Shopify Admin API as `published:false` so it lands in admin as a draft.
  3. Clears `template_suffix` so it renders with the theme's article.liquid (not
     Shopify's content-template preset).
  4. Prints the admin edit URL so Wilson can QA and click Publish in the UI.

The Admin API token is read from .env (SHOPIFY_ADMIN_API_ACCESS_TOKEN).
"""
from __future__ import annotations

import html as html_module
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

SHOP = "base-note.myshopify.com"
BLOG_ID = 102965346522  # "Hub" blog
REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = REPO_ROOT / ".env"


def load_token() -> str:
    if not ENV_PATH.exists():
        sys.exit(f"ERROR: {ENV_PATH} not found")
    for line in ENV_PATH.read_text().splitlines():
        if line.startswith("SHOPIFY_ADMIN_API_ACCESS_TOKEN="):
            return line.split("=", 1)[1].strip()
    sys.exit("ERROR: SHOPIFY_ADMIN_API_ACCESS_TOKEN not found in .env")


def extract_title(html: str, fallback: str) -> str:
    # Prefer first <h1>...</h1> in the HTML body (our template adds one, but the
    # article body itself usually doesn't). Fall back to the filename slug.
    m = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.DOTALL | re.IGNORECASE)
    if m:
        return re.sub(r"<[^>]+>", "", m.group(1)).strip()
    # Heuristic: first H2 if no H1
    m = re.search(r"<h2[^>]*>(.*?)</h2>", html, re.DOTALL | re.IGNORECASE)
    if m:
        return re.sub(r"<[^>]+>", "", m.group(1)).strip()
    return fallback


def extract_meta_description(html: str) -> str:
    # First <p> with real prose (not <em> disclosure).
    for m in re.finditer(r"<p[^>]*>(.*?)</p>", html, re.DOTALL | re.IGNORECASE):
        text = re.sub(r"<[^>]+>", "", m.group(1))
        text = html_module.unescape(text).strip()
        if len(text) > 60:  # skip tiny leading paragraphs
            # Trim to ~155 chars at a word boundary
            if len(text) <= 155:
                return text
            return text[:152].rsplit(" ", 1)[0] + "..."
    return "A Base Note post on fragrance, subscription economics, and picking scents without burning money on full bottles."


def slugify(text: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9\s-]", "", text.lower())
    s = re.sub(r"\s+", "-", s.strip())
    return s[:60].strip("-")


def post_article(token: str, article: dict) -> dict:
    url = f"https://{SHOP}/admin/api/2024-10/blogs/{BLOG_ID}/articles.json"
    req = urllib.request.Request(
        url,
        data=json.dumps({"article": article}).encode(),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-Shopify-Access-Token": token,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        sys.exit(f"ERROR: Shopify returned HTTP {e.code}: {body}")


def main() -> int:
    if len(sys.argv) != 2:
        sys.exit("usage: python3 scripts/publish-weekly-draft.py <path-to-html>")

    html_path = Path(sys.argv[1]).resolve()
    if not html_path.exists():
        sys.exit(f"ERROR: {html_path} not found")

    body_html = html_path.read_text(encoding="utf-8")
    if not body_html.strip():
        sys.exit(f"ERROR: {html_path} is empty")

    # Reject any non-ASCII char so Shopify doesn't mojibake it — the weekly
    # routine is instructed to use entities only. This is a safety net.
    non_ascii = [c for c in body_html if ord(c) > 127]
    if non_ascii:
        sys.exit(
            f"ERROR: {html_path} contains {len(non_ascii)} non-ASCII chars. "
            "Convert them to HTML entities before publishing. Offenders: "
            f"{sorted(set(non_ascii))}"
        )

    filename_slug = re.sub(r"^blog-post-\d+-", "", html_path.stem)
    title = extract_title(body_html, filename_slug.replace("-", " ").title())
    meta_description = extract_meta_description(body_html)
    handle = slugify(title)
    if not handle:
        handle = filename_slug

    print(f"Title: {title}")
    print(f"Handle: {handle}")
    print(f"Meta description: {meta_description}")
    print(f"Body length: {len(body_html)} chars")
    print(f"Source: {html_path}")
    print()

    token = load_token()

    article = {
        "title": title,
        "author": "Jeff Theefs",
        "handle": handle,
        "body_html": body_html,
        "summary_html": meta_description,
        "tags": "fragrance, subscription, guide",
        "published": False,  # DRAFT — Wilson publishes in admin after QA
        "template_suffix": None,  # Use theme's templates/article.liquid
    }

    result = post_article(token, article)
    created = result.get("article", {})
    article_id = created.get("id")
    live_handle = created.get("handle")

    if not article_id:
        sys.exit(f"ERROR: no article id in response: {result}")

    print(f"\n✓ Shopify article id: {article_id}")
    print(f"✓ Draft status (published={created.get('published_at') is not None})")
    print(f"✓ Admin edit URL:")
    print(f"  https://admin.shopify.com/store/base-note/articles/{article_id}")
    print()
    print("Next:")
    print(f"  1. Open the admin edit URL above.")
    print(f"  2. Review content, tweak meta title / meta description if needed, pick a featured image.")
    print(f"  3. Toggle Visibility to Visible, then Save.")
    print(f"  4. Post URL will be https://basenotescent.com/blogs/hub/{live_handle}")
    print(f"  5. Submit the URL to Google Search Console (URL Inspection -> Request indexing).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
