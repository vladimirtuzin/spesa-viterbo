"""Refresh saved product labels and derive catalog filters without runtime store requests."""

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
import argparse
import hashlib
import json
import re
import time

from product_sources import product_info


ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "data" / "product-info"
SODA = re.compile(r"\bcola\b|gassat|aranciat|limonat|chinotto|tonica|tonic|sprite|fanta|pepsi|\bsoda\b|cedrata|gazzosa|schweppes", re.I)
YOGURT = re.compile(r"yogurt|yoghurt|skyr", re.I)
MILK = re.compile(r"\blatte\b", re.I)
NOT_MILK = re.compile(r"besciam|burro|\bfetta\b|cioccolat|cacao|biscott|dessert|kinder|\bpanna\b|\bcrema\b|bevanda|kefir|yogurt|formagg|condensat|fermentat|in polvere|aromatizzat", re.I)
NO_SUGAR = re.compile(r"senza zuccheri(?!\s+aggiunti)|senza zucchero|zero zuccheri|zero sugar|sugar.free|no sugar|0 zuccheri", re.I)
NO_LACTOSE = re.compile(r"senza lattosio|lactose.free|delattosat", re.I)


def kind(product):
    name = product["name_it"]
    if product["category"] == "drinks" and SODA.search(name):
        return "soda"
    if product["category"] == "dairy":
        if YOGURT.search(name):
            return "yogurt"
        if MILK.search(name) and not NOT_MILK.search(name):
            return "milk"
    return None


def grams(value):
    match = re.search(r"(?<!\d)(\d+(?:[.,]\d+)?)\s*g\b", str(value), re.I)
    return float(match.group(1).replace(",", ".")) if match else None


def nutrition_values(table):
    if not table or len(table.get("headers", [])) < 2 or not re.search(r"100\s*(?:g|ml)\b", table["headers"][1], re.I):
        return {}
    values = {}
    for row in table["rows"]:
        if len(row) < 2:
            continue
        label = row[0].lower().strip(" -")
        if re.search(r"\bzuccheri\b", label):
            values["sugar_g"] = grams(row[1])
        elif label == "grassi" or label.startswith("grassi ("):
            values["fat_g"] = grams(row[1])
    return values


def shard_name(key):
    return f"{int(key.rsplit('-', 1)[-1]) % 64:02x}.json"


def has_info(info):
    return bool(info.get("ingredients") or info.get("allergens") or (info.get("nutrition") or {}).get("rows"))


def write_json(path, data):
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    if not path.exists() or path.read_text(encoding="utf-8") != text:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(text, encoding="utf-8")
        temporary.replace(path)
    return text


def save_cache(cache, products, previous):
    shards = {}
    for key, entry in cache.items():
        shards.setdefault(shard_name(key), {})[key] = entry
    digest = hashlib.sha256()
    for filename, entries in sorted(shards.items()):
        digest.update(write_json(CACHE / filename, entries).encode("utf-8"))
    keys = {product["key"] for product in products}
    available = sorted(key for key, entry in cache.items() if key in keys and has_info(entry.get("info", {})))
    write_json(ROOT / "product-info-index.json", {"version": digest.hexdigest()[:16], "keys": available})
    attributes = {}
    for product in products:
        group = kind(product)
        key, name = product["key"], product["name_it"]
        old = previous.get(key, {})
        entry = cache.get(key, {})
        values = {name: value for name, value in nutrition_values(entry.get("info", {}).get("nutrition")).items() if value is not None}
        sugar_free = bool(NO_SUGAR.search(name) or group == "soda" and re.search(r"\bzero\b", name, re.I))
        lactose_free = bool(NO_LACTOSE.search(name))
        if not group and not values and not sugar_free and not lactose_free and old.get("sugar_g") is None and old.get("fat_g") is None:
            continue
        attributes[key] = {
            "kind": group,
            "sugar_free": sugar_free,
            "lactose_free": lactose_free,
            "sugar_g": values.get("sugar_g", old.get("sugar_g")),
            "fat_g": values.get("fat_g", old.get("fat_g")),
        }
        checked = entry.get("checked_at") if values else old.get("checked_at")
        if checked:
            attributes[key]["checked_at"] = checked
    write_json(ROOT / "product-attributes.json", attributes)
    return len(available), sum(v.get("sugar_g") is not None or v.get("fat_g") is not None for v in attributes.values())


def build_attributes(limit=750, workers=6, max_seconds=600):
    products = [product for file in ("products.json", "lidl-products.json", "eurospin-products.json")
                for product in json.loads((ROOT / file).read_text(encoding="utf-8"))]
    target = ROOT / "product-attributes.json"
    previous = json.loads(target.read_text(encoding="utf-8")) if target.exists() else {}
    cache = {}
    for path in sorted(CACHE.glob("*.json")):
        cache.update(json.loads(path.read_text(encoding="utf-8")))
    now = datetime.now(timezone.utc)
    pending = []
    for product in products:
        if product["store"] == "Lidl" or product["category"] in {"care", "cleaning", "home", "clothes", "garden", "other"}:
            continue
        key = product["key"]
        next_check = cache.get(key, {}).get("next_check_at")
        if not next_check or datetime.fromisoformat(next_check) <= now:
            pending.append(product)
    pending.sort(key=lambda product: (kind(product) is None,
                                      previous.get(product["key"], {}).get("sugar_g") is None,
                                      product["store"] == "Conad", not product.get("price"), product["key"]))
    deadline = time.monotonic() + max_seconds

    def read(product):
        if time.monotonic() > deadline:
            return None
        return product_info(product["store"], product.get("url", ""), product["key"])

    failures = completed = 0
    print("Queued labels:", min(limit, len(pending)), "saved:", len(cache), flush=True)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(read, product): product["key"] for product in pending[:limit]}
        for future in as_completed(futures):
            key = futures[future]
            try:
                info = future.result()
                if info is None:
                    continue
                cache[key] = {"info": info, "checked_at": now.isoformat(timespec="seconds"),
                              "next_check_at": (now + timedelta(days=30 if has_info(info) else 14)).isoformat(timespec="seconds")}
            except Exception as error:
                failures += 1
                cache.setdefault(key, {})["next_check_at"] = (now + timedelta(days=3)).isoformat(timespec="seconds")
                if failures <= 5:
                    print("Label unavailable:", key, type(error).__name__, flush=True)
            completed += 1
            if completed % 50 == 0:
                available, numeric = save_cache(cache, products, previous)
                print("Checked:", completed, "available:", available, "numeric:", numeric, "failed:", failures, flush=True)
    available, numeric = save_cache(cache, products, previous)
    print("Saved labels:", available, "nutrition filters:", numeric, "failed:", failures, flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=750)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--max-seconds", type=int, default=600)
    options = parser.parse_args()
    build_attributes(options.limit, options.workers, options.max_seconds)
