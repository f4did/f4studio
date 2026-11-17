from pathlib import Path
from urllib.parse import quote

from PIL import Image
from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
SVG = (ROOT / "public" / "icons" / "f4-mark.svg").read_text(encoding="utf-8")
ICON_DIR = ROOT / "public" / "icons"
FAVICON = ROOT / "public" / "favicon.ico"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"


def render_icon(page, size, path, maskable=False):
    page.set_viewport_size({"width": size, "height": size})
    inset = 0 if maskable else max(14, size // 16)
    html = f"""
    <!doctype html><style>
      html,body {{ margin:0; width:{size}px; height:{size}px; overflow:hidden; background:#0b0b0b; }}
      .tile {{ box-sizing:border-box; width:{size}px; height:{size}px; display:grid; place-items:center; background:#0b0b0b; border-radius:{0 if maskable else size // 5}px; }}
      .mark {{ width:{size - inset * 2}px; height:{size - inset * 2}px; display:grid; place-items:center; }}
      .mark svg {{ width:100%; height:100%; display:block; }}
    </style><div class="tile"><div class="mark">{SVG}</div></div>
    """
    page.goto("data:text/html," + quote(html), wait_until="load")
    page.screenshot(path=str(path), omit_background=False)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=CHROME, headless=True)
    page = browser.new_page(viewport={"width": 512, "height": 512}, device_scale_factor=1)
    render_icon(page, 192, ICON_DIR / "icon-192.png")
    render_icon(page, 512, ICON_DIR / "icon-512.png")
    render_icon(page, 512, ICON_DIR / "icon-maskable-512.png", maskable=True)
    browser.close()

icon_512 = Image.open(ICON_DIR / "icon-512.png").convert("RGBA")
icon_192 = Image.open(ICON_DIR / "icon-192.png").convert("RGBA")
icon_512.save(ROOT / "desktop" / "icon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)], append_images=[icon_192])
icon_512.save(FAVICON, format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)], append_images=[icon_192])
print("Regenerated icon assets from public/icons/f4-mark.svg")
