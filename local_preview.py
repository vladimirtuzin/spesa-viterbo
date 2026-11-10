"""Static catalog and its product-info endpoint for local preview."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from api.info import serve_info


class PreviewHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if urlparse(self.path).path == "/api/info":
            serve_info(self)
        else:
            super().do_GET()


if __name__ == "__main__":
    print("Spesa Viterbo: http://127.0.0.1:5173/", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 5173), PreviewHandler).serve_forever()
