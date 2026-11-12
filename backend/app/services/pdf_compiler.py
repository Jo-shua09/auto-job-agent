import sys
import asyncio
import logging
import re
from html import escape
from pathlib import Path
from playwright.sync_api import sync_playwright
from app.models.schemas import MasterProfile, TailoredPackage

logger = logging.getLogger(__name__)

GENERATED_PDF_DIR = Path(__file__).resolve().parent.parent.parent / "generated_pdfs"
GENERATED_PDF_DIR.mkdir(parents=True, exist_ok=True)


def _safe_filename_part(value: str, fallback: str, max_length: int) -> str:
    safe_value = re.sub(r"[^\w-]+", "_", value.strip()).strip("_-")
    return (safe_value or fallback)[:max_length].rstrip("_-") or fallback


def build_ats_cv_html(profile: MasterProfile, package: TailoredPackage, target_role_title: str) -> str:
    """Renders a clean, single-column ATS-optimized HTML resume."""
    experiences_html = ""
    for exp in package.selected_experiences:
        bullets = "".join(f"<li>{escape(b)}</li>" for b in exp.verified_bullets)
        experiences_html += f"""
        <div class="item">
            <div class="row">
                <span class="bold">{escape(exp.role_title)} - {escape(exp.company)}</span>
                <span class="date">{escape(exp.start_date)} - {escape(exp.end_date)} | {escape(exp.location)}</span>
            </div>
            <ul>{bullets}</ul>
        </div>
        """

    projects_html = ""
    for proj in package.selected_projects:
        bullets = "".join(f"<li>{escape(b)}</li>" for b in proj.verified_bullets)
        tech_str = ", ".join(escape(skill) for skill in proj.tech_stack)
        award_badge = f" <span class='award'>({escape(proj.awards_or_metrics)})</span>" if proj.awards_or_metrics else ""
        projects_html += f"""
        <div class="item">
            <div class="row">
                <span class="bold">{escape(proj.name)}{award_badge}</span>
                <span class="tech">{tech_str}</span>
            </div>
            <ul>{bullets}</ul>
        </div>
        """

    skills_rows = ""
    for category, skills in profile.skills_by_category.items():
        skills_rows += f"<div><span class='bold'>{escape(category)}:</span> {', '.join(escape(skill) for skill in skills)}</div>"

    education_html = "".join(
        f"""
        <div class="row">
          <span class="bold">{escape(education.degree)} - {escape(education.institution)}</span>
          <span class="date">{escape(education.dates)} | {escape(education.location)}</span>
        </div>
        """
        for education in profile.education
    )
    contact_details = " &bull; ".join(
        escape(value) for value in (profile.location, profile.email, profile.phone, profile.github_url, profile.portfolio_url, profile.linkedin_url) if value
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 9.5pt;
    line-height: 1.42;
    color: #111827;
    padding: 0.45in 0.5in;
  }}
  h1 {{
    font-family: Arial, sans-serif;
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
    font-family: Arial, sans-serif;
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
  <h1>{escape(profile.full_name)}</h1>
  <div class="subtitle">{escape(target_role_title)}</div>
  <div class="contact">
    {contact_details}
  </div>

  <h2>Professional Summary</h2>
  <div class="summary">{escape(package.tailored_summary)}</div>

  <h2>Technical Skills</h2>
  <div class="skills-grid">{skills_rows}</div>

  <h2>Professional Experience</h2>
  {experiences_html}

  <h2>Featured Engineering & AI Projects</h2>
  {projects_html}

  {f"<h2>Education</h2>{education_html}" if education_html else ""}
</body>
</html>"""

def _render_pdf_sync(html_content: str, output_path: str) -> None:
    """Runs Playwright in a dedicated thread so Windows ProactorEventLoop works seamlessly under Uvicorn --reload."""
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        try:
            page = browser.new_page()
            page.set_content(html_content, wait_until="load", timeout=15000)
            page.pdf(
                path=output_path,
                format="A4",
                print_background=True,
                margin={"top": "0in", "bottom": "0in", "left": "0in", "right": "0in"},
            )
        finally:
            browser.close()


def _render_pdf_with_reportlab_sync(
    profile: MasterProfile,
    package: TailoredPackage,
    target_role_title: str,
    output_path: str,
) -> None:
    """Pure-Python fallback used when Chromium is unavailable on the host."""
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

    document = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=0.5 * inch,
        rightMargin=0.5 * inch,
        topMargin=0.45 * inch,
        bottomMargin=0.45 * inch,
    )
    base_styles = getSampleStyleSheet()
    name_style = ParagraphStyle(
        "CandidateName",
        parent=base_styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=18,
        leading=22,
        alignment=TA_LEFT,
        spaceAfter=2,
    )
    role_style = ParagraphStyle(
        "TargetRole",
        parent=base_styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=10.5,
        leading=13,
        textColor="#2563eb",
        spaceAfter=3,
    )
    contact_style = ParagraphStyle(
        "Contact",
        parent=base_styles["Normal"],
        fontName="Helvetica",
        fontSize=8.5,
        leading=11,
        spaceAfter=8,
    )
    heading_style = ParagraphStyle(
        "SectionHeading",
        parent=base_styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=10.5,
        leading=13,
        spaceBefore=8,
        spaceAfter=4,
        textColor="#111827",
    )
    body_style = ParagraphStyle(
        "BodyText",
        parent=base_styles["Normal"],
        fontName="Helvetica",
        fontSize=9.2,
        leading=12.5,
        spaceAfter=3,
    )
    meta_style = ParagraphStyle(
        "MetaText",
        parent=body_style,
        fontSize=8.5,
        textColor="#4b5563",
        spaceAfter=2,
    )
    bullet_style = ParagraphStyle(
        "BulletText",
        parent=body_style,
        leftIndent=12,
        bulletIndent=4,
        spaceAfter=1,
    )

    story = [Paragraph(escape(profile.full_name or "Candidate"), name_style)]
    if target_role_title:
        story.append(Paragraph(escape(target_role_title), role_style))
    contact_details = " | ".join(
        escape(value)
        for value in (
            profile.location,
            profile.email,
            profile.phone,
            profile.github_url,
            profile.portfolio_url,
            profile.linkedin_url,
        )
        if value
    )
    if contact_details:
        story.append(Paragraph(contact_details, contact_style))

    story.append(Paragraph("Professional Summary", heading_style))
    story.append(Paragraph(escape(package.tailored_summary), body_style))

    if profile.skills_by_category:
        story.append(Paragraph("Technical Skills", heading_style))
        for category, skills in profile.skills_by_category.items():
            story.append(
                Paragraph(
                    f"<b>{escape(category)}:</b> {escape(', '.join(skills))}",
                    body_style,
                )
            )

    if package.selected_experiences:
        story.append(Paragraph("Professional Experience", heading_style))
        for experience in package.selected_experiences:
            story.append(
                Paragraph(
                    f"<b>{escape(experience.role_title)} - {escape(experience.company)}</b>",
                    body_style,
                )
            )
            story.append(
                Paragraph(
                    f"{escape(experience.start_date)} - {escape(experience.end_date)} | {escape(experience.location)}",
                    meta_style,
                )
            )
            for bullet in experience.verified_bullets:
                story.append(Paragraph(escape(bullet), bullet_style, bulletText="•"))
            story.append(Spacer(1, 4))

    if package.selected_projects:
        story.append(Paragraph("Featured Engineering & AI Projects", heading_style))
        for project in package.selected_projects:
            story.append(Paragraph(f"<b>{escape(project.name)}</b>", body_style))
            if project.tech_stack:
                story.append(Paragraph(escape(", ".join(project.tech_stack)), meta_style))
            for bullet in project.verified_bullets:
                story.append(Paragraph(escape(bullet), bullet_style, bulletText="•"))
            story.append(Spacer(1, 4))

    if profile.education:
        story.append(Paragraph("Education", heading_style))
        for education in profile.education:
            story.append(
                Paragraph(
                    f"<b>{escape(education.degree)} - {escape(education.institution)}</b>",
                    body_style,
                )
            )
            story.append(
                Paragraph(
                    f"{escape(education.dates)} | {escape(education.location)}",
                    meta_style,
                )
            )

    document.build(story)


async def compile_tailored_cv_pdf(
    profile: MasterProfile,
    package: TailoredPackage,
    target_role_title: str = "",
    filename_job_title: str | None = None,
) -> str:
    """Compiles the tailored package into a crisp ATS PDF and returns the file URL/path."""
    html_content = build_ats_cv_html(profile, package, target_role_title)
    user_name = _safe_filename_part(profile.full_name, "Candidate", 80)
    job_name = _safe_filename_part(filename_job_title or target_role_title, "Job", 100)
    pdf_filename = f"{user_name}_{job_name}_CV.pdf"
    local_pdf_path = GENERATED_PDF_DIR / pdf_filename

    try:
        await asyncio.to_thread(_render_pdf_sync, html_content, str(local_pdf_path))
    except Exception:
        logger.exception("Chromium PDF rendering failed; using the ReportLab fallback.")
        await asyncio.to_thread(
            _render_pdf_with_reportlab_sync,
            profile,
            package,
            target_role_title,
            str(local_pdf_path),
        )
    return f"/pdfs/{pdf_filename}"