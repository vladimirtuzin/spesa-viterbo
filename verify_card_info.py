"""Browser check: click-only product labels, real nutrition columns and in-card scrolling.

Run with the local preview on port 5173 and Playwright installed.
"""

from pathlib import Path
from urllib.parse import urlencode
import json
import os

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parent
BASE = "http://127.0.0.1:5173/"
products = {p["key"]: p for filename in ("products.json", "lidl-products.json", "eurospin-products.json")
            for p in json.loads((ROOT / filename).read_text(encoding="utf-8"))}
entries = {key: entry for file in (ROOT / "data/product-info").glob("*.json")
           for key, entry in json.loads(file.read_text(encoding="utf-8")).items()}
key, entry = next((key, entry) for key, entry in entries.items()
                  if key in products and entry.get("info", {}).get("ingredients")
                  and len((entry["info"].get("nutrition") or {}).get("headers", [])) >= 3)
product, info = products[key], entry["info"]
url = BASE + "?" + urlencode({"store": product["store"], "q": product["name_it"]})


def opened_card(page):
    page.goto(url, wait_until="domcontentloaded")
    card = page.locator(f'.product-card[data-key="{key}"]')
    card.wait_for()
    return card


def ready(page):
    page.wait_for_function("key => document.querySelector(`[data-key=\"${key}\"]`).dataset.specsLoaded === 'ready'", arg=key)


with sync_playwright() as p:
    chrome = Path(os.environ.get("PROGRAMFILES", "C:/Program Files")) / "Google/Chrome/Application/chrome.exe"
    browser = p.chromium.launch(**({"executable_path": str(chrome)} if chrome.exists() else {}))
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    card = opened_card(page)
    card.hover()
    page.wait_for_timeout(600)
    assert card.locator(".card-details").is_hidden()
    assert card.get_attribute("data-specs-loaded") is None
    before = card.bounding_box()
    card.locator("[data-info]").click()
    ready(page)
    content = card.locator(".spec-scroll")
    assert content.locator("h4").all_text_contents() == ["Состав", "Пищевая ценность"]
    assert content.locator("thead th").count() == len(info["nutrition"]["headers"])
    assert content.locator("tbody tr").count() == sum(any(str(v or "").strip() for v in row[1:]) for row in info["nutrition"]["rows"])
    assert "пока не опубликованы" not in content.inner_text()
    assert not content.locator("dl,.original-name").count()
    assert card.bounding_box() == before
    position = page.evaluate("scrollY")
    content.evaluate("e => e.scrollTop = e.scrollHeight")
    assert content.evaluate("e => e.scrollTop > 0") and page.evaluate("scrollY") == position
    page.locator("#searchInput").hover()
    assert card.locator(".card-details").is_visible()
    card.locator("[data-info]").click()
    card.hover()
    page.wait_for_timeout(400)
    assert card.locator(".card-details").is_hidden()
    card.locator("[data-info]").focus()
    page.keyboard.press("Enter")
    assert card.locator(".card-details").is_visible()
    page.keyboard.press("Escape")
    assert card.locator(".card-details").is_hidden()

    shard = f"{int(key.rsplit('-', 1)[-1]) % 64:02x}"
    page.route(f"**/data/product-info/{shard}.json?*", lambda route: route.fulfill(status=503), times=1)
    card = opened_card(page)
    card.locator("[data-info]").click()
    ready(page)

    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_selector(".product-card")
    assert page.locator("[data-info]").count() == page.locator(".product-card").count()
    missing = page.evaluate("state.products.find(p => p.store === 'Coop' && !p._hasInfo)")
    requests_seen = []
    page.on("request", lambda request: requests_seen.append(request.url) if "/api/info?" in request.url else None)
    missing_url = BASE + "?" + urlencode({"store": "Coop", "q": missing["name_it"]})
    page.goto(missing_url, wait_until="domcontentloaded")
    missing_card = page.locator(f'.product-card[data-key="{missing["key"]}"]')
    missing_card.hover()
    page.wait_for_timeout(500)
    assert not requests_seen
    endpoint = f'**/api/info?key={missing["key"]}'
    payload = {"ingredients": "Test ingredient", "nutrition": {"headers": ["", "100 g"], "rows": [["Energia", "100 kJ"]]}}
    page.route(endpoint, lambda route: route.fulfill(content_type="application/json", body=json.dumps(payload)))
    page.route(endpoint, lambda route: route.fulfill(status=503), times=1)
    missing_card.locator("[data-info]").click()
    missing_card.locator("[data-retry-info]").click()
    page.wait_for_function("key => document.querySelector(`[data-key=\"${key}\"]`).dataset.specsLoaded === 'ready'", arg=missing["key"])
    assert missing_card.locator(".nutrition-table").count() == 1 and len(requests_seen) == 2
    missing_card.locator("[data-info]").click()
    missing_card.locator("[data-info]").click()
    assert len(requests_seen) == 2
    for width in (320, 390, 900, 1440):
        page.set_viewport_size({"width": width, "height": 900})
        assert not page.evaluate("document.documentElement.scrollWidth > innerWidth")

    touch = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    mobile = touch.new_page()
    card = opened_card(mobile)
    card.locator("[data-info]").click()
    ready(mobile)
    outer, panel = card.bounding_box(), card.locator(".card-details").bounding_box()
    assert outer["x"] <= panel["x"] and outer["y"] <= panel["y"]
    assert panel["x"] + panel["width"] <= outer["x"] + outer["width"]
    assert panel["y"] + panel["height"] <= outer["y"] + outer["height"]
    assert mobile.locator(".nutrition-table").evaluate("e => e.scrollWidth <= e.clientWidth")
    card.locator("[data-info]").click()
    assert card.locator(".card-details").is_hidden()
    assert not errors, errors
    browser.close()

print("Click-only info, composition, full nutrition table, internal scroll, retry and touch OK")
