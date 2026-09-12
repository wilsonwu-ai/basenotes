#!/usr/bin/env python3
"""Apply Jeff's Base-Note-Shopify-Tags-2.csv to the 32 fragrance products.

HUMAN GATE BY TOPOLOGY, not by instruction: this script has no write path at all unless
--apply is passed AND a token is present. With no flags it prints a diff and exits 0.
Writing 32 live product records is not something a dry run can do by accident.

  dry run (default):  python3 scripts/apply_jeff_tags.py --csv <path>
  write:              python3 scripts/apply_jeff_tags.py --csv <path> --apply --token <shpat_...>
"""
import argparse, csv, json, sys, urllib.request

STORE = "basenotescent.com"
ADMIN = "https://base-note.myshopify.com/admin/api/2026-07"


def live_products():
    url = f"https://{STORE}/collections/all/products.json?limit=250"
    ps = json.load(urllib.request.urlopen(url))["products"]
    return {p["handle"]: p for p in ps if p["handle"] != "extra-5ml-vial-add-on"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--apply", action="store_true", help="actually write to Shopify")
    ap.add_argument("--token", help="shpat_ token with write_products")
    a = ap.parse_args()

    want = {r["Handle"]: [t.strip() for t in r["Tags"].split(",") if t.strip()]
            for r in csv.DictReader(open(a.csv))}
    live = live_products()

    missing = sorted(set(want) - set(live))
    extra = sorted(set(live) - set(want))
    if missing:
        print(f"!! {len(missing)} CSV handles not on the store: {missing}")
    if extra:
        print(f"!! {len(extra)} live products absent from the CSV (tags untouched): {extra}")

    changed = []
    for h, tags in want.items():
        if h not in live:
            continue
        cur = sorted(live[h]["tags"])
        new = sorted(tags)
        if cur != new:
            changed.append((h, cur, new))

    print(f"\n{len(changed)} of {len(want)} products would change tags.\n")
    for h, cur, new in changed:
        drop = [t for t in cur if t not in new]
        add = [t for t in new if t not in cur]
        print(f"  {h}")
        print(f"     - {', '.join(drop) if drop else '(none)'}")
        print(f"     + {', '.join(add) if add else '(none)'}")

    if not a.apply:
        print("\nDRY RUN. Nothing was written. Re-run with --apply --token <shpat_...> to write.")
        return 0

    if not a.token:
        print("\nREFUSED: --apply requires --token. No write attempted.", file=sys.stderr)
        return 2

    ok = 0
    for h, _cur, new in changed:
        pid = live[h]["id"]
        body = json.dumps({"product": {"id": pid, "tags": ", ".join(new)}}).encode()
        req = urllib.request.Request(
            f"{ADMIN}/products/{pid}.json", data=body, method="PUT",
            headers={"Content-Type": "application/json", "X-Shopify-Access-Token": a.token})
        try:
            urllib.request.urlopen(req)
            ok += 1
            print(f"  wrote {h}")
        except Exception as e:
            print(f"  FAILED {h}: {e}", file=sys.stderr)
    print(f"\n{ok}/{len(changed)} products updated.")
    return 0 if ok == len(changed) else 1


if __name__ == "__main__":
    sys.exit(main())
