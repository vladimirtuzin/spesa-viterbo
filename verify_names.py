"""Offline checks for name cleanup, saved translations and interrupted refreshes."""

from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import json

import refresh_translations as names


fresh = {"key": "coop-1", "store": "Coop", "category": "vegetables",
         "name_it": "Aglio secco it i^ rt g 200", "name_ru": "Чеснок сушеный эт i^rt г 200"}
assert names.clean_name(fresh)
assert fresh["name_it"] == "Aglio secco g 200" and "Чеснок" in fresh["name_ru"]
pineapple = {"key": "coop-1258361", "store": "Coop", "category": "fruit",
             "name_it": "Ananas gold es 6-7 i^ f.lli orsero sf", "name_ru": "Ананасовое золото ES 6-7"}
names.clean_name(pineapple)
assert pineapple["name_it"] == "Ananas gold Orsero" and pineapple["name_ru"] == "Ананас Gold Orsero"
quantity_only = {"key": "lidl-everli-536721", "store": "Lidl", "category": "drinks", "name_it": "1,75 l"}
names.clean_name(quantity_only)
assert quantity_only["name_it"] == "Pepsi 1,75 l" and "Pepsi" in quantity_only["name_ru"]
navelina = {"key": "coop-593206", "store": "Coop", "category": "fruit", "name_it": "Arance navelina kg 3"}
assert names.curated_name(navelina) == "Апельсины «Навелина»"
assert names.clean_russian_name(navelina, "Навелина апельсины ит 9 и^ втбг кг 3") == "Навелина апельсины 3 кг"
assert names.clean_russian_name(navelina, "Миндаль es150г") == "Миндаль 150г"
shade = {"store": "Coop", "category": "care"}
assert names.clean_russian_name(shade, "Garnier Olia IT 10 Night Black") == "Garnier Olia IT 10 Night Black"

with TemporaryDirectory() as temporary:
    root = Path(temporary)
    fixtures = {
        "products.json": [{"key": "conad-1", "store": "Conad", "category": "dairy", "name_it": "Latte", "name_ru": "Молоко"}],
        "lidl-products.json": [{"key": "lidl-everli-1", "store": "Lidl", "category": "fruit", "name_it": "Ananas"}],
        "eurospin-products.json": [{"key": "eurospin-1", "store": "Eurospin", "category": "fruit", "name_it": "Ananas"}],
    }
    for filename, value in fixtures.items():
        (root / filename).write_text(json.dumps(value), encoding="utf-8")
    with patch.object(names, "ROOT", root):
        with patch.object(names, "local_translator", return_value=lambda batch: ["Ананас" for _ in batch]) as engine:
            names.refresh_names()
            assert engine.call_count == 1
        assert all(product["name_ru"] for filename in fixtures for product in json.loads((root / filename).read_text(encoding="utf-8")))
        with patch.object(names, "local_translator", side_effect=AssertionError("Saved names must not be translated again")):
            names.refresh_names()

        cached = json.loads((root / "translations-ru.json").read_text(encoding="utf-8"))
        cached[navelina["name_it"]] = "Навелина апельсины ит 9 и^ втбг кг 3"
        (root / "translations-ru.json").write_text(json.dumps(cached), encoding="utf-8")
        coop_file = root / "products.json"
        coop_file.write_text(json.dumps([navelina]), encoding="utf-8")
        with patch.object(names, "local_translator", side_effect=AssertionError("Existing translations must be cleaned locally")):
            names.refresh_names()
        assert json.loads(coop_file.read_text(encoding="utf-8"))[0]["name_ru"] == "Апельсины «Навелина»"

        missing = fixtures["lidl-products.json"][0] | {"name_it": "Nuovo prodotto"}
        target = root / "lidl-products.json"
        target.write_text(json.dumps([missing]), encoding="utf-8")
        before = target.read_bytes()
        with patch.object(names, "local_translator", side_effect=RuntimeError("Model unavailable")):
            try:
                names.refresh_names()
            except RuntimeError:
                pass
            else:
                raise AssertionError("Refresh should fail before publishing incomplete names")
        assert target.read_bytes() == before

print("Russian names, cache reuse and interrupted refresh OK")
