#!/usr/bin/env python3
"""
Base Note — generate a one-off UPS shipping label via the Freightcom API.

Freightcom is a multi-carrier aggregator: you send ONE shipment to Freightcom
and it brokers to UPS / FedEx / Purolator / etc. This script asks Freightcom
for rates, picks a UPS service, books the shipment, and downloads the label PDF.

Run it locally after filling out a shipment JSON file:

    python3 scripts/freightcom-ups-label.py --sample > shipment.json   # make a template
    # edit shipment.json: put in your real from/to addresses + package size/weight
    python3 scripts/freightcom-ups-label.py shipment.json              # get the label

The API key is read from .env (FREIGHTCOM_API_KEY). It never touches the theme
or the browser — labels can only be generated server-side, never from Liquid,
or the key would leak to every store visitor.

--------------------------------------------------------------------------------
VERIFY-AGAINST-YOUR-ACCOUNT NOTES
--------------------------------------------------------------------------------
Freightcom's live docs (https://developer.freightcom.com/) are behind a login,
so the three constants below reflect the v2 API's documented shape but should be
confirmed against the docs you see when logged in. They're isolated at the top
so a fix is a one-line edit:

  * BASE_URL        — the v2 customer API host
  * AUTH_HEADER     — Freightcom v2 uses a raw API key in the `Authorization`
                      header (NOT `Bearer <key>`). Confirm on the "Authentication"
                      page of your docs.
  * The rate/shipment JSON field names in build_rate_request().

Everything else (the async rate -> poll -> book -> poll -> download flow) is the
standard Freightcom v2 pattern.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# --- Constants to confirm against your logged-in docs (see docstring) ---------
BASE_URL = "https://external-api.freightcom.com"
AUTH_HEADER = "Authorization"  # value is the raw API key, no "Bearer " prefix
# ------------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = REPO_ROOT / ".env"

# How long to wait for the async rate/booking jobs before giving up.
POLL_INTERVAL_SECONDS = 3
POLL_TIMEOUT_SECONDS = 120


def load_api_key() -> str:
    if not ENV_PATH.exists():
        sys.exit(
            f"ERROR: {ENV_PATH} not found. Add a line:\n"
            "  FREIGHTCOM_API_KEY=your-key-here"
        )
    for line in ENV_PATH.read_text().splitlines():
        if line.startswith("FREIGHTCOM_API_KEY="):
            key = line.split("=", 1)[1].strip()
            if key:
                return key
    sys.exit("ERROR: FREIGHTCOM_API_KEY not found (or empty) in .env")


def api(method: str, path: str, key: str, body: dict | None = None) -> dict:
    """One HTTP call to the Freightcom API. Exits with the server's error body
    on a non-2xx so you can see exactly which field it rejected."""
    url = f"{BASE_URL}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            AUTH_HEADER: key,
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        sys.exit(f"ERROR: Freightcom returned HTTP {e.code} for {method} {path}:\n{detail}")
    except urllib.error.URLError as e:
        sys.exit(f"ERROR: could not reach Freightcom ({url}): {e.reason}")


def build_rate_request(shipment: dict) -> dict:
    """Map the simple shipment.json into Freightcom's v2 rate request body.

    Only `package` shipments are handled here (small parcels — what a UPS label
    normally is). LTL/freight/pallet shipments use a different packaging block.
    """
    origin = shipment["from"]
    dest = shipment["to"]
    pkg = shipment["package"]

    def party(p: dict) -> dict:
        return {
            "name": p["name"],
            "address": {
                "address_line_1": p["address"],
                "city": p["city"],
                "region": p["region"],          # province/state code, e.g. "ON" / "NY"
                "country": p["country"],         # ISO-2, e.g. "CA" / "US"
                "postal_code": p["postal_code"],
            },
            "residential": p.get("residential", False),
            "contact_name": p.get("contact_name", p["name"]),
            "phone_number": {"number": p["phone"], "extension": p.get("extension", "")},
            "email_addresses": [p["email"]] if p.get("email") else [],
        }

    return {
        # Empty `services` = quote every carrier/service; we filter to UPS after.
        "services": [],
        "excluded_services": [],
        "details": {
            "origin": party(origin),
            "destination": party(dest),
            "expected_ship_date": shipment.get("ship_date"),  # "YYYY-MM-DD" or null
            "packaging_type": "package",
            "packaging_properties": {
                "packages": [
                    {
                        "measurements": {
                            "weight": {"unit": pkg["weight_unit"], "value": pkg["weight"]},
                            "cuboid": {
                                "unit": pkg["dim_unit"],
                                "l": pkg["length"],
                                "w": pkg["width"],
                                "h": pkg["height"],
                            },
                        },
                        "description": pkg.get("description", "Merchandise"),
                    }
                ]
            },
        },
    }


def poll(path: str, key: str, done_when) -> dict:
    """Poll a GET endpoint until `done_when(payload)` is true or we time out."""
    deadline = time.monotonic() + POLL_TIMEOUT_SECONDS
    while True:
        payload = api("GET", path, key)
        if done_when(payload):
            return payload
        if time.monotonic() > deadline:
            sys.exit(f"ERROR: timed out after {POLL_TIMEOUT_SECONDS}s polling {path}")
        time.sleep(POLL_INTERVAL_SECONDS)


def is_ups(rate: dict) -> bool:
    carrier = (rate.get("carrier_name") or rate.get("carrier") or "").lower()
    service = (rate.get("service_name") or rate.get("service") or "").lower()
    return "ups" in carrier or "ups" in service


def rate_total(rate: dict) -> float:
    total = rate.get("total") or {}
    try:
        return float(total.get("value", total)) if isinstance(total, dict) else float(total)
    except (TypeError, ValueError):
        return float("inf")


def main() -> int:
    if len(sys.argv) == 2 and sys.argv[1] == "--sample":
        print(json.dumps(SAMPLE_SHIPMENT, indent=2))
        return 0
    if len(sys.argv) != 2:
        sys.exit(
            "usage:\n"
            "  python3 scripts/freightcom-ups-label.py --sample > shipment.json\n"
            "  python3 scripts/freightcom-ups-label.py shipment.json"
        )

    shipment_path = Path(sys.argv[1]).resolve()
    if not shipment_path.exists():
        sys.exit(f"ERROR: {shipment_path} not found. Run with --sample to make a template.")
    try:
        shipment = json.loads(shipment_path.read_text())
    except json.JSONDecodeError as e:
        sys.exit(f"ERROR: {shipment_path} is not valid JSON: {e}")

    key = load_api_key()

    # 1. Ask for rates (async job).
    print("Requesting rates from Freightcom...")
    started = api("POST", "/rate", key, build_rate_request(shipment))
    request_id = started.get("request_id") or started.get("id")
    if not request_id:
        sys.exit(f"ERROR: no rate request id in response: {started}")

    # 2. Poll until the rate job finishes.
    result = poll(
        f"/rate/{request_id}",
        key,
        done_when=lambda p: p.get("status", {}).get("done") is True
        or p.get("status") == "done"
        or bool(p.get("rates")),
    )
    rates = result.get("rates", [])
    if not rates:
        sys.exit("ERROR: Freightcom returned no rates for this shipment.")

    ups_rates = sorted((r for r in rates if is_ups(r)), key=rate_total)
    if not ups_rates:
        carriers = sorted({r.get("carrier_name", "?") for r in rates})
        sys.exit(
            "ERROR: no UPS service was quoted for this route/package.\n"
            f"Carriers that WERE quoted: {', '.join(carriers)}\n"
            "UPS may not be enabled on your Freightcom account for this lane."
        )

    print("\nUPS options:")
    for i, r in enumerate(ups_rates):
        svc = r.get("service_name", "UPS")
        eta = r.get("transit_time_days") or r.get("estimated_delivery_date") or "?"
        print(f"  [{i}] {svc:<32} ${rate_total(r):>8.2f}   ETA: {eta}")

    chosen = ups_rates[0]  # cheapest UPS; change the index to pick another
    service_id = chosen.get("service_id") or chosen.get("id")
    print(f"\nBooking: {chosen.get('service_name', 'UPS')} (service_id={service_id})")

    # 3. Book the shipment with the chosen service.
    book_body = build_rate_request(shipment)
    book_body["service_id"] = service_id
    book_body["payment_method"] = shipment.get("payment_method", "prepaid")
    booked = api("POST", "/shipment", key, book_body)
    shipment_id = booked.get("id") or booked.get("shipment_id")
    if not shipment_id:
        sys.exit(f"ERROR: no shipment id in booking response: {booked}")

    # 4. Poll until the label is generated.
    print(f"Shipment {shipment_id} created. Waiting for label...")
    final = poll(
        f"/shipment/{shipment_id}",
        key,
        done_when=lambda p: bool(p.get("labels") or p.get("label_url"))
        or p.get("status") in ("booked", "completed"),
    )

    label_url = final.get("label_url")
    if not label_url and isinstance(final.get("labels"), list) and final["labels"]:
        first = final["labels"][0]
        label_url = first.get("url") if isinstance(first, dict) else first
    tracking = final.get("tracking_number") or final.get("primary_tracking_number") or "?"

    if not label_url:
        sys.exit(
            "ERROR: shipment booked but no label URL was returned. "
            f"Full response:\n{json.dumps(final, indent=2)}"
        )

    # 5. Download the label PDF next to the shipment file.
    out_path = shipment_path.with_name(f"ups-label-{shipment_id}.pdf")
    req = urllib.request.Request(label_url, headers={AUTH_HEADER: key})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            out_path.write_bytes(resp.read())
    except urllib.error.URLError as e:
        sys.exit(f"ERROR: could not download label from {label_url}: {e}")

    print("\n✓ Label ready")
    print(f"  Carrier:  UPS — {chosen.get('service_name', '')}")
    print(f"  Cost:     ${rate_total(chosen):.2f}")
    print(f"  Tracking: {tracking}")
    print(f"  Saved to: {out_path}")
    return 0


SAMPLE_SHIPMENT = {
    "ship_date": "2026-07-20",
    "payment_method": "prepaid",
    "from": {
        "name": "Base Note",
        "contact_name": "Wilson Wu",
        "address": "123 Warehouse Rd",
        "city": "Toronto",
        "region": "ON",
        "country": "CA",
        "postal_code": "M5V 2T6",
        "phone": "4165551234",
        "email": "wilson@unionmade.net",
        "residential": False,
    },
    "to": {
        "name": "Jane Customer",
        "contact_name": "Jane Customer",
        "address": "500 5th Ave",
        "city": "New York",
        "region": "NY",
        "country": "US",
        "postal_code": "10110",
        "phone": "2125559876",
        "email": "jane@example.com",
        "residential": True,
    },
    "package": {
        "description": "Fragrance sample set",
        "weight": 0.5,
        "weight_unit": "kg",
        "length": 20,
        "width": 15,
        "height": 10,
        "dim_unit": "cm",
    },
}


if __name__ == "__main__":
    raise SystemExit(main())
