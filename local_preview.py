"""Serve the catalog, saved labels and on-demand product information locally."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
from pathlib import Path
from urllib.parse import urlparse

from api.info import serve_info


class PreviewHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if urlparse(self.path).path == "/api/info":
            serve_info(self)
        else:
            super().do_GET()


if __name__ == "__main__":
    print("SHOPPING BY TUZIN: http://127.0.0.1:5173/", flush=True)
    handler = partial(PreviewHandler, directory=str(Path(__file__).resolve().parent))
    ThreadingHTTPServer(("127.0.0.1", 5173), handler).serve_forever()
