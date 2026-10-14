#!/usr/bin/env python3
"""One explicitly submitted Base Note video job; no retries, model fallbacks or top-ups.

Reuses the existing Base Note fal helper, not the UnionMade account configuration.
Default is a dry-run. --submit creates one saved receipt; later --poll resumes it.
Only project-owned/generated product and fictional-adult reference images are sent.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
import pathlib
import time
import urllib.error
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
CREATIVE = ROOT / 'creative' / 'coastal-scent-20260910'
ENDPOINT = 'bytedance/seedance-2.5/reference-to-video'
RECEIPT = CREATIVE / 'generation-receipt.json'
OUTPUT = CREATIVE / 'basenote-coastal-seedance-20s.mp4'
HELPER = pathlib.Path('/Users/wilsonwu/Desktop/basenote/scripts/gen_image.py')


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def fal_queue_url(url):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname != 'queue.fal.run':
        raise ValueError('Unexpected queue host; refusing to send credentials')
    return url


def provider_error(error):
    """Keep the reason, never the provider's echoed prompt/base64 input."""
    try:
        details = json.loads(error.read()).get('detail', [])
        if isinstance(details, list):
            return [{key: item[key] for key in ('loc', 'msg', 'type', 'url', 'ctx') if key in item}
                    for item in details if isinstance(item, dict)]
        return str(details)[:600]
    except (ValueError, AttributeError):
        return 'Provider returned an unreadable error; inspect its dashboard.'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--submit', action='store_true')
    mode.add_argument('--poll', action='store_true')
    args = parser.parse_args()
    images = [CREATIVE / 'product-reference.png', CREATIVE / 'coastal-model-reference.png']
    prompt = (CREATIVE / 'prompt.md').read_text().split('## Source and generation notes')[0]
    prompt = ('Reference roles: @Image1 is the exact single Base Note vial identity; '
              '@Image2 is the original adult woman and coastal setting. '
              'Do not render these as a split screen or reference sheet. '
              'Generate a continuous edited commercial following the shot times.\n\n' + prompt)
    summary = {
        'endpoint': ENDPOINT, 'duration': '20', 'resolution': '720p',
        'aspect_ratio': '9:16', 'generate_audio': True,
        'estimated_cost_usd': 9.50, 'estimate_not_invoice': True,
        'request_cap': 1, 'automatic_model_fallback': False,
        'references': [{'name': p.name, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in images],
        'prompt_sha256': hashlib.sha256(prompt.encode()).hexdigest(),
        'output': OUTPUT.name,
    }
    if not args.submit and not args.poll:
        print(json.dumps(summary, indent=2))
        return
    spec = importlib.util.spec_from_file_location('basenote_existing_fal', HELPER)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    helper.KEY = helper.load_key()
    if args.submit:
        if RECEIPT.exists() or OUTPUT.exists():
            raise RuntimeError('Receipt/output already exists; use --poll, never duplicate submission')
        payload = {key: summary[key] for key in ('duration', 'resolution', 'aspect_ratio', 'generate_audio')}
        payload.update({
            'task': 'reference', 'prompt': prompt, 'bitrate_mode': 'standard',
            'end_user_id': 'basenote-coastal-campaign-20260910',
            'image_urls': ['data:image/png;base64,' + base64.b64encode(p.read_bytes()).decode() for p in images],
        })
        receipt = {**summary, 'state': 'submission_started', 'started_at_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
        # Reserve the single attempt before network I/O, including ambiguous timeouts.
        save(RECEIPT, receipt)
        try:
            response = helper.req('POST', 'https://queue.fal.run/' + ENDPOINT, payload, timeout=120)
        except urllib.error.HTTPError as error:
            detail = provider_error(error)
            receipt.update(state='submission_rejected', http_status=error.code, message=detail)
            save(RECEIPT, receipt)
            raise RuntimeError(f'Provider rejected the request (HTTP {error.code}); no fallback or top-up attempted') from None
        receipt.update(state='queued', request_id=response['request_id'],
                       status_url=fal_queue_url(response['status_url']),
                       response_url=fal_queue_url(response['response_url']))
        save(RECEIPT, receipt)
        print('Submitted one video job; saved resumable receipt.', flush=True)
        return
    receipt = json.loads(RECEIPT.read_text())
    if receipt.get('state') in ('submission_rejected', 'generation_rejected'):
        raise RuntimeError('Saved provider rejection; no retries or alternate route. See generation-receipt.json')
    if receipt.get('state') == 'downloaded' and OUTPUT.exists():
        print('Video already downloaded: ' + str(OUTPUT))
        return
    if not receipt.get('request_id'):
        raise RuntimeError('No accepted request in receipt; resolve provider rejection/ambiguous submission first')
    status = helper.req('GET', fal_queue_url(receipt['status_url']) + '?logs=0')
    state = status.get('status', 'UNKNOWN')
    print('Video generation status: ' + state, flush=True)
    receipt['provider_status'] = state
    save(RECEIPT, receipt)
    if state != 'COMPLETED':
        if state in ('FAILED', 'ERROR', 'CANCELLED'):
            raise RuntimeError('Provider job did not complete successfully; no automatic retry')
        return
    try:
        result = helper.req('GET', fal_queue_url(receipt['response_url']))
    except urllib.error.HTTPError as error:
        detail = provider_error(error)
        receipt.update(state='generation_rejected', http_status=error.code, message=detail)
        save(RECEIPT, receipt)
        print(json.dumps(detail), flush=True)
        raise RuntimeError(f'Provider could not deliver the accepted job (HTTP {error.code}); no automatic retry') from None
    url = result.get('video', {}).get('url')
    parsed = urllib.parse.urlparse(url or '')
    if parsed.scheme != 'https' or not parsed.hostname:
        raise RuntimeError('Missing/invalid output URL')
    helper.download(url, OUTPUT)  # Public generated asset; no Authorization header.
    receipt.update(state='downloaded', source_url=url, bytes=OUTPUT.stat().st_size,
                   sha256=hashlib.sha256(OUTPUT.read_bytes()).hexdigest(), seed=result.get('seed'))
    save(RECEIPT, receipt)
    print('Downloaded video: ' + str(OUTPUT), flush=True)


if __name__ == '__main__':
    main()
