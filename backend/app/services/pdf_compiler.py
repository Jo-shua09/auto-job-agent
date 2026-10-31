import sys
import asyncio
from pathlib import Path
from playwright.sync_api import sync_playwright
from app.models.schemas import MasterProfile, TailoredPackage

GENERATED_PDF_DIR = Path(__file__).resolve().parent.parent.parent / "generated_pdfs"
GENERATED_PDF_DIR.mkdir(parents=True, exist_ok=True)

def build_ats_cv_html(profile: MasterProfile, package: TailoredPackage, target_role_title: str) -> str:
    """Renders a clean, single-column ATS-optimized HTML resume."""
    experiences_html = ""
    for exp in package.selected_experiences:
        bullets = "".join(f"<li>{b}</li>" for b in exp.verified_bullets)
        experiences_html += f"""
        <div class="item">
            <div class="row">
                <span class="bold">{exp.role_title} — {exp.company}</span>
                <span class="date">{exp.start_date} – {exp.end_date} | {exp.location}</span>
            </div>
            <ul>{bullets}</ul>
        </div>
        """

    projects_html = ""
    for proj in package.selected_projects:
        bullets = "".join(f"<li>{b}</li>" for b in proj.verified_bullets)
        tech_str = ", ".join(proj.tech_stack)
        award_badge = f" <span class='award'>({proj.awards_or_metrics})</span>" if proj.awards_or_metrics else ""
        projects_html += f"""
        <div class="item">
            <div class="row">
                <span class="bold">{proj.name}{award_badge}</span>
                <span class="tech">{tech_str}</span>
            </div>
            <ul>{bullets}</ul>
        </div>
        """

    skills_rows = ""
    for category, skills in profile.skills_by_category.items():
        skills_rows += f"<div><span class='bold'>{category}:</span> {', '.join(skills)}</div>"

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 9.5pt;
    line-height: 1.42;
    color: #111827;
    padding: 0.45in 0.5in;
  }}
  h1 {{
    font-family: 'Bricolage+Grotesque', sans-serif;
    font-size: 20pt;
    font-weight: 700;
    color: #090d16;
    letter-spacing: -0.3px;
  }}
  .subtitle {{
    font-size: 10.5pt;
    font-weight: 600;
    color: #2563eb;
    margin-bottom: 4px;
  }}
  .contact {{
    font-size: 8.8pt;
    color: #374151;
    margin-bottom: 10px;
  }}
  h2 {{
    font-family: 'Bricolage Grotesque', sans-serif;
    font-size: 10.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #111827;
    border-bottom: 1.5px solid #e5e7eb;
    padding-bottom: 2px;
    margin-top: 10px;
    margin-bottom: 6px;
  }}
  .summary {{
    font-size: 9.2pt;
    color: #1f2937;
    margin-bottom: 6px;
  }}
  .item {{ margin-bottom: 7px; }}
  .row {{
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }}
  .bold {{ font-weight: 700; color: #090d16; }}
  .date, .tech {{ font-size: 8.5pt; color: #4b5563; font-weight: 500; white-space: nowrap; }}
  .award {{ font-size: 8.5pt; color: #1d4ed8; font-weight: 600; }}
  ul {{ margin-left: 15px; margin-top: 2px; }}
  li {{ margin-bottom: 2px; }}
  .skills-grid {{ display: flex; flex-direction: column; gap: 3px; font-size: 9pt; }}
</style>
</head>
<body>
  <h1>{profile.full_name}</h1>
  <div class="subtitle">{target_role_title}</div>
  <div class="contact">
    {profile.location} &bull; {profile.email} &bull; {profile.phone} &bull;
    <a href="{profile.github_url}">{profile.github_url}</a> &bull;
    <a href="{profile.portfolio_url}">{profile.portfolio_url}</a>
  </div>

  <h2>Professional Summary</h2>
  <div class="summary">{package.tailored_summary}</div>

  <h2>Technical Skills</h2>
  <div class="skills-grid">{skills_rows}</div>

  <h2>Professional Experience</h2>
  {experiences_html}

  <h2>Featured Engineering & AI Projects</h2>
  {projects_html}

  <h2>Education</h2>
  <div class="row">
    <span class="bold">B.Sc. in Computer Science — Lagos State University of Science and Technology (LASUSTECH)</span>
    <span class="date">Lagos, Nigeria</span>
  </div>
</body>
</html>"""

def _render_pdf_sync(html_content: str, output_path: str) -> None:
    """Runs Playwright in a dedicated thread so Windows ProactorEventLoop works seamlessly under Uvicorn --reload."""
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_content(html_content, wait_until="networkidle")
        page.pdf(
            path=output_path,
            format="A4",
            print_background=True,
            margin={"top": "0in", "bottom": "0in", "left": "0in", "right": "0in"},
        )
        browser.close()

async def compile_tailored_cv_pdf(
    profile: MasterProfile,
    package: TailoredPackage,
    target_role_title: str = "Frontend & AI Engineer",
    filename_prefix: str = "Joshua_Ituma_CV",
) -> str:
    """Compiles the tailored package into a crisp ATS PDF and returns the file URL/path."""
    html_content = build_ats_cv_html(profile, package, target_role_title)
    safe_name = "".join(c if c.isalnum() or c in ("_", "-") else "_" for c in filename_prefix)
    pdf_filename = f"{safe_name}_{package.job_id}.pdf"
    local_pdf_path = GENERATED_PDF_DIR / pdf_filename

    await asyncio.to_thread(_render_pdf_sync, html_content, str(local_pdf_path))
    return f"/pdfs/{pdf_filename}"