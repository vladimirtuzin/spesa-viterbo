"""Load missing product labels on demand and cache successful source responses."""

from functools import lru_cache
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from tempfile import gettempdir
from threading import Lock
from urllib.parse import parse_qs, urlparse
import json
import os
import re
import time

import requests

from product_sources import product_info


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_CACHE = (Path(gettempdir()) / "shopping-by-tuzin-info") if os.getenv("VERCEL") else ROOT / ".runtime-info"
LOCKS = {}


@lru_cache(maxsize=1)
def catalog():
    return {p["key"]: {"store": p["store"], "url": p.get("url", "")}
            for filename in ("products.json", "lidl-products.json", "eurospin-products.json")
            for p in json.loads((ROOT / filename).read_text(encoding="utf-8"))}


def has_label(info):
    return bool(info.get("ingredients") or info.get("allergens") or (info.get("nutrition") or {}).get("rows"))


def read_json(path):
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def get_info(key):
    if not re.fullmatch(r"(?:coop|conad|eurospin|lidl-everli)-\d{1,12}", key):
        raise ValueError("Invalid product key")
    product = catalog().get(key)
    if not product:
        raise KeyError("Unknown product")
    if product["store"] == "Lidl":
        return {"ingredients": "", "allergens": "", "nutrition": None, "status": "unsupported"}

    with LOCKS.setdefault(key, Lock()):
        shard = f"{int(key.rsplit('-', 1)[-1]) % 64:02x}.json"
        saved = read_json(ROOT / "data" / "product-info" / shard).get(key, {}).get("info")
        if isinstance(saved, dict) and has_label(saved):
            return dict(saved, status="ready")

        path = RUNTIME_CACHE / f"{key}.json"
        entry = read_json(path)
        info = entry.get("info")
        if isinstance(info, dict) and entry.get("expires_at", 0) > time.time():
            return dict(info, status="ready" if has_label(info) else "not_provided")

        try:
            info = product_info(product["store"], product["url"], key)
        except (KeyError, ValueError, TypeError) as error:
            raise requests.RequestException("Invalid source response") from error
        ttl = 30 * 86400 if has_label(info) else 3600
        try:
            RUNTIME_CACHE.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(".tmp")
            temporary.write_text(json.dumps({"info": info, "expires_at": time.time() + ttl}, ensure_ascii=False), encoding="utf-8")
            temporary.replace(path)
        except OSError:
            pass  # The response can still use the hosting CDN's cache if disk is unavailable.
        return dict(info, status="ready" if has_label(info) else "not_provided")


def serve_info(request):
    key = parse_qs(urlparse(request.path).query).get("key", [""])[0]
    try:
        info, status = get_info(key), 200
    except KeyError:
        info, status = {"error": "Unknown product"}, 404
    except ValueError:
        info, status = {"error": "Invalid product or source response"}, 400
    except (requests.RequestException, OSError, TypeError):
        info, status = {"error": "Product information temporarily unavailable"}, 502
    body = json.dumps(info, ensure_ascii=False).encode("utf-8")
    request.send_response(status)
    request.send_header("Content-Type", "application/json; charset=utf-8")
    request.send_header("Content-Length", str(len(body)))
    ttl = 86400 if info.get("status") == "ready" else 3600
    request.send_header("Cache-Control", f"public, max-age=120, s-maxage={ttl}, stale-while-revalidate=86400" if status == 200 else "no-store")
    request.end_headers()
    request.wfile.write(body)


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        serve_info(self)
