"""Browser check for catalog pricing, compact cart controls and responsive navigation.

Requires local_preview.py, Chrome and Playwright.
"""

from pathlib import Path
from urllib.parse import urlencode
import json
import os

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
BASE = "http://127.0.0.1:5173/"
products = [p for file in ("products.json", "lidl-products.json", "eurospin-products.json")
            for p in json.loads((ROOT / file).read_text(encoding="utf-8"))]
member = next(p for p in products if p.get("member_price") and not p.get("future") and not p.get("expired"))
unknown = next(p for p in products if not p.get("price"))


def navigate(page, **query):
    page.goto(BASE + ("?" + urlencode(query) if query else ""), wait_until="domcontentloaded")
    page.wait_for_selector(".product-card")
    page.evaluate("document.fonts.ready")


def no_overflow(page):
    assert not page.evaluate("document.documentElement.scrollWidth > innerWidth"), page.viewport_size
    assert not page.locator(".product-card").evaluate_all("es => es.some(e => {const p=e.querySelector('.price').getBoundingClientRect(), b=e.querySelector('.cart-card-control').getBoundingClientRect();return p.right>b.left-2})")


with sync_playwright() as p:
    chrome = Path(os.environ.get("PROGRAMFILES", "C:/Program Files")) / "Google/Chrome/Application/chrome.exe"
    browser = p.chromium.launch(**({"executable_path": str(chrome)} if chrome.exists() else {}))
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    navigate(page)
    assert page.evaluate("state.filtered.length") == len(products)
    assert page.locator("[data-info]").count() == page.locator(".product-card").count()
    assert page.locator(".product-card s,.product-card del").count() == 0
    assert page.evaluate("lineTotal({price:0.1},3) === 0.3")
    assert page.evaluate("memberPrice({price:4,member_price:2,expired:true}) === null")
    assert page.evaluate("memberPrice({price:4,member_price:2,future:true}) === null")
    assert page.evaluate("memberPrice({price:4,member_price:5}) === null")
    first = page.locator(".product-card").first
    before = first.bounding_box()
    first.locator("[data-add-cart]").click()
    assert first.bounding_box() == before
    assert first.locator(".in-cart").is_visible()
    first.locator(".in-cart").click()
    assert page.locator(".page-shell").evaluate("e=>e.inert")
    page.locator("#cartItems [data-cart-change][data-delta='1']").click()
    assert page.locator("#cartCount").inner_text() == "2"
    page.keyboard.press("Escape")
    assert not page.locator(".page-shell").evaluate("e=>e.inert")
    assert first.locator(".in-cart").evaluate("e=>e===document.activeElement")

    page.evaluate("state.cart.clear();localStorage.removeItem('shopping-by-tuzin-cart-v1');updateCartCount()")
    navigate(page, store=member["store"], q=member["name_it"])
    card = page.locator(f'.product-card[data-key="{member["key"]}"]')
    assert card.locator(".price").inner_text() == page.evaluate("euro", member["price"])
    assert card.locator(".member-offer strong").inner_text() == page.evaluate("euro", member["member_price"])
    card.locator("[data-add-cart]").click()
    card.locator(".in-cart").click()
    page.locator("#cartItems [data-delta='1']").click()
    assert page.locator("#cartTotal").inner_text() == page.evaluate("euro", round(member["price"] * 2, 2))
    assert page.locator("#cartPriceNote").is_visible()
    page.keyboard.press("Escape")
    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector(".product-card")
    assert page.locator("#cartCount").inner_text() == "2"

    navigate(page, q=unknown["name_it"], store=unknown["store"])
    missing = page.locator(f'.product-card[data-key="{unknown["key"]}"]')
    assert missing.locator(".add-cart").is_disabled()
    assert page.evaluate("key => setCartQuantity(key, 1)", unknown["key"]) is False
    assert missing.locator("[data-info]").is_visible()
    navigate(page)
    page.locator("[data-store=Conad]").click()
    assert page.evaluate("state.filtered.length") == sum(p["store"] == "Conad" for p in products)
    page.locator("[data-store=Conad]").click()
    assert page.evaluate("state.store") == "all"
    page.locator("[data-view=offers]").click()
    assert page.evaluate("state.filtered.length > 0 && state.filtered.every(isDeal)")
    page.locator("[data-view=pp]").click()
    assert page.evaluate("state.filtered.length > 0 && state.filtered.every(p=>p._ppRank!=null)")
    page.locator("[data-view=all]").click()
    page.evaluate("window.originalCard=document.querySelector('.product-card')")
    page.locator("#loadMore").click()
    assert page.locator(".product-card").count() == 80
    assert page.evaluate("window.originalCard === document.querySelector('.product-card')")
    page.locator("[data-category=dairy]").click()
    assert page.locator("#children-dairy").is_visible()
    assert page.locator(".catalog-main").bounding_box()["y"] >= 90
    page.locator("[data-subcategory=dairy-milk]").click()
    page.locator("#characterFilters summary").click()
    page.locator("#lactoseFree").check()
    assert page.evaluate("state.filtered.length>0 && state.filtered.every(p=>p._attributes.lactose_free)")
    page.locator("[data-clear-filter=lactoseFree]").click()
    assert not page.evaluate("state.lactoseFree")
    page.locator("#searchInput").fill("navelina")
    page.wait_for_function("state.query === 'navelina'")
    page.locator("#clearSearch").click()
    assert page.evaluate("state.query") == ""
    for width in (320, 360, 390, 640, 768, 900, 1024, 1440, 1920):
        page.set_viewport_size({"width": width, "height": 900})
        no_overflow(page)

    mobile = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    mp = mobile.new_page()
    mp.on("pageerror", lambda e: errors.append(str(e)))
    navigate(mp)
    mp.locator("#openFilters").click()
    assert mp.locator(".catalog-main").evaluate("e=>e.inert")
    mp.locator("[data-category=dairy]").click()
    mp.locator("[data-subcategory=dairy-milk]").click()
    assert mp.locator("#categoryRail").evaluate("e=>e.inert")
    assert not mp.locator(".catalog-main").evaluate("e=>e.inert")
    assert mp.evaluate("state.filtered.every(p=>p.subcategory==='dairy-milk')")
    mp.locator("#openFilters").click()
    mp.locator("[data-category=drinks]").click()
    mp.locator("#applyFilters").click()
    assert mp.evaluate("state.category==='drinks'")
    mp.locator(".cart-trigger").click()
    assert mp.locator(".cart-empty").is_visible()
    mp.locator("[data-close-cart]").click()
    assert mp.locator("#cartDrawer").is_hidden()
    no_overflow(mp)
    photo=mp.locator('.product-media img').first
    image_key=photo.locator('xpath=ancestor::article').get_attribute('data-key')
    image_card=mp.locator(f'.product-card[data-key="{image_key}"]')
    image_bounds=image_card.bounding_box()
    photo.evaluate("e=>e.src='/image-fallback-check-does-not-exist.png'")
    image_card.locator('.placeholder-art').wait_for()
    assert image_card.bounding_box()==image_bounds
    assert not errors, errors
    browser.close()

print("Catalog UI: price hierarchy, compact cart, membership totals, persistence, filters, append and mobile navigation OK")
