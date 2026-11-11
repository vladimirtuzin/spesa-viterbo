"""Offline check: cached labels survive source failures and power the nutrition index."""

from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import json

import refresh_attributes as refresh


with TemporaryDirectory() as temporary:
    root = Path(temporary)
    products = [{"key": f"coop-{number}", "store": "Coop", "category": "dairy", "price": 1,
                 "name_it": name, "url": "https://coopacasa.coopetruria.coop.it/1.html"}
                for number, name in ((1, "Yogurt bianco"), (2, "Latte senza lattosio"))]
    for filename, data in (("products.json", products), ("lidl-products.json", []), ("eurospin-products.json", [])):
        (root / filename).write_text(json.dumps(data), encoding="utf-8")
    label = {"ingredients": "Latte", "allergens": "Latte", "image": "",
             "nutrition": {"headers": ["", "100 g"], "rows": [["Grassi", "3 g"], ["Zuccheri", "4 g"]]}}

    def source(store, url, key):
        if key == "coop-2":
            raise ConnectionError("Source unavailable")
        return label

    with patch.object(refresh, "ROOT", root), patch.object(refresh, "CACHE", root / "data" / "product-info"):
        with patch.object(refresh, "product_info", side_effect=source):
            refresh.build_attributes(limit=2, workers=1)
        index = json.loads((root / "product-info-index.json").read_text(encoding="utf-8"))
        assert index["keys"] == ["coop-1"]
        attributes = json.loads((root / "product-attributes.json").read_text(encoding="utf-8"))
        assert attributes["coop-1"]["sugar_g"] == 4 and attributes["coop-1"]["fat_g"] == 3
        assert attributes["coop-2"]["lactose_free"]

        shard = root / "data" / "product-info" / refresh.shard_name("coop-1")
        entries = json.loads(shard.read_text(encoding="utf-8"))
        entries["coop-1"]["next_check_at"] = "2000-01-01T00:00:00+00:00"
        shard.write_text(json.dumps(entries), encoding="utf-8")
        with patch.object(refresh, "product_info", side_effect=ConnectionError("Source unavailable")):
            refresh.build_attributes(limit=2, workers=1)
        after = json.loads(shard.read_text(encoding="utf-8"))
        assert after["coop-1"]["info"] == label
        assert json.loads((root / "product-info-index.json").read_text(encoding="utf-8"))["keys"] == ["coop-1"]

print("Saved labels and failure recovery OK")
