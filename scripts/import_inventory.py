"""Normalise a mobile.de dealer-page export into src/data/inventory.json.

Input: the ad objects embedded in https://home.mobile.de/CAMPINGCENTEROVERATHGMBHCOKG
(extracted from the page's RSC payload).

The scheduled refresh (no API key) is scripts/sync-inventory.ts. It uses the same
field rules as normalise() below. This CLI remains the offline path for a
previously extracted ads JSON file.

Only fields present in the listing are carried over. Nothing is derived that the
listing does not state; contradictory values (e.g. title says "Automatik" while the
gearbox attribute says "Schaltgetriebe") are dropped and shown as "auf Anfrage".
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Listing images that are advertising graphics (monthly financing rates), not vehicle
# photos. Financing terms cannot be verified for this presentation, so they are skipped.
EXCLUDED_IMAGES = {
    "c9/c96f811a-a034-4a11-8e0d-3a9e163dddd7",
    "d4/d4bf933a-ecb2-4066-90d8-b01754e0bf57",
}

CATEGORY = {
    "Alcoves": ("alkoven", "Alkoven"),
    "PartlyIntegrated": ("teilintegriert", "Teilintegriert"),
    "VanMotorhome": ("kastenwagen", "Kastenwagen"),
    "Integrated": ("vollintegriert", "Vollintegriert"),
}


def num(s: str | None) -> int | None:
    if not s:
        return None
    digits = re.sub(r"[^\d]", "", s.split("(")[0])
    return int(digits) if digits else None


def slugify(s: str) -> str:
    s = s.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def clean_title(t: str) -> str:
    t = t.replace("!", "").replace("Austattung", "Ausstattung")
    return re.sub(r"\s+", " ", t).strip()


def normalise(ad: dict) -> dict:
    a = ad.get("attr", {})
    make = ad["make"]["localized"]
    title = clean_title(ad["title"])
    model = title[len(make):].strip() if title.lower().startswith(make.lower()) else title
    cat_key, cat_label = CATEGORY.get(a.get("c", ""), ("sonstige", ad.get("category") or "Wohnmobil"))
    is_new = a.get("con") == "Neufahrzeug" or bool(ad.get("isConditionNew"))

    transmission = a.get("tr")
    if transmission == "Schaltgetriebe" and "automatik" in title.lower():
        transmission = None

    pw = a.get("pw", "").replace("\xa0", " ")
    m = re.match(r"(\d+)\s*kW\s*\((\d+)\s*PS\)", pw)
    hu = a.get("gi")

    return {
        "id": str(ad["id"]),
        "slug": f"{'-'.join(slugify(make + ' ' + model).split('-')[:5])}-{ad['id']}",
        "title": title,
        "make": make,
        "model": model,
        "category": cat_key,
        "categoryLabel": cat_label,
        "condition": "neu" if is_new else "gebraucht",
        "price": ad["price"]["grs"]["amount"],
        "vatDeductible": bool(ad.get("vat")),
        "firstRegistration": a.get("fr"),
        "mileageKm": num(a.get("ml")),
        "powerKw": int(m.group(1)) if m else None,
        "powerPs": int(m.group(2)) if m else None,
        "fuel": a.get("ft"),
        "transmission": transmission,
        "lengthMm": num(a.get("le")),
        "grossWeightKg": num(a.get("lw")),
        "emissionClass": (a.get("emc") or "").replace("Euro6", "Euro 6") or None,
        "previousOwners": int(a["pvo"]) if a.get("pvo") else None,
        "huUntil": ("neu" if hu == "Neu" else hu) if hu else None,
        "color": a.get("ecol"),
        "modelYear": int(a["yc"]) if a.get("yc") else None,
        "highlights": [h.strip() for h in (ad.get("highlights") or []) if h.strip()],
        "images": [
            img
            for img in (i["uri"].split("/images/")[1] for i in ad.get("images", []))
            if img not in EXCLUDED_IMAGES
        ],
        "sourceUrl": f"https://suchen.mobile.de/fahrzeuge/details.html?id={ad['id']}",
    }


def main(src: str, snapshot_date: str) -> int:
    ads = json.load(open(src, encoding="utf-8"))
    vehicles = [normalise(ad) for ad in ads]
    vehicles.sort(key=lambda v: (v["condition"] != "gebraucht", v["price"]))
    out = {
        "source": "https://home.mobile.de/CAMPINGCENTEROVERATHGMBHCOKG",
        "snapshotDate": snapshot_date,
        "imageBase": "https://img.classistatic.de/api/v1/mo-prod/images/",
        "vehicles": vehicles,
    }
    dst = ROOT / "src/data/inventory.json"
    dst.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(vehicles)} vehicles -> {dst}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: import_inventory.py <ads.json> <YYYY-MM-DD>")
        sys.exit(2)
    sys.exit(main(sys.argv[1], sys.argv[2]))
