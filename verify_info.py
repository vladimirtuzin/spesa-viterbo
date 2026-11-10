"""Smoke-check the three public product information sources."""

from api.info import product_info


CASES = [
    ("Coop", "https://coopacasa.coopetruria.coop.it/yogurt-e-dessert/dessert/1394751.html", "coop-1394751"),
    ("Conad", "https://spesaonline.conad.it/p/conad-vellutata-zucca-e-carote-350-g--50076931", "conad-50076931"),
    ("Eurospin", "", "eurospin-1041687"),
]


for store, url, key in CASES:
    info = product_info(store, url, key)
    assert info["ingredients"] and info["nutrition"] and info["nutrition"]["rows"], store
    print(store, "OK")
