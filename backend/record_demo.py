import os
import time
from pathlib import Path

from dotenv import load_dotenv
from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError, sync_playwright

SCRIPT_DIR = Path(__file__).resolve().parent
load_dotenv(SCRIPT_DIR / ".env")

APP_URL = os.getenv("DEMO_APP_URL", "https://verdant-agent.vercel.app").rstrip("/")
DEMO_EMAIL = os.getenv("MASTER_USER_EMAIL", "").strip()
DEMO_PASSWORD = os.getenv("MASTER_USER_PASSWORD", "")
OUT_DIR = SCRIPT_DIR / "demo_recordings"
try:
    import ctypes

    SCREEN_SIZE = {
        "width": ctypes.windll.user32.GetSystemMetrics(0),
        "height": ctypes.windll.user32.GetSystemMetrics(1),
    }
except (AttributeError, OSError):
    SCREEN_SIZE = {"width": 1920, "height": 1080}

SCENE_LOADERS = {
    "/agent": "Loading your saved preferences...",
    "/vault": "Loading your saved Vault...",
    "/queue": "Loading your review queue...",
    "/history": "Loading your application history...",
}
OUT_DIR.mkdir(exist_ok=True)


def inject_cursor_and_smooth_ui(page: Page) -> None:
    """Add a visible cursor highlight to make the interactions readable in the video."""
    page.evaluate(
        """
        () => {
            if (document.getElementById('verdant-demo-cursor')) return;
            const style = document.createElement('style');
            style.textContent = `
                html { scroll-behavior: smooth; }
                #verdant-demo-cursor {
                    position: fixed;
                    width: 22px;
                    height: 22px;
                    border-radius: 50%;
                    background: rgba(116, 198, 157, 0.45);
                    border: 2px solid #74C69D;
                    box-shadow: 0 0 16px rgba(116, 198, 157, 0.85);
                    pointer-events: none;
                    z-index: 999999;
                    transform: translate(-50%, -50%);
                    transition: width 0.15s ease, height 0.15s ease, background 0.15s ease;
                }
                #verdant-demo-cursor.clicking {
                    width: 34px;
                    height: 34px;
                    background: rgba(116, 198, 157, 0.85);
                }
            `;
            document.head.appendChild(style);

            const cursor = document.createElement('div');
            cursor.id = 'verdant-demo-cursor';
            document.body.appendChild(cursor);
            window.addEventListener('mousemove', (event) => {
                cursor.style.left = `${event.clientX}px`;
                cursor.style.top = `${event.clientY}px`;
            });
            window.addEventListener('mousedown', () => cursor.classList.add('clicking'));
            window.addEventListener('mouseup', () => cursor.classList.remove('clicking'));
        }
        """
    )


def smooth_scroll(page: Page, distance: int = 550, steps: int = 12, pause: float = 0.06) -> None:
    step_px = distance / steps
    for _ in range(steps):
        page.mouse.wheel(0, step_px)
        time.sleep(pause)


def wait_for_workspace(page: Page, expected_path: str | None = None) -> None:
    """Wait for hydrated, visible page content and stop on authentication/API errors."""
    page.locator("main").wait_for(state="visible", timeout=20_000)
    if expected_path:
        page.wait_for_function(
            "(path) => location.pathname === path || location.pathname.startsWith(path + '/')",
            arg=expected_path,
            timeout=20_000,
        )
    page.locator("main h1").first.wait_for(state="visible", timeout=20_000)
    loading_text = SCENE_LOADERS.get(expected_path or "")
    if loading_text:
        try:
            page.get_by_text(loading_text, exact=True).wait_for(state="hidden", timeout=30_000)
        except PlaywrightTimeoutError as error:
            raise RuntimeError(
                f"The page data did not finish loading at {page.url}; "
                f"it is still showing “{loading_text}”."
            ) from error
    page.wait_for_timeout(800)

    connection_error = page.get_by_role("alert").filter(has_text="Connection problem")
    if connection_error.count():
        raise RuntimeError(f"The workspace reported an API connection problem at {page.url}.")

    main_text = page.locator("main").inner_text().strip()
    if len(main_text) < 20:
        raise RuntimeError(f"The workspace loaded without useful page content at {page.url}.")


def handle_login_if_needed(page: Page) -> None:
    page.wait_for_function(
        "() => document.querySelector('#email') || document.querySelector('.workspace-main h1')",
        timeout=20_000,
    )
    if page.locator("input#email").count() == 0:
        wait_for_workspace(page, "/agent")
        return

    if not DEMO_EMAIL or not DEMO_PASSWORD:
        raise RuntimeError(
            "Set MASTER_USER_EMAIL and MASTER_USER_PASSWORD in backend/.env before recording."
        )

    print("-> Signing in with the configured demo account...")
    page.locator("input#email").fill(DEMO_EMAIL)
    page.locator("input#pw").fill(DEMO_PASSWORD)
    page.locator('form button[type="submit"]').click()

    try:
        wait_for_workspace(page, "/agent")
    except PlaywrightTimeoutError as error:
        feedback = page.locator('[role="alert"], [data-sonner-toast]').all_inner_texts()
        detail = " ".join(text.strip() for text in feedback if text.strip())
        raise RuntimeError(
            f"Sign-in did not open the workspace (current page: {page.url}). "
            f"Visible feedback: {detail or 'none'}"
        ) from error


def open_scene(page: Page, label: str, route: str) -> None:
    if page.url.split("?", maxsplit=1)[0].rstrip("/").endswith(route):
        wait_for_workspace(page, route)
        return

    link = page.get_by_role("link", name=label, exact=True).first
    navigated = False
    if link.count() and link.is_visible():
        try:
            link.click(timeout=5_000)
            page.wait_for_function(
                "(path) => location.pathname === path || location.pathname.startsWith(path + '/')",
                arg=route,
                timeout=8_000,
            )
            navigated = True
        except PlaywrightTimeoutError:
            pass

    if not navigated:
        page.goto(f"{APP_URL}{route}", wait_until="domcontentloaded", timeout=30_000)

    wait_for_workspace(page, route)
    inject_cursor_and_smooth_ui(page)


def record_verdant_demo() -> None:
    if not DEMO_EMAIL or not DEMO_PASSWORD:
        raise RuntimeError(
            "Set MASTER_USER_EMAIL and MASTER_USER_PASSWORD in backend/.env before recording."
        )

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=False, args=["--start-maximized"])
        context = browser.new_context(
            no_viewport=True,
            record_video_dir=str(OUT_DIR),
            record_video_size=SCREEN_SIZE,
        )
        page = context.new_page()
        page.set_default_timeout(10_000)
        page.set_default_navigation_timeout(30_000)

        page_errors: list[str] = []
        page.on("pageerror", lambda error: page_errors.append(str(error)))

        succeeded = False
        raw_video_path = Path(page.video.path())
        try:
            print(f"1. Opening {APP_URL}...")
            page.goto(APP_URL, wait_until="domcontentloaded", timeout=30_000)
            page.locator("body").wait_for(state="visible")
            page.wait_for_timeout(1800)
            inject_cursor_and_smooth_ui(page)

            handle_login_if_needed(page)

            print("2. Showcasing the Command Center...")
            smooth_scroll(page, 450)
            time.sleep(1.2)
            smooth_scroll(page, -450)
            time.sleep(1)

            print("3. Showcasing the Vault...")
            open_scene(page, "Vault", "/vault")
            smooth_scroll(page, 650)
            time.sleep(1.5)
            smooth_scroll(page, 650)
            time.sleep(1.5)
            smooth_scroll(page, -1300)
            time.sleep(1)

            print("4. Showcasing the Review Queue...")
            open_scene(page, "Queue", "/queue")
            smooth_scroll(page, 400)
            time.sleep(1.8)
            smooth_scroll(page, -400)
            time.sleep(1)

            print("5. Showcasing application History...")
            open_scene(page, "History", "/history")
            smooth_scroll(page, 450)
            time.sleep(1.5)
            smooth_scroll(page, -450)
            time.sleep(1)

            print("6. Returning to the Command Center...")
            open_scene(page, "Agent", "/agent")
            page.evaluate("window.scrollTo({ top: 0, behavior: 'smooth' })")
            time.sleep(2)
            if page_errors:
                raise RuntimeError(f"The page raised a browser error: {page_errors[0]}")

            succeeded = True
        except Exception as error:
            timestamp = int(time.time())
            screenshot_path = OUT_DIR / f"demo_error_{timestamp}.png"
            try:
                page.screenshot(path=str(screenshot_path), full_page=True)
                print(f"Diagnostic screenshot: {screenshot_path}")
            except Exception as screenshot_error:
                print(f"Could not capture a diagnostic screenshot: {screenshot_error}")
            print(f"Recording stopped at {page.url}: {error}")
            raise
        finally:
            context.close()
            browser.close()
            if not succeeded:
                raw_video_path.unlink(missing_ok=True)

        final_video = OUT_DIR / f"verdant_demo_{int(time.time())}.webm"
        raw_video_path.replace(final_video)
        print(f"\nDemo recording complete!\nSaved 1080p video to: {final_video}")


if __name__ == "__main__":
    record_verdant_demo()
