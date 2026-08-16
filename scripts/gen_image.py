#!/usr/bin/env python3
"""fal.ai image/video generator for Base Note content.

Usage:
  python3 scripts/gen_image.py --prompt "..." --out growth-audit/ai-images/blog/x/hero.jpg [--aspect 16:9] [--model fal-ai/nano-banana-2]
  python3 scripts/gen_image.py --video --image-url https://... --prompt "..." --out clip.mp4 [--model bytedance/seedance-2.0/image-to-video]
  python3 scripts/gen_image.py --batch jobs.json   # [{prompt,out,aspect?,model?,video?,image_url?}]

Reads FAL_KEY (or FAL_API_KEY) from env, then from .env in repo root.
Writes a sidecar <out>.prompt.json with model, prompt, params, request_id, source url.
Downscales/re-encodes JPEGs to <= --max-kb (default 300) using sips when available.
"""
import argparse, json, os, sys, time, subprocess, pathlib, urllib.request, urllib.error

ROOT = pathlib.Path(__file__).resolve().parent.parent
QUEUE = "https://queue.fal.run"
IMG_DEFAULT = "fal-ai/nano-banana-2"
IMG_FALLBACKS = ["fal-ai/nano-banana-pro", "fal-ai/flux-pro/v1.1-ultra", "fal-ai/gpt-image-1.5"]
VID_DEFAULT = "bytedance/seedance-2.0/image-to-video"
VID_FALLBACKS = ["bytedance/seedance-2.0/fast/image-to-video", "fal-ai/kling-video/v2.5-turbo/pro/image-to-video"]

def load_key():
    # .env wins over the shell (the shell profile may carry a stale key); FAL_KEY beats FAL_API_KEY.
    envf = ROOT / ".env"
    found = {}
    if envf.exists():
        for line in envf.read_text().splitlines():
            for k in ("FAL_KEY", "FAL_API_KEY"):
                if line.startswith(k + "="):
                    v = line.split("=", 1)[1].strip().strip('"').strip("'")
                    if v: found[k] = v
    for k in ("FAL_KEY", "FAL_API_KEY"):
        if found.get(k): return found[k]
    for k in ("FAL_KEY", "FAL_API_KEY"):
        if os.environ.get(k): return os.environ[k]
    sys.exit("no FAL_KEY / FAL_API_KEY found")

KEY = None
def req(method, url, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers={"Authorization": f"Key {KEY}", "Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return json.loads(resp.read().decode() or "{}")

def submit(model, payload, poll_every=3, max_wait=900):
    sub = req("POST", f"{QUEUE}/{model}", payload)
    rid = sub.get("request_id")
    status_url = sub.get("status_url") or f"{QUEUE}/{model}/requests/{rid}/status"
    resp_url = sub.get("response_url") or f"{QUEUE}/{model}/requests/{rid}"
    t0 = time.time()
    while True:
        st = req("GET", status_url + "?logs=0")
        s = st.get("status")
        if s == "COMPLETED": break
        if s in ("FAILED", "ERROR"): raise RuntimeError(f"fal {model} failed: {st}")
        if time.time() - t0 > max_wait: raise TimeoutError(f"fal {model} timed out after {max_wait}s")
        time.sleep(poll_every)
    return rid, req("GET", resp_url)

def download(url, out):
    out.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=120) as r, open(out, "wb") as f: f.write(r.read())

def shrink(out, max_kb):
    if out.suffix.lower() not in (".jpg", ".jpeg", ".png"): return
    try:
        # convert png->jpg is caller's choice via extension; sips can re-encode jpeg quality
        size = out.stat().st_size // 1024
        q = 85
        while size > max_kb and q >= 50:
            subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", str(q), str(out), "--out", str(out)], capture_output=True)
            size = out.stat().st_size // 1024; q -= 10
        w = 2000
        while size > max_kb and w >= 1000:
            subprocess.run(["sips", "-Z", str(w), str(out)], capture_output=True)
            size = out.stat().st_size // 1024; w -= 200
    except FileNotFoundError:
        pass

def openai_key():
    if os.environ.get("OPENAI_API_KEY"): return os.environ["OPENAI_API_KEY"]
    envf = ROOT / ".env"
    if envf.exists():
        for line in envf.read_text().splitlines():
            if line.startswith("OPENAI_API_KEY="): return line.split("=", 1)[1].strip().strip('"')
    return None

def gen_image_openai(prompt, out, aspect="16:9", max_kb=300, model="gpt-image-1"):
    """Fallback: OpenAI Images API (returns b64). Sizes: 1536x1024 (landscape), 1024x1536 (portrait), 1024x1024."""
    import base64
    key = openai_key()
    if not key: raise RuntimeError("no OPENAI_API_KEY")
    size = {"16:9": "1536x1024", "3:2": "1536x1024", "4:3": "1536x1024", "21:9": "1536x1024", "9:16": "1024x1536", "2:3": "1024x1536", "3:4": "1024x1536", "1:1": "1024x1024"}.get(aspect, "1536x1024")
    body = json.dumps({"model": model, "prompt": prompt, "n": 1, "size": size, "quality": "high", "output_format": "jpeg"}).encode()
    d = None
    for attempt in range(6):
        r = urllib.request.Request("https://api.openai.com/v1/images/generations", data=body, method="POST", headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(r, timeout=300) as resp: d = json.loads(resp.read().decode())
            break
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and attempt < 5:
                wait = 20 * (attempt + 1)
                print(f"WARN openai {e.code}; retry in {wait}s", file=sys.stderr); time.sleep(wait); continue
            try: detail = e.read().decode()[:300]
            except Exception: detail = ""
            raise RuntimeError(f"openai {e.code}: {detail}")
    if d is None: raise RuntimeError("openai: no response after retries")
    b64 = d["data"][0].get("b64_json")
    out = pathlib.Path(out); out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(base64.b64decode(b64)); shrink(out, max_kb)
    side = {"model": "openai/" + model, "prompt": prompt, "aspect": aspect, "size": size, "bytes": out.stat().st_size}
    out.with_suffix(out.suffix + ".prompt.json").write_text(json.dumps(side, indent=2))
    print(f"OK openai/{model} -> {out} ({out.stat().st_size//1024} KB)")
    return side

def gen_image(prompt, out, aspect="16:9", model=None, resolution="2K", extra=None, max_kb=300):
    out = pathlib.Path(out)
    if model == "openai": return gen_image_openai(prompt, out, aspect, max_kb)
    models = [model] if model else [IMG_DEFAULT] + IMG_FALLBACKS
    last = None
    for m in models:
        payload = {"prompt": prompt, "num_images": 1}
        if "nano-banana" in m: payload.update({"aspect_ratio": aspect, "resolution": resolution, "output_format": "jpeg"})
        elif "flux" in m: payload.update({"aspect_ratio": aspect, "output_format": "jpeg", "safety_tolerance": "2"})
        elif "gpt-image" in m: payload.update({"image_size": {"16:9": "1536x1024", "9:16": "1024x1536", "1:1": "1024x1024"}.get(aspect, "1536x1024"), "quality": "high"})
        if extra: payload.update(extra)
        try:
            rid, res = submit(m, payload)
            imgs = res.get("images") or ([res["image"]] if res.get("image") else [])
            if not imgs: raise RuntimeError(f"no images in response: {json.dumps(res)[:300]}")
            url = imgs[0]["url"]
            download(url, out); shrink(out, max_kb)
            side = {"model": m, "prompt": prompt, "aspect": aspect, "resolution": resolution, "request_id": rid, "source_url": url, "bytes": out.stat().st_size, "extra": extra}
            out.with_suffix(out.suffix + ".prompt.json").write_text(json.dumps(side, indent=2))
            print(f"OK {m} -> {out} ({out.stat().st_size//1024} KB)")
            return side
        except (urllib.error.HTTPError, RuntimeError, TimeoutError) as e:
            body = ""
            if isinstance(e, urllib.error.HTTPError):
                try: body = e.read().decode()[:400]
                except Exception: pass
            last = f"{m}: {e} {body}"
            print(f"WARN {last}", file=sys.stderr)
            continue
    # fal exhausted/locked → OpenAI fallback
    try:
        print(f"WARN fal unavailable ({str(last)[:80]}); falling back to OpenAI", file=sys.stderr)
        return gen_image_openai(prompt, out, aspect, max_kb)
    except Exception as e:
        raise SystemExit(f"all image models failed. fal last: {last}; openai: {e}")

def gen_video(prompt, out, image_url=None, model=None, duration=5, aspect="16:9", resolution="720p", max_wait=1200):
    out = pathlib.Path(out)
    models = [model] if model else [VID_DEFAULT] + VID_FALLBACKS
    last = None
    for m in models:
        payload = {"prompt": prompt, "duration": str(duration) if "seedance" in m else duration, "aspect_ratio": aspect}
        if "seedance" in m: payload.update({"resolution": resolution})
        if image_url: payload["image_url"] = image_url
        try:
            rid, res = submit(m, payload, poll_every=6, max_wait=max_wait)
            vid = res.get("video") or {}
            url = vid.get("url")
            if not url: raise RuntimeError(f"no video url: {json.dumps(res)[:300]}")
            download(url, out)
            side = {"model": m, "prompt": prompt, "image_url": image_url, "duration": duration, "aspect": aspect, "resolution": resolution, "request_id": rid, "source_url": url, "bytes": out.stat().st_size}
            out.with_suffix(out.suffix + ".prompt.json").write_text(json.dumps(side, indent=2))
            print(f"OK {m} -> {out} ({out.stat().st_size//1024} KB)")
            return side
        except (urllib.error.HTTPError, RuntimeError, TimeoutError) as e:
            body = ""
            if isinstance(e, urllib.error.HTTPError):
                try: body = e.read().decode()[:400]
                except Exception: pass
            last = f"{m}: {e} {body}"
            print(f"WARN {last}", file=sys.stderr)
            continue
    raise SystemExit(f"all video models failed. last: {last}")

def main():
    global KEY
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt"); ap.add_argument("--out"); ap.add_argument("--aspect", default="16:9")
    ap.add_argument("--model"); ap.add_argument("--resolution", default="2K"); ap.add_argument("--max-kb", type=int, default=300)
    ap.add_argument("--video", action="store_true"); ap.add_argument("--image-url"); ap.add_argument("--duration", type=int, default=5)
    ap.add_argument("--batch", help="json list of jobs"); ap.add_argument("--skip-existing", action="store_true")
    a = ap.parse_args()
    KEY = load_key()
    jobs = json.loads(pathlib.Path(a.batch).read_text()) if a.batch else [{"prompt": a.prompt, "out": a.out, "aspect": a.aspect, "model": a.model, "video": a.video, "image_url": a.image_url, "duration": a.duration, "resolution": a.resolution}]
    fails = 0
    for j in jobs:
        if a.skip_existing and pathlib.Path(j["out"]).exists(): print(f"skip {j['out']}"); continue
        try:
            if j.get("video"): gen_video(j["prompt"], j["out"], j.get("image_url"), j.get("model"), j.get("duration", 5), j.get("aspect", "16:9"), (j.get("resolution") if j.get("resolution") in ("480p", "720p", "1080p") else "720p"))
            else: gen_image(j["prompt"], j["out"], j.get("aspect", "16:9"), j.get("model"), j.get("resolution", a.resolution), j.get("extra"), a.max_kb)
        except (SystemExit, Exception) as e:
            fails += 1; print(f"FAIL {j.get('out')}: {e}", file=sys.stderr)
    if fails: sys.exit(1)

if __name__ == "__main__":
    main()
