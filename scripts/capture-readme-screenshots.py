from pathlib import Path
from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)
BASE = "http://127.0.0.1:5173"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"


def capture(page, url, name, width, height, editor=False):
    page.set_viewport_size({"width": width, "height": height})
    page.goto(url, wait_until="networkidle")
    page.wait_for_timeout(1800)
    if editor:
        button = page.get_by_role("button", name="Open editor")
        if button.count():
            button.click()
            page.wait_for_timeout(900)
    page.screenshot(path=str(OUT / name), full_page=False)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=CHROME, headless=True)
    context = browser.new_context()
    page = context.new_page()

    capture(page, BASE + "/", "home-desktop.png", 1440, 900)
    capture(page, BASE + "/", "home-phone.png", 390, 844)
    capture(page, BASE + "/?audio-studio=1", "audio-desktop.png", 1440, 900)
    capture(page, BASE + "/?audio-studio=1", "audio-phone.png", 390, 844)
    capture(page, BASE + "/", "editor-desktop.png", 1440, 900, editor=True)
    capture(page, BASE + "/", "editor-phone.png", 390, 844, editor=True)

    browser.close()

print(f"Captured screenshots in {OUT}")
