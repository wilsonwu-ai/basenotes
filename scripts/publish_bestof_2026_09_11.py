#!/usr/bin/env python3
"""Merge the passing best-of-2026 manifests, validate media and markers, then schedule via blog_publish.py.

Usage: python3 publish_bestof.py <handle> [<handle> ...] [--go]
Without --go it validates and runs blog_publish.py --dry-run only. With --go it schedules the articles and
appends them to growth-audit/research/link-graph.json. Run the media worker deploy BEFORE --go: Shopify pulls
each hero image from its public URL when the article is created.
"""
import json
import os
import re
import subprocess
import sys

CW = '/private/tmp/basenote-content-bestof-20260911'
TAG = 'bestof-2026-09-11'
EXPECT = {
    'best-niche-fragrances-2026-ranked': '2026-09-15T16:00:00Z',
    'best-designer-colognes-2026-ranked': '2026-09-17T16:00:00Z',
    'best-winter-fragrances-men-2026-2027-guide': '2026-10-20T16:00:00Z',
}

handles = [a for a in sys.argv[1:] if not a.startswith('--')]
go = '--go' in sys.argv
rows, problems = [], []
for h in handles:
    manifest = json.load(open(f'{CW}/growth-audit/blog-manifest-{TAG}-{h}.json'))
    if not (isinstance(manifest, list) and len(manifest) == 1):
        problems.append(f'{h}: manifest must hold exactly one row')
        continue
    row = manifest[0]
    if row.get('publish_at') != EXPECT[h]:
        problems.append(f'{h}: publish_at {row.get("publish_at")} != {EXPECT[h]}')
    path = f'{CW}/{row["file"]}'
    if not os.path.exists(path):
        problems.append(f'{h}: missing article file {row["file"]}')
        continue
    for url in [row.get('image_url')] + [v.get('url') for v in (row.get('inline') or {}).values()]:
        if not url or '.workers.dev/' not in url:
            problems.append(f'{h}: bad media url {url}')
            continue
        local = f'{CW}/worker/media/public/' + url.split('.workers.dev/')[1]
        if not os.path.exists(local):
            problems.append(f'{h}: media not staged {local}')
    body = open(path, encoding='utf-8').read()
    if '—' in body:
        problems.append(f'{h}: em-dash in article')
    markers = set(re.findall(r'<!-- img:([\w-]+) -->', body))
    inline = set((row.get('inline') or {}).keys())
    if markers != inline:
        problems.append(f'{h}: markers {sorted(markers)} != inline {sorted(inline)}')
    rows.append(row)

print('rows', len(rows))
for p in problems:
    print('PROBLEM', p)
if problems or not rows:
    sys.exit(2)

merged = f'{CW}/growth-audit/blog-manifest-{TAG}.json'
json.dump(rows, open(merged, 'w'), indent=2)
print('merged ->', merged)

env = dict(os.environ)
for line in open('/Users/wilsonwu/Desktop/basenote/.env'):
    if line.startswith('SHOPIFY_ADMIN_API_ACCESS_TOKEN='):
        env['SHOPIFY_ADMIN_API_ACCESS_TOKEN'] = line.split('=', 1)[1].strip().strip('"')
cmd = ['python3', 'scripts/blog_publish.py', '--manifest', merged] + ([] if go else ['--dry-run'])
print('running:', ' '.join(cmd))
res = subprocess.run(cmd, cwd=CW, env=env, capture_output=True, text=True)
print(res.stdout[-4000:])
print(res.stderr[-2000:])
if res.returncode:
    sys.exit(res.returncode)

if go:
    graph_path = f'{CW}/growth-audit/research/link-graph.json'
    graph = json.load(open(graph_path))
    have = {g['handle'] for g in graph}
    for row in rows:
        if row['handle'] not in have:
            graph.append({'handle': row['handle'], 'title': row['title'], 'live': row['publish_at'][:10]})
    json.dump(graph, open(graph_path, 'w'), indent=2)
    print('link graph entries', len(graph))
