"""Build category-specific product characteristics from public labels and nutrition tables."""

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
import argparse
import json
import re

from api.info import product_info


ROOT = Path(__file__).resolve().parent
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


def build_attributes(limit=100):
    products = [product for file in ("products.json", "lidl-products.json", "eurospin-products.json")
                for product in json.loads((ROOT / file).read_text(encoding="utf-8"))]
    target = ROOT / "product-attributes.json"
    previous = json.loads(target.read_text(encoding="utf-8")) if target.exists() else {}
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=30)
    attributes = {}
    pending = []
    for product in products:
        group = kind(product)
        if not group:
            continue
        key = product["key"]
        old = previous.get(key, {})
        name = product["name_it"]
        attributes[key] = {
            "kind": group,
            "sugar_free": bool(NO_SUGAR.search(name) or group == "soda" and re.search(r"\bzero\b", name, re.I)),
            "lactose_free": bool(NO_LACTOSE.search(name)),
            "sugar_g": old.get("sugar_g"),
            "fat_g": old.get("fat_g"),
        }
        checked = old.get("checked_at", "")
        if checked:
            attributes[key]["checked_at"] = checked
        if product["store"] != "Lidl" and (not checked or datetime.fromisoformat(checked) < cutoff):
            pending.append(product)

    def read(product):
        info = product_info(product["store"], product.get("url", ""), product["key"])
        return product["key"], nutrition_values(info["nutrition"])

    failures = 0
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(read, product): product["key"] for product in pending[:limit]}
        for index, future in enumerate(as_completed(futures), 1):
            try:
                key, values = future.result()
                attributes[key].update(values)
            except Exception as error:
                key = futures[future]
                failures += 1
                if failures <= 10:
                    print("Nutrition unavailable:", error, flush=True)
            attributes[key]["checked_at"] = now.isoformat(timespec="seconds")
            if index % 50 == 0:
                print("Nutrition checked:", index, "/", len(futures), flush=True)

    target.write_text(json.dumps(attributes, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("Attributes:", len(attributes), "nutrition:", sum(v.get("sugar_g") is not None or v.get("fat_g") is not None for v in attributes.values()), "failed:", failures, flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=100)
    build_attributes(parser.parse_args().limit)
