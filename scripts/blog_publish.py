#!/usr/bin/env python3
"""Base Note blog publisher — Admin GraphQL, idempotent by handle, supports scheduling.

Single post:
  python3 scripts/blog_publish.py --file growth-audit/blog-post-05-x.html --handle fragrance-notes-explained \
      --title "..." --summary "..." --tags "fragrance,guide" --image-url https://... --image-alt "..." \
      [--seo-title "..." --seo-description "..."] \
      [--publish-at 2026-08-20T12:00:00Z | --publish-now | --draft] [--dry-run | --validate-only]
Manifest (batch):
  python3 scripts/blog_publish.py --manifest growth-audit/blog-manifest.json [--only handle1,handle2] [--dry-run | --validate-only]
Utilities:
  --verify            fetch each ledger row's live URL / admin state and print
  --delete-handle H   delete an article (used for throwaway tests)
  --list              list all articles in the blog with state

Ledger: growth-audit/blog-ledger.json (handle -> gid, state, publish_at, url, updated).
Manifest rows can carry ``seo_title`` and ``seo_description``. Shopify stores article search-listing values in the
``global.title_tag`` and ``global.description_tag`` metafields; returned values are stored in the ledger and compared by
``--verify``. ``--validate-only`` builds and validates article payloads without credentials or network access.
Non-ASCII in the body is converted to numeric HTML entities (Shopify accepts UTF-8, but the theme/editor pipeline has bitten us before).
"""
import argparse, json, os, re, sys, pathlib, html, urllib.request, urllib.error, datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOP = "base-note.myshopify.com"
API = "2025-10"
BLOG_GID = "gid://shopify/Blog/102965346522"
BLOG_HANDLE = "hub"
SITE = "https://basenotescent.com"
LEDGER = ROOT / "growth-audit" / "blog-ledger.json"
DEFAULT_AUTHOR = "Jeff Theefs"
SEO_TITLE_MAX = 60
SEO_DESCRIPTION_MAX = 160

SEO_METAFIELDS = 'metafields(first: 2, keys: ["global.title_tag", "global.description_tag"]) { nodes { id namespace key type value } }'
Q_FIND = f"query FindArticle($q: String!) {{ articles(first: 5, query: $q) {{ nodes {{ id handle title isPublished publishedAt updatedAt {SEO_METAFIELDS} image {{ url altText }} blog {{ id handle }} }} }} }}"
Q_LIST = f"query ListArticles($after: String) {{ articles(first: 50, after: $after, sortKey: PUBLISHED_AT, reverse: true) {{ pageInfo {{ hasNextPage endCursor }} nodes {{ id handle title isPublished publishedAt updatedAt tags {SEO_METAFIELDS} image {{ url }} }} }} }}"
M_CREATE = f"mutation CreateArticle($article: ArticleCreateInput!) {{ articleCreate(article: $article) {{ article {{ id handle title isPublished publishedAt {SEO_METAFIELDS} image {{ url altText }} }} userErrors {{ field message code }} }} }}"
M_UPDATE = f"mutation UpdateArticle($id: ID!, $article: ArticleUpdateInput!) {{ articleUpdate(id: $id, article: $article) {{ article {{ id handle title isPublished publishedAt {SEO_METAFIELDS} image {{ url altText }} }} userErrors {{ field message code }} }} }}"
M_DELETE = "mutation DeleteArticle($id: ID!) { articleDelete(id: $id) { deletedArticleId userErrors { field message } } }"

def token():
    t = os.environ.get("SHOPIFY_ADMIN_API_ACCESS_TOKEN")
    if t: return t
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith("SHOPIFY_ADMIN_API_ACCESS_TOKEN="): return line.split("=", 1)[1].strip().strip('"')
    sys.exit("no SHOPIFY_ADMIN_API_ACCESS_TOKEN")

def gql(query, variables=None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    r = urllib.request.Request(f"https://{SHOP}/admin/api/{API}/graphql.json", data=body, method="POST",
        headers={"X-Shopify-Access-Token": token(), "Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=60) as resp:
        d = json.loads(resp.read().decode())
    if d.get("errors"): raise RuntimeError(json.dumps(d["errors"])[:800])
    return d["data"]

def to_entities(s):
    return "".join(c if ord(c) < 128 else f"&#{ord(c)};" for c in s)

def load_ledger():
    return json.loads(LEDGER.read_text()) if LEDGER.exists() else {"blog": BLOG_HANDLE, "articles": {}}

def save_ledger(l):
    l["updated_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    LEDGER.write_text(json.dumps(l, indent=2, sort_keys=True) + "\n")

def find_by_handle(handle):
    nodes = gql(Q_FIND, {"q": f"handle:{handle}"})["articles"]["nodes"]
    for n in nodes:
        if n["handle"] == handle and n["blog"]["handle"] == BLOG_HANDLE: return n
    return None

def derive_title(body):
    m = re.search(r"<h1[^>]*>(.*?)</h1>", body, re.S | re.I) or re.search(r"<h2[^>]*>(.*?)</h2>", body, re.S | re.I)
    return html.unescape(re.sub(r"<[^>]+>", "", m.group(1))).strip() if m else None

def derive_summary(body):
    for p in re.findall(r"<p[^>]*>(.*?)</p>", body, re.S | re.I):
        t = html.unescape(re.sub(r"<[^>]+>", "", p)).strip()
        if len(t) > 60: return (t[:152].rsplit(" ", 1)[0] + "...") if len(t) > 155 else t
    return None

def strip_h1(body):
    return re.sub(r"<h1[^>]*>.*?</h1>\s*", "", body, count=1, flags=re.S | re.I)

def seo_input(row):
    """Return Shopify's SEO input after fail-closed length/content validation."""
    seo = {}
    for source, target, limit in (
        ("seo_title", "title", SEO_TITLE_MAX),
        ("seo_description", "description", SEO_DESCRIPTION_MAX),
    ):
        if source not in row or row[source] is None:
            continue
        value = str(row[source]).strip()
        if not value:
            raise ValueError(f"{source} must not be blank when provided")
        if len(value) > limit:
            raise ValueError(f"{source} is {len(value)} characters; maximum is {limit}")
        seo[target] = value
    return seo or None

def read_seo(article):
    """Normalize Shopify's SEO metafield connection to ``title``/``description`` values."""
    nodes = ((article or {}).get("metafields") or {}).get("nodes") or []
    by_key = {m.get("key"): m.get("value") for m in nodes if m.get("namespace") == "global"}
    return {"title": by_key.get("title_tag"), "description": by_key.get("description_tag")}

def seo_metafields(seo, existing=None):
    """Build Article metafield inputs, using IDs when a search-listing metafield already exists."""
    if not seo:
        return None
    nodes = ((existing or {}).get("metafields") or {}).get("nodes") or []
    existing_by_key = {m.get("key"): m for m in nodes if m.get("namespace") == "global"}
    result = []
    for field, key in (("title", "title_tag"), ("description", "description_tag")):
        if field not in seo:
            continue
        old = existing_by_key.get(key)
        if old and old.get("id"):
            result.append({"id": old["id"], "value": seo[field]})
        else:
            result.append({"namespace": "global", "key": key, "type": "single_line_text_field", "value": seo[field]})
    return result

FIG_TMPL = ('<figure class="article__figure" style="margin:1.75em 0;">'
            '<img src="{url}" alt="{alt}" loading="lazy" decoding="async" width="{w}" height="{h}" style="width:100%;height:auto;border-radius:12px;display:block;">'
            '{cap}</figure>')

def wrap_tables(body):
    """Mobile: the theme's article template has no scroll container for wide tables, so wrap each <table> in one."""
    return re.sub(r"(<table\b.*?</table>)", r'<div class="bn-table-scroll" style="overflow-x:auto;-webkit-overflow-scrolling:touch;margin:1.25em 0;">\1</div>', body, flags=re.S | re.I)

VID_TMPL = ('<figure class="article__figure article__figure--video" style="margin:1.75em 0;">'
            '<video autoplay muted loop playsinline preload="metadata" poster="{poster}" aria-label="{alt}" '
            'style="width:100%;height:auto;border-radius:12px;display:block;background:#EEE9DE;">'
            '<source src="{url}" type="video/mp4"></video>{cap}</figure>')

def insert_videos(body, videos):
    """Replace <!-- video:ID --> placeholders. videos: {id: {url, poster, alt, caption?}}. Missing → removed."""
    videos = videos or {}
    def rep(m):
        v = videos.get(m.group(1).strip())
        if not v or not v.get("url"): return ""
        cap = f'<figcaption style="font-size:.85rem;color:#777;margin-top:.5em;">{html.escape(v["caption"])}</figcaption>' if v.get("caption") else ""
        return VID_TMPL.format(url=v["url"], poster=v.get("poster", ""), alt=html.escape(v.get("alt") or ""), cap=cap)
    return re.sub(r"<!--\s*video:([a-z0-9_-]+)\s*-->", rep, body, flags=re.I)

def insert_figures(body, inline):
    """Replace <!-- img:ID --> placeholders. inline: {id: {url, alt, caption?, w?, h?}}. Unknown ids are removed (never leaked to HTML)."""
    inline = inline or {}
    def rep(m):
        fid = m.group(1).strip()
        if fid == "hero": return ""  # hero is the featured image (theme renders it)
        f = inline.get(fid)
        if not f or not f.get("url"): return ""
        cap = f'<figcaption style="font-size:.85rem;color:#777;margin-top:.5em;">{html.escape(f["caption"])}</figcaption>' if f.get("caption") else ""
        return FIG_TMPL.format(url=f["url"], alt=html.escape(f.get("alt") or ""), w=f.get("w", 1536), h=f.get("h", 1024), cap=cap)
    return re.sub(r"<!--\s*img:([a-z0-9_-]+)\s*-->", rep, body, flags=re.I)

def prepare_article(row, existing=None):
    """Build and validate one Shopify Article input without using credentials or the network."""
    if not row.get("handle") or not row.get("file"):
        raise ValueError("handle and file are required")
    body_raw = (ROOT / row["file"]).read_text(encoding="utf-8")
    body = to_entities(wrap_tables(insert_videos(insert_figures(strip_h1(body_raw), row.get("inline")), row.get("videos"))))
    if "<!--META" in body: body = body.split("<!--META")[0]
    title = row.get("title") or derive_title(body_raw) or row["handle"].replace("-", " ").title()
    summary = row.get("summary") or derive_summary(body_raw) or ""
    tags = row.get("tags") or ["fragrance", "guide"]
    if isinstance(tags, str): tags = [t.strip() for t in tags.split(",") if t.strip()]
    art = {"title": title, "handle": row["handle"], "body": body, "summary": summary, "tags": tags,
           "author": {"name": row.get("author") or DEFAULT_AUTHOR}, "templateSuffix": row.get("template_suffix")}
    seo = seo_input(row)
    if seo: art["metafields"] = seo_metafields(seo, existing)
    if row.get("image_url"): art["image"] = {"url": row["image_url"], "altText": row.get("image_alt") or title}
    if row.get("publish_now"): art["isPublished"] = True
    elif row.get("publish_at"):
        art["isPublished"] = False; art["publishDate"] = row["publish_at"]
    else: art["isPublished"] = False
    return art, body, title, summary

def upsert(row, dry=False, validate_only=False):
    """Upsert a row; ``validate_only`` performs a credential-free, offline payload check."""
    art, body, title, summary = prepare_article(row)
    if validate_only:
        seo = seo_input(row) or {}
        print(f"VALID {row['handle']}: title={len(title)}ch seo_title={len(seo.get('title', ''))}ch "
              f"seo_description={len(seo.get('description', ''))}ch body={len(body)}ch summary={len(summary)}ch "
              f"pub={'now' if art.get('isPublished') else art.get('publishDate', 'draft')}")
        return art
    existing = find_by_handle(row["handle"])
    if existing and seo_input(row):
        art["metafields"] = seo_metafields(seo_input(row), existing)
    if dry:
        seo = seo_input(row) or {}
        print(f"DRY {'update' if existing else 'create'} {row['handle']}: title={title!r} "
              f"seo_title={len(seo.get('title', ''))}ch seo_description={len(seo.get('description', ''))}ch "
              f"pub={'now' if art.get('isPublished') else art.get('publishDate','draft')} "
              f"img={'yes' if 'image' in art else 'no'} body={len(body)}ch summary={len(summary)}ch")
        return None
    if existing:
        art_u = dict(art)
        if row.get("publish_at") and existing["isPublished"]:
            # already live: don't un-publish by accident
            art_u.pop("isPublished", None); art_u.pop("publishDate", None)
        res = gql(M_UPDATE, {"id": existing["id"], "article": art_u})["articleUpdate"]
    else:
        art["blogId"] = BLOG_GID
        res = gql(M_CREATE, {"article": art})["articleCreate"]
    if res["userErrors"]: raise RuntimeError(f"{row['handle']}: {res['userErrors']}")
    a = res["article"]
    returned_seo = read_seo(a)
    requested_seo = seo_input(row)
    if requested_seo:
        mismatches = {k: {"requested": v, "returned": returned_seo.get(k)}
                      for k, v in requested_seo.items() if returned_seo.get(k) != v}
        if mismatches:
            raise RuntimeError(f"{row['handle']}: SEO metafield readback mismatch: {mismatches}")
    l = load_ledger()
    l["articles"][row["handle"]] = {"gid": a["id"], "title": a["title"], "is_published": a["isPublished"], "published_at": a.get("publishedAt"),
        "scheduled_for": None if a["isPublished"] else row.get("publish_at"), "image": (a.get("image") or {}).get("url"),
        "seo_title": returned_seo.get("title"), "seo_description": returned_seo.get("description"),
        "url": f"{SITE}/blogs/{BLOG_HANDLE}/{a['handle']}", "file": row["file"], "updated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')}
    save_ledger(l)
    state = "LIVE" if a["isPublished"] else (f"SCHEDULED {row.get('publish_at')}" if row.get("publish_at") else "DRAFT")
    print(f"OK {'updated' if existing else 'created'} {a['handle']} [{state}] {a['id']}")
    return a

def verify():
    l = load_ledger()
    for h, r in sorted(l["articles"].items(), key=lambda kv: kv[1].get("scheduled_for") or kv[1].get("published_at") or ""):
        live = find_by_handle(h)
        code = "-"
        try:
            req = urllib.request.Request(r["url"], headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as resp: code = resp.status
        except urllib.error.HTTPError as e: code = e.code
        except Exception as e: code = str(e)[:30]
        expected = {k: r.get(f"seo_{k}") for k in ("title", "description")}
        if not any(v is not None for v in expected.values()):
            seo_state = "n/a"
        elif not live:
            seo_state = "missing"
        else:
            actual = read_seo(live)
            seo_state = "ok" if all(v is None or actual.get(k) == v for k, v in expected.items()) else "DIFF"
        print(f"{h:60s} admin={'LIVE' if live and live['isPublished'] else ('exists' if live else 'MISSING'):7s} "
              f"sched={r.get('scheduled_for') or '-':22s} seo={seo_state:7s} http={code}")

def list_all():
    after = None
    while True:
        d = gql(Q_LIST, {"after": after})["articles"]
        for n in d["nodes"]:
            seo = read_seo(n)
            seo_state = "y" if seo.get("title") and seo.get("description") else ("partial" if any(seo.values()) else "n")
            print(f"{'LIVE ' if n['isPublished'] else 'DRAFT'} {n.get('publishedAt') or '':22s} {n['handle']:60s} "
                  f"img={'y' if n.get('image') else 'n'} seo={seo_state} tags={n.get('tags')}")
        if not d["pageInfo"]["hasNextPage"]: break
        after = d["pageInfo"]["endCursor"]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file"); ap.add_argument("--handle"); ap.add_argument("--title"); ap.add_argument("--summary"); ap.add_argument("--tags")
    ap.add_argument("--author"); ap.add_argument("--image-url"); ap.add_argument("--image-alt")
    ap.add_argument("--seo-title"); ap.add_argument("--seo-description")
    ap.add_argument("--publish-at"); ap.add_argument("--publish-now", action="store_true"); ap.add_argument("--draft", action="store_true")
    ap.add_argument("--manifest"); ap.add_argument("--only")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="read Shopify, but do not write")
    mode.add_argument("--validate-only", action="store_true", help="validate payloads locally; no credentials or network")
    ap.add_argument("--verify", action="store_true"); ap.add_argument("--list", action="store_true"); ap.add_argument("--delete-handle")
    a = ap.parse_args()
    if a.list: return list_all()
    if a.verify: return verify()
    if a.delete_handle:
        ex = find_by_handle(a.delete_handle)
        if not ex: sys.exit("not found")
        res = gql(M_DELETE, {"id": ex["id"]})["articleDelete"]
        print(res); l = load_ledger(); l["articles"].pop(a.delete_handle, None); save_ledger(l); return
    rows = []
    if a.manifest:
        rows = json.loads((ROOT / a.manifest).read_text())
        if a.only: keep = set(a.only.split(",")); rows = [r for r in rows if r["handle"] in keep]
    else:
        if not (a.file and a.handle): sys.exit("--file and --handle required")
        rows = [{"handle": a.handle, "file": a.file, "title": a.title, "summary": a.summary, "tags": a.tags, "author": a.author,
                 "image_url": a.image_url, "image_alt": a.image_alt, "seo_title": a.seo_title,
                 "seo_description": a.seo_description, "publish_at": a.publish_at, "publish_now": a.publish_now, "draft": a.draft}]
    fails = 0
    for r in rows:
        try: upsert(r, dry=a.dry_run, validate_only=a.validate_only)
        except Exception as e: fails += 1; print(f"FAIL {r.get('handle')}: {e}", file=sys.stderr)
    if fails: sys.exit(1)

if __name__ == "__main__":
    main()
