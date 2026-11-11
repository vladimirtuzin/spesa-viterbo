"""Offline check: snapshot hits, on-demand caching, safe keys and recoverable errors."""

from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import json

import requests
from api import info as runtime


label = {"ingredients": "Latte", "allergens": "Latte", "nutrition": {"headers": ["", "100 g"], "rows": [["Energia", "100 kJ"]]}}
empty = {"ingredients": "", "allergens": "", "nutrition": None}

with TemporaryDirectory() as temporary:
    root = Path(temporary)
    products = [{"key": f"coop-{i}", "store": "Coop", "url": f"https://coopacasa.coopetruria.coop.it/{i}.html"} for i in range(1, 5)]
    (root / "products.json").write_text(json.dumps(products), encoding="utf-8")
    (root / "lidl-products.json").write_text(json.dumps([{"key": "lidl-everli-1", "store": "Lidl"}]), encoding="utf-8")
    (root / "eurospin-products.json").write_text("[]", encoding="utf-8")
    saved = root / "data/product-info"
    saved.mkdir(parents=True)
    (saved / "01.json").write_text(json.dumps({"coop-1": {"info": label}}), encoding="utf-8")
    with patch.object(runtime, "ROOT", root), patch.object(runtime, "RUNTIME_CACHE", root / "runtime"):
        runtime.catalog.cache_clear()
        with patch.object(runtime, "product_info", side_effect=AssertionError("Snapshot should be reused")):
            assert runtime.get_info("coop-1")["ingredients"] == "Latte"
            assert runtime.get_info("lidl-everli-1")["status"] == "unsupported"

        with patch.object(runtime, "product_info", return_value=label) as source:
            assert runtime.get_info("coop-2")["status"] == "ready"
            source.assert_called_once_with("Coop", products[1]["url"], "coop-2")
        with patch.object(runtime, "product_info", side_effect=AssertionError("Saved live response should be reused")):
            assert runtime.get_info("coop-2")["ingredients"] == "Latte"
        assert (root / "runtime/coop-2.json").is_file()

        with patch.object(runtime, "product_info", side_effect=requests.ConnectionError("Unavailable")):
            try:
                runtime.get_info("coop-3")
            except requests.RequestException:
                pass
            else:
                raise AssertionError("Source failures must not become an empty composition")
        assert not (root / "runtime/coop-3.json").exists()
        with patch.object(runtime, "product_info", return_value=label):
            assert runtime.get_info("coop-3")["status"] == "ready"
        with patch.object(runtime, "product_info", return_value=empty) as source:
            assert runtime.get_info("coop-4")["status"] == "not_provided"
            assert runtime.get_info("coop-4")["status"] == "not_provided"
            assert source.call_count == 1

        for key, exception in (("../../secret", ValueError), ("coop-2/../../secret", ValueError), ("coop-999", KeyError)):
            with patch.object(runtime, "product_info", side_effect=AssertionError("Invalid keys must never reach a source")):
                try:
                    runtime.get_info(key)
                except exception:
                    pass
                else:
                    raise AssertionError("Invalid product key was accepted")
        runtime.catalog.cache_clear()

print("Runtime product info: snapshot, persisted cache, safe keys and retry after source failure OK")
