"""Serve the catalog and saved product labels locally."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
from pathlib import Path


if __name__ == "__main__":
    print("SHOPPING BY TUZIN: http://127.0.0.1:5173/", flush=True)
    handler = partial(SimpleHTTPRequestHandler, directory=str(Path(__file__).resolve().parent))
    ThreadingHTTPServer(("127.0.0.1", 5173), handler).serve_forever()
