"""Refresh the static booklet from public catalog endpoints (no browser session)."""

from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urljoin
import json

import requests


ROOT = Path(__file__).resolve().parent
MIRROR = "https://spesa-viterbo.vercel.app/"
LIDL = "https://lidl.everli.com"
EUROSPIN = "https://online.eurospin.com"
TIMEOUT = 40


def get_json(session, url, **kwargs):
    response = session.get(url, timeout=TIMEOUT, **kwargs)
    response.raise_for_status()
    return response.json()


def write_json(name, data):
    target = ROOT / name
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    temporary.replace(target)


def map_category(name, parent=""):
    text = name.lower()
    if "frutta e verdura" in text:
        return "vegetables"
    if any(word in text for word in ("frutta secca", "frutta a guscio", "semi", "noci", "mandorle", "anacardi")):
        return "nuts"
    if any(word in text for word in ("frutta", "fruit", "agrum", "mele", "pere", "banane")):
        return "fruit"
    if any(word in text for word in ("verdura", "vegetab", "ortaggi", "insalat", "funghi", "aglio", "cipoll", "carot", "pomodor", "patat", "broccol", "cavol", "zucchin", "peperon", "asparag")):
        return "vegetables"
    if any(word in text for word in ("carne", "macelleria", "pollo")):
        return "meat"
    if any(word in text for word in ("pesce", "ittico", "mare")):
        return "fish"
    if any(word in text for word in ("salumi", "gastronomia", "affettat")):
        return "deli"
    if any(word in text for word in ("formagg", "cheese")):
        return "cheese"
    if any(word in text for word in ("latticin", "latte", "uova", "burro", "yogurt")):
        return "dairy"
    if any(word in text for word in ("pane", "pasticceria", "forno")):
        return "bread"
    if any(word in text for word in ("pasta", "riso", "cereal")):
        return "pasta"
    if any(word in text for word in ("colazione", "biscott")):
        return "breakfast"
    if any(word in text for word in ("dolci", "snack", "cioccolat", "natale")):
        return "sweets"
    if any(word in text for word in ("surgel", "gelati")):
        return "frozen"
    if any(word in text for word in ("bevande", "acqua", "bibite", "succhi")):
        return "drinks"
    if any(word in text for word in ("birreria", "enoteca", "vino", "alcol")):
        return "alcohol"
    if any(word in text for word in ("caffè", "tè", "infusi")):
        return "coffee"
    if any(word in text for word in ("farine", "preparati", "zucchero")):
        return "baking"
    if any(word in text for word in ("dispensa", "sughi", "scatolame", "condimenti")):
        return "pantry"
    if any(word in text for word in ("bimbi", "bambini")):
        return "kids"
    if any(word in text for word in ("animali", "pets")):
        return "pets"
    if any(word in text for word in ("cura persona", "igiene", "cosmesi")):
        return "care"
    if any(word in text for word in ("cura casa", "pulizia")):
        return "cleaning"
    if any(word in text for word in ("giardino", "hobby")):
        return "garden"
    if any(word in text for word in ("casa", "elettrodomestici", "tecnologia")):
        return "home"
    if any(word in text for word in ("specialità", "vegetariano", "vegano")):
        return "special"
    return map_category(parent) if parent else "other"


def refresh_mirror(session):
    metadata = get_json(session, MIRROR + "meta.json")
    products = get_json(session, MIRROR + "products.json")
    if len(products) < 10_000 or not {"Coop", "Conad"}.issubset({p.get("store") for p in products}):
        raise ValueError("The base catalog is incomplete")
    products = [p for p in products if p["store"] in {"Coop", "Conad"}]
    for path in {p.get("image") for p in products if p.get("image")}:
        target = ROOT / path
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            response = session.get(urljoin(MIRROR, path), timeout=TIMEOUT)
            response.raise_for_status()
            target.write_bytes(response.content)
    metadata["date"] = date.today().isoformat()
    metadata["count"] = len(products)
    return metadata, products


def refresh_lidl(session):
    # Public city-center address, used only to select an available catalog.
    location = {
        "brand": "50", "postal_code": "00187", "address": "Piazza Venezia",
        "street_number": "1", "city": "Roma", "country": "Italy",
        "lat": "41.8959", "lng": "12.4823",
    }
    config = get_json(session, LIDL + "/api/config", params=location)
    store = config["config"]["store"]
    if store.get("brand_details", {}).get("slug") != "lidl":
        raise ValueError("Lidl catalog was not selected")
    tags = get_json(session, LIDL + "/api/tags")["tags"]
    items = {}
    for tag in tags:
        page = "/products?tags=" + tag["id"] + "&take=1000"
        while page:
            payload = get_json(session, LIDL + "/api" + page)
            for item in payload.get("data", []):
                raw_price = item.get("discounted_price") or item.get("price")
                if not raw_price:
                    continue
                category = next(
                    (mapped for section in item.get("categories", [])
                     if (mapped := map_category(section["name"])) != "other"),
                    map_category(tag["name"]),
                )
                product = {
                    "key": "lidl-everli-" + str(item["id"]),
                    "store": "Lidl",
                    "name_it": item["name"],
                    "category": category,
                    "price": round(raw_price / 100, 2),
                    "pack": item.get("short_description", ""),
                    "url": LIDL + "/products/" + str(tag["id"]) + "?product=" + str(item["id"]),
                    "image": item.get("thumbnail") or (item.get("images") or [""])[0],
                    "direct_image": True,
                }
                if item.get("discount") and item.get("price", 0) > raw_price:
                    product["note"] = "Акционная цена"
                items[product["key"]] = product
            page = payload.get("links", {}).get("next")
    if len(items) < 500:
        raise ValueError("Lidl catalog is unexpectedly small")
    return list(items.values())


def refresh_eurospin(session):
    response = get_json(session, EUROSPIN + "/ebsn/api/category")
    categories = response["data"]["categories"]
    items = {}
    for category in categories:
        page = 1
        while True:
            payload = get_json(session, EUROSPIN + "/ebsn/api/products", params={
                "parent_category_id": category["categoryId"], "page_size": 1000, "page": page,
            })
            data = payload["data"]
            for item in data.get("products", []):
                price = item.get("price")
                if price is None or price <= 0:
                    continue
                crumbs = item.get("breadCrumbs") or []
                section = crumbs[-1]["name"] if crumbs else category["name"]
                product = {
                    "key": "eurospin-" + str(item["productId"]),
                    "store": "Eurospin",
                    "name_it": item["name"],
                    "category": map_category(section, category["name"]),
                    "price": round(price, 2),
                    "pack": item.get("description", ""),
                    "url": urljoin(EUROSPIN, item.get("itemUrl") or "/"),
                    "image": item.get("mediaURLMedium") or item.get("mediaURL") or "",
                    "direct_image": True,
                }
                items[product["key"]] = product
            if page >= data["page"]["totPages"]:
                break
            page += 1
    if len(items) < 500:
        raise ValueError("Eurospin catalog is unexpectedly small")
    return list(items.values())


def main():
    session = requests.Session()
    session.headers.update({"User-Agent": "SpesaViterboBooklet/1.0 (+public catalog refresh)"})
    metadata, base = refresh_mirror(session)
    lidl = refresh_lidl(requests.Session())
    eurospin = refresh_eurospin(requests.Session())
    write_json("meta.json", metadata)
    write_json("products.json", base)
    write_json("lidl-products.json", lidl)
    write_json("eurospin-products.json", eurospin)
    write_json("sync-status.json", {
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": {"Coop": len([p for p in base if p["store"] == "Coop"]),
                    "Conad": len([p for p in base if p["store"] == "Conad"]),
                    "Lidl": len(lidl), "Eurospin": len(eurospin)},
    })
    print("Updated:", len(base), "Coop/Conad,", len(lidl), "Lidl,", len(eurospin), "Eurospin")


if __name__ == "__main__":
    main()
