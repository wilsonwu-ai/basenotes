#!/usr/bin/env python3
"""Base Note blog publisher — Admin GraphQL, idempotent by handle, supports scheduling.

Single post:
  python3 scripts/blog_publish.py --file growth-audit/blog-post-05-x.html --handle fragrance-notes-explained \
      --title "..." --summary "..." --tags "fragrance,guide" --image-url https://... --image-alt "..." \
      [--publish-at 2026-08-20T12:00:00Z | --publish-now | --draft] [--dry-run]
Manifest (batch):
  python3 scripts/blog_publish.py --manifest growth-audit/blog-manifest.json [--only handle1,handle2] [--dry-run]
Utilities:
  --verify            fetch each ledger row's live URL / admin state and print
  --delete-handle H   delete an article (used for throwaway tests)
  --list              list all articles in the blog with state

Ledger: growth-audit/blog-ledger.json (handle -> gid, state, publish_at, url, updated).
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

Q_FIND = "query FindArticle($q: String!) { articles(first: 5, query: $q) { nodes { id handle title isPublished publishedAt updatedAt image { url altText } blog { id handle } } } }"
Q_LIST = "query ListArticles($after: String) { articles(first: 50, after: $after, sortKey: PUBLISHED_AT, reverse: true) { pageInfo { hasNextPage endCursor } nodes { id handle title isPublished publishedAt updatedAt tags image { url } } } }"
M_CREATE = "mutation CreateArticle($article: ArticleCreateInput!) { articleCreate(article: $article) { article { id handle title isPublished publishedAt image { url altText } } userErrors { field message code } } }"
M_UPDATE = "mutation UpdateArticle($id: ID!, $article: ArticleUpdateInput!) { articleUpdate(id: $id, article: $article) { article { id handle title isPublished publishedAt image { url altText } } userErrors { field message code } } }"
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

FIG_TMPL = ('<figure class="article__figure" style="margin:1.75em 0;">'
            '<img src="{url}" alt="{alt}" loading="lazy" decoding="async" width="{w}" height="{h}" style="width:100%;height:auto;border-radius:12px;display:block;">'
            '{cap}</figure>')

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

def upsert(row, dry=False):
    """row: {handle, file, title?, summary?, tags?, author?, image_url?, image_alt?, publish_at?|publish_now?|draft?}"""
    body_raw = (ROOT / row["file"]).read_text(encoding="utf-8")
    body = to_entities(insert_figures(strip_h1(body_raw), row.get("inline")))
    if "<!--META" in body: body = body.split("<!--META")[0]
    title = row.get("title") or derive_title(body_raw) or row["handle"].replace("-", " ").title()
    summary = row.get("summary") or derive_summary(body_raw) or ""
    tags = row.get("tags") or ["fragrance", "guide"]
    if isinstance(tags, str): tags = [t.strip() for t in tags.split(",") if t.strip()]
    art = {"title": title, "handle": row["handle"], "body": body, "summary": summary, "tags": tags,
           "author": {"name": row.get("author") or DEFAULT_AUTHOR}, "templateSuffix": row.get("template_suffix")}
    if row.get("image_url"): art["image"] = {"url": row["image_url"], "altText": row.get("image_alt") or title}
    if row.get("publish_now"): art["isPublished"] = True
    elif row.get("publish_at"):
        art["isPublished"] = False; art["publishDate"] = row["publish_at"]
    else: art["isPublished"] = False
    existing = find_by_handle(row["handle"])
    if dry:
        print(f"DRY {'update' if existing else 'create'} {row['handle']}: title={title!r} pub={'now' if art.get('isPublished') else art.get('publishDate','draft')} img={'yes' if 'image' in art else 'no'} body={len(body)}ch summary={len(summary)}ch")
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
    l = load_ledger()
    l["articles"][row["handle"]] = {"gid": a["id"], "title": a["title"], "is_published": a["isPublished"], "published_at": a.get("publishedAt"),
        "scheduled_for": None if a["isPublished"] else row.get("publish_at"), "image": (a.get("image") or {}).get("url"),
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
        print(f"{h:60s} admin={'LIVE' if live and live['isPublished'] else ('exists' if live else 'MISSING'):7s} sched={r.get('scheduled_for') or '-':22s} http={code}")

def list_all():
    after = None
    while True:
        d = gql(Q_LIST, {"after": after})["articles"]
        for n in d["nodes"]:
            print(f"{'LIVE ' if n['isPublished'] else 'DRAFT'} {n.get('publishedAt') or '':22s} {n['handle']:60s} img={'y' if n.get('image') else 'n'} tags={n.get('tags')}")
        if not d["pageInfo"]["hasNextPage"]: break
        after = d["pageInfo"]["endCursor"]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file"); ap.add_argument("--handle"); ap.add_argument("--title"); ap.add_argument("--summary"); ap.add_argument("--tags")
    ap.add_argument("--author"); ap.add_argument("--image-url"); ap.add_argument("--image-alt")
    ap.add_argument("--publish-at"); ap.add_argument("--publish-now", action="store_true"); ap.add_argument("--draft", action="store_true")
    ap.add_argument("--manifest"); ap.add_argument("--only"); ap.add_argument("--dry-run", action="store_true")
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
                 "image_url": a.image_url, "image_alt": a.image_alt, "publish_at": a.publish_at, "publish_now": a.publish_now, "draft": a.draft}]
    fails = 0
    for r in rows:
        try: upsert(r, dry=a.dry_run)
        except Exception as e: fails += 1; print(f"FAIL {r.get('handle')}: {e}", file=sys.stderr)
    if fails: sys.exit(1)

if __name__ == "__main__":
    main()
