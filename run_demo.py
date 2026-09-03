from playwright.sync_api import sync_playwright
import time, os

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=600)
        page = browser.new_page(viewport={"width": 1280, "height": 800})

        os.makedirs("screenshots", exist_ok=True)

        # Go to signin page
        page.goto("http://localhost:8000/signin.html", wait_until="domcontentloaded")
        time.sleep(1)

        # Fill in credentials
        page.fill("#email", "farhan@mail.com")
        page.fill("#password", "password123")
        page.screenshot(path="screenshots/01_signin.png")

        # Click sign in
        page.click("button[type=submit]")

        # Wait for redirect to dashboard (Firebase auth takes a moment)
        page.wait_for_url("**/dashboard.html", timeout=15000)
        time.sleep(2)

        page.screenshot(path="screenshots/02_dashboard.png")
        print("Logged in as Ketua Kampung — on dashboard.html")
        print("URL:", page.url)

        # Wait a moment then close
        time.sleep(5)
        browser.close()

run()
