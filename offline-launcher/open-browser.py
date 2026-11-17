from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import webbrowser


ROOT = (Path(__file__).resolve().parent.parent / "web-dist").resolve()
PORT = 4173


class F4Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript; charset=utf-8",
        ".wasm": "application/wasm",
        ".webmanifest": "application/manifest+json",
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
    }

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()


if not (ROOT / "index.html").is_file():
    raise SystemExit(f"Missing web-dist/index.html at {ROOT}")

server = ThreadingHTTPServer(("127.0.0.1", PORT), lambda *args, **kwargs: F4Handler(*args, directory=str(ROOT), **kwargs))
url = f"http://127.0.0.1:{PORT}/"
print(f"F4 Studio browser mode is running at {url}")
print("Press Ctrl+C to stop the local server.")
webbrowser.open(url)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
