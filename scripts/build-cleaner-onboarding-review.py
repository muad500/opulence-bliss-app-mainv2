"""Render the single-source client review pack; no delivery or publication."""

import argparse
import json
from html import escape
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    catalog = json.loads(
        (root / "content/cleaner-onboarding-drafts.json").read_text(encoding="utf-8")
    )
    if catalog["status"] != "draft":
        raise ValueError("This renderer supports unapproved client review only.")
    fonts = Path("C:/Windows/Fonts")
    regular = fonts / "segoeui.ttf"
    bold = fonts / "segoeuib.ttf"
    if not regular.is_file() or not bold.is_file():
        raise ValueError("The configured local review fonts are unavailable.")
    pdfmetrics.registerFont(TTFont("Review", str(regular)))
    pdfmetrics.registerFont(TTFont("ReviewBold", str(bold)))
    pdfmetrics.registerFontFamily("Review", normal="Review", bold="ReviewBold")
    purple = colors.HexColor("#6821A8")
    gold = colors.HexColor("#9F7D37")
    ink = colors.HexColor("#24222A")
    muted = colors.HexColor("#625A69")
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle("ReviewBody", fontName="Review", fontSize=10.2,
                              leading=14.2, textColor=ink, spaceAfter=8))
    styles.add(ParagraphStyle("ReviewSmall", parent=styles["ReviewBody"],
                              fontSize=8.8, leading=12, textColor=muted, spaceAfter=5))
    styles.add(ParagraphStyle("ReviewTitle", fontName="ReviewBold", fontSize=29,
                              leading=34, textColor=purple, spaceAfter=16))
    styles.add(ParagraphStyle("ReviewH1", parent=styles["ReviewTitle"], fontSize=20,
                              leading=25, spaceAfter=14))
    styles.add(ParagraphStyle("ReviewH2", parent=styles["ReviewTitle"], fontSize=15,
                              leading=20, spaceBefore=6, spaceAfter=9))
    styles.add(ParagraphStyle("ReviewBadge", fontName="ReviewBold", fontSize=9,
                              leading=12, textColor=gold, spaceAfter=9))
    styles.add(ParagraphStyle("ReviewItem", parent=styles["ReviewBody"],
                              leftIndent=13, firstLineIndent=-13, spaceAfter=7))
    styles.add(ParagraphStyle("ReviewSubject", parent=styles["ReviewBody"],
                              fontName="ReviewBold", textColor=purple, spaceAfter=11))
    styles.add(ParagraphStyle("ReviewInventory", parent=styles["ReviewBody"],
                              fontSize=9.4, leading=12.5, spaceAfter=0))

    def p(text, style="ReviewBody"):
        return Paragraph(escape(str(text)).replace("\n", "<br/>"), styles[style])

    story = []
    label = catalog["statusLabel"]
    entries = catalog["emails"] + catalog["declarations"] + catalog["checklists"]
    items = sum(len(group["items"]) for group in catalog["checklists"])
    story += [Spacer(1, 18 * mm), p("OPULENCE BLISS", "ReviewBadge"),
              p("Cleaner onboarding\nClient review pack", "ReviewTitle"),
              p(label, "ReviewBadge"),
              p(f"{catalog['version']} | Prepared {catalog['preparedOn']}", "ReviewSmall"),
              Spacer(1, 6 * mm), p(catalog["purpose"]),
              p(f"{len(catalog['emails'])} email drafts · {len(catalog['declarations'])} acknowledgement · "
                f"{len(catalog['checklists'])} checklist sections / {items} items"),
              Spacer(1, 6 * mm), p("Approval record", "ReviewH2"),
              p("Decision: approve as written / approve with amendments / request changes"),
              p("Approved item codes and version: __________________________________"),
              p("Client name and date: ___________________________________________"),
              p("Approval recorded in this review copy does not send an email or activate a feature. "
                "Approved wording must be versioned and connected to the guarded workflow separately.", "ReviewSmall"),
              Spacer(1, 7 * mm), p("Published sources", "ReviewH2")]
    for source in catalog["sources"]:
        story.append(p(f"{source['title']}, v{source['version']}, effective {source['effectiveDate']}.", "ReviewSmall"))
    story += [PageBreak(), p("Complete draft inventory", "ReviewH1"), p(label, "ReviewBadge")]
    rows = [[p("Code", "ReviewInventory"), p("Draft for approval", "ReviewInventory")]]
    for entry in entries:
        title = f'<link href="#{escape(entry["code"])}" color="#6821A8">{escape(entry["title"])}</link>'
        rows.append([p(entry["code"], "ReviewInventory"), Paragraph(title, styles["ReviewInventory"])])
    table = Table(rows, colWidths=[20 * mm, 155 * mm], repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F1E9F8")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, 0), 1, purple),
        ("LINEBELOW", (0, 1), (-1, -1), 0.3, colors.HexColor("#E3DCE9")),
    ]))
    story += [table, PageBreak(), p("Review and implementation notes", "ReviewH1")]
    for note in catalog["reviewNotes"]:
        story.append(p("• " + note, "ReviewItem"))
    story += [Spacer(1, 4 * mm), p("How to approve", "ReviewH2"),
              p("Refer to the item codes (E01–E10, D01, C01–C12) and this review version. "
                "List any amendments or any items you are not approving. The team can update the single "
                "editable source and issue a new review version before enabling the wording."), PageBreak()]

    def heading(entry):
        anchor = f'<a name="{entry["code"]}"/>'
        return [Paragraph(anchor + escape(f"{entry['code']}. {entry['title']}"), styles["ReviewH2"]),
                p(label, "ReviewBadge"), p("Reference: " + entry["reference"], "ReviewSmall"),
                p("Basis: " + "; ".join(entry["basis"]), "ReviewSmall")]

    def notes(entry):
        if not entry["notes"]:
            return []
        return [Spacer(1, 3 * mm), p("Reviewer notes", "ReviewSubject")] + [
            p("• " + note, "ReviewSmall") for note in entry["notes"]
        ]

    for entry in catalog["emails"]:
        block = heading(entry) + [p("Audience: " + entry["audience"], "ReviewSmall"),
                                 p("Trigger: " + entry["trigger"], "ReviewSmall"),
                                 Spacer(1, 3 * mm), p("Subject: " + entry["subject"], "ReviewSubject")]
        block += [p(text) for text in entry["paragraphs"]]
        block += notes(entry) + [Spacer(1, 4 * mm), HRFlowable(width="100%", thickness=0.5,
                                                            color=colors.HexColor("#DFD4E7")), Spacer(1, 6 * mm)]
        story.append(KeepTogether(block))
    story += [PageBreak(), p("Application acknowledgement", "ReviewH1")]
    for entry in catalog["declarations"]:
        story.append(KeepTogether(heading(entry) + [p(entry["wording"])] + notes(entry)))
    story += [PageBreak(), p("Staff checklist", "ReviewH1"),
              p("These are review checkboxes, not live application decisions. In the approved workflow, "
                "each completed item records the staff member, UTC time and any necessary note. "
                "Sensitive evidence stays in the restricted record.")]
    for entry in catalog["checklists"]:
        block = heading(entry)
        for item in entry["items"]:
            block.append(p("☐ " + item["text"], "ReviewItem"))
        block += notes(entry) + [Spacer(1, 5 * mm)]
        story.append(KeepTogether(block))
    story += [PageBreak(), p("Existing wording kept unchanged", "ReviewH1")]
    for entry in catalog["unchangedTemplates"]:
        story += [p(entry["title"], "ReviewH2"), p("Reference: " + entry["reference"], "ReviewSmall"), p(entry["note"])]

    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    document = SimpleDocTemplate(str(output), pagesize=A4, leftMargin=18 * mm,
                                 rightMargin=18 * mm, topMargin=20 * mm,
                                 bottomMargin=18 * mm, title=catalog["title"] + " - " + label,
                                 author="Prepared for Opulence Bliss client review")

    def decorate(canvas, doc):
        canvas.saveState()
        width, height = A4
        canvas.setStrokeColor(gold)
        canvas.setLineWidth(0.6)
        canvas.line(18 * mm, height - 13 * mm, width - 18 * mm, height - 13 * mm)
        canvas.setFont("ReviewBold", 8)
        canvas.setFillColor(purple)
        canvas.drawString(18 * mm, height - 10 * mm, "OPULENCE BLISS")
        canvas.setFillColor(gold)
        canvas.drawRightString(width - 18 * mm, height - 10 * mm, label)
        canvas.setFont("Review", 8)
        canvas.setFillColor(muted)
        canvas.drawString(18 * mm, 10 * mm, "Client review | " + catalog["version"])
        canvas.drawRightString(width - 18 * mm, 10 * mm, f"Page {doc.page}")
        canvas.restoreState()

    document.build(story, onFirstPage=decorate, onLaterPages=decorate)
    print(json.dumps({"created": str(output), "status": catalog["status"], "emails": len(catalog["emails"]),
                      "checklistGroups": len(catalog["checklists"]), "checklistItems": items}))


if __name__ == "__main__":
    main()
