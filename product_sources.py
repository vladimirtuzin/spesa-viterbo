"""Product labels from the stores' public product pages and catalog API."""

from urllib.parse import urlparse
import json
import re

import requests
from bs4 import BeautifulSoup


HOSTS = {
    "Coop": "coopacasa.coopetruria.coop.it",
    "Conad": "spesaonline.conad.it",
}


def label_text(element):
    if element is None:
        return ""
    copy = BeautifulSoup(str(element), "html.parser")
    for line_break in copy.select("br"):
        line_break.replace_with("\n")
    return "\n".join(" ".join(line.split()) for line in copy.get_text().splitlines() if line.strip())


def nutrition_table(table):
    if table is None:
        return None
    rows = []
    for tr in table.select("tr"):
        cells = [cell.get_text(" ", strip=True) for cell in tr.find_all(["th", "td"], recursive=False)]
        if len(cells) > 1 and any(cells[1:]):
            rows.append(cells)
    if len(rows) < 2:
        return None
    width = max(map(len, rows))
    return {"headers": rows[0] + [""] * (width - len(rows[0])),
            "rows": [row + [""] * (width - len(row)) for row in rows[1:]]}


def labeled_sibling(container, title):
    for label in container.select(".cc-pdp__info__card__stitle, p.no-margin-bottom"):
        if label.get_text(" ", strip=True).lower() == title.lower():
            return label.find_next_sibling()
    return None


def parse_coop(html):
    soup = BeautifulSoup(html, "html.parser")
    ingredients = labeled_sibling(soup, "Ingredienti")
    allergens = labeled_sibling(soup, "Allergeni")
    photo = soup.select_one("img[itemprop=image]")
    image = photo.get("src", "") if photo else ""
    if urlparse(image).hostname == "s7g10.scene7.com":
        image += "?$pdp_large_normal_598$"
    else:
        image = ""
    return {"ingredients": label_text(ingredients), "allergens": label_text(allergens),
            "nutrition": nutrition_table(soup.select_one("#cc-pdp__nutritional__collapse table")),
            "image": image}


def parse_conad(html):
    soup = BeautifulSoup(html, "html.parser")
    section = next((title.parent for title in soup.select(".uk-accordion-title")
                    if "ingredienti e valori nutrizionali" in title.get_text(" ", strip=True).lower()), None)
    if section is None:
        return {"ingredients": "", "allergens": "", "nutrition": None, "image": ""}
    ingredients = labeled_sibling(section, "Ingredienti")
    allergens = labeled_sibling(section, "Allergeni")
    return {"ingredients": label_text(ingredients), "allergens": label_text(allergens),
            "nutrition": nutrition_table(section.select_one("table")), "image": ""}


def parse_eurospin(data):
    description = data.get("metaData", {}).get("product_description", {})
    ingredients = label_text(BeautifulSoup(description.get("INGREDIENTS_HTML", ""), "html.parser"))
    try:
        nutrition = json.loads(description.get("NUTRITION", "{}"))
        columns = nutrition.get("columns", [])
        names = nutrition.get("rows", [])
        values = nutrition.get("cells", [])
        table = {"headers": ["", *columns],
                 "rows": [[name, *values[index * len(columns):(index + 1) * len(columns)]]
                          for index, name in enumerate(names)]} if columns and names else None
    except (ValueError, TypeError):
        table = None
    return {"ingredients": ingredients, "allergens": "", "nutrition": table, "image": ""}


def product_info(store, url, key):
    if store == "Eurospin":
        match = re.fullmatch(r"eurospin-(\d{1,12})", key)
        if not match:
            raise ValueError("Invalid product key")
        response = requests.get(f"https://online.eurospin.com/ebsn/api/products/{match.group(1)}", timeout=15)
        response.raise_for_status()
        return parse_eurospin(response.json()["data"])
    if store not in HOSTS:
        raise ValueError("Unsupported store")
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != HOSTS[store] or parsed.username or parsed.password:
        raise ValueError("Invalid product URL")
    if store == "Coop" and not re.search(r"/\d+\.html$", parsed.path):
        raise ValueError("Invalid Coop product URL")
    if store == "Conad" and not parsed.path.startswith("/p/"):
        raise ValueError("Invalid Conad product URL")
    response = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
    response.raise_for_status()
    return (parse_coop if store == "Coop" else parse_conad)(response.text)
