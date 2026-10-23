import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import sanitizeHtml from "sanitize-html";
import { COMPANY } from "./legal";
import {
  legalContentHash,
  type BookingLegalContract,
  type BookingLegalSnapshot,
} from "./bookingLegalEvidence";

type Section = { title: string; metadata?: string; paragraphs: string[] };

function decodeText(text: string) {
  return text.replace(
    /&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/gi,
    (entity) => {
      const named: Record<string, string> = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
        "&nbsp;": " ",
      };
      if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
      const code = entity.toLowerCase().startsWith("&#x")
        ? parseInt(entity.slice(3, -1), 16)
        : parseInt(entity.slice(2, -1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    },
  );
}

export function legalHtmlParagraphs(html: string) {
  const parts: string[] = [];
  const blocks = new Set([
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "ul",
    "ol",
    "li",
    "div",
    "br",
  ]);
  sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {},
    onOpenTag(name) {
      if (blocks.has(name)) parts.push("\n");
      if (name === "li") parts.push("- ");
    },
    onCloseTag(name) {
      if (blocks.has(name)) parts.push("\n");
    },
    textFilter(text) {
      parts.push(text);
      return text;
    },
  });
  return decodeText(parts.join(""))
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function fontText(text: string, font: PDFFont) {
  return [...text.normalize("NFC")]
    .map((character) => {
      const value = /[\u0000-\u001f]/.test(character) ? " " : character;
      try {
        font.encodeText(value);
        return value;
      } catch {
        const ascii = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
        try {
          font.encodeText(ascii);
          return ascii;
        } catch {
          return "?";
        }
      }
    })
    .join("");
}

function linesFor(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of fontText(text, font).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    for (const character of word) {
      if (line && font.widthOfTextAtSize(line + character, size) > width) {
        lines.push(line);
        line = "";
      }
      line += character;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function render(title: string, acceptedAt: string, sections: Section[]) {
  const pdf = await PDFDocument.create();
  const date = new Date(acceptedAt);
  if (!Number.isFinite(date.getTime()))
    throw new Error("Invalid acceptance date");
  pdf.setTitle(title);
  pdf.setAuthor(COMPANY.name);
  pdf.setCreator("Opulence Bliss");
  // Stable bytes allow an uncertain email submission to be retried safely.
  pdf.setCreationDate(date);
  pdf.setModificationDate(date);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.09, 0.12, 0.16),
    purple = rgb(0.43, 0.16, 0.85);
  let page: PDFPage,
    y = 0;
  const newPage = () => {
    page = pdf.addPage([595.28, 841.89]);
    page.drawRectangle({
      x: 0,
      y: 835.89,
      width: 595.28,
      height: 6,
      color: purple,
    });
    page.drawText("OPULENCE BLISS", {
      x: 48,
      y: 798,
      size: 9,
      font: bold,
      color: purple,
    });
    y = 767;
  };
  const paragraph = (text: string, heading = false) => {
    const font = heading ? bold : regular,
      size = heading ? 17 : 10;
    for (const line of linesFor(text, font, size, 499.28)) {
      if (y < 66) newPage();
      page.drawText(line, { x: 48, y, size, font, color: ink });
      y -= heading ? 23 : 15;
    }
    y -= heading ? 10 : 7;
  };
  for (const section of sections) {
    newPage();
    paragraph(section.title, true);
    if (section.metadata) paragraph(section.metadata);
    for (const text of section.paragraphs) paragraph(text);
  }
  const pages = pdf.getPages();
  pages.forEach((p, index) => {
    p.drawLine({
      start: { x: 48, y: 45 },
      end: { x: 547.28, y: 45 },
      thickness: 0.5,
      color: rgb(0.85, 0.85, 0.89),
    });
    p.drawText(
      `hello@opulencebliss.com | Page ${index + 1} of ${pages.length}`,
      { x: 48, y: 30, size: 8, font: regular, color: rgb(0.4, 0.4, 0.45) },
    );
  });
  return pdf.save({ useObjectStreams: false });
}

function policySection(
  document: BookingLegalSnapshot,
  acceptedAt: string,
): Section {
  if (
    !document.contentHtml ||
    legalContentHash(document.contentHtml) !== document.displayContentHash
  )
    throw new Error("Accepted policy snapshot is unavailable");
  return {
    title: document.title,
    metadata: `Version ${document.version} | Accepted ${new Date(acceptedAt).toISOString()} (UTC)${document.updatedAt ? ` | Document updated ${new Date(document.updatedAt).toISOString().slice(0, 10)}` : ""}`,
    paragraphs: legalHtmlParagraphs(document.contentHtml),
  };
}

export function generateAcceptedPolicyPdf(
  document: BookingLegalSnapshot,
  acceptedAt: string,
) {
  return render(`${document.title} - Version ${document.version}`, acceptedAt, [
    policySection(document, acceptedAt),
  ]);
}

export function generateBookingLegalPdf(contract: BookingLegalContract) {
  return render("Your booking policies", contract.acceptedAt, [
    {
      title: "Your booking policies",
      metadata: `Accepted ${new Date(contract.acceptedAt).toISOString()} (UTC)`,
      paragraphs: [
        "These are the policy versions displayed and accepted at checkout. Keep this copy with your booking confirmation.",
        ...contract.bookings.map(
          (booking) =>
            `Booking ${booking.id}: ${booking.service}, ${new Date(booking.scheduledAt).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "long", timeStyle: "short" })} (London time).`,
        ),
        "Your confirmations:",
        ...contract.evidence.checkboxes.map((box) => box.text),
      ],
    },
    ...contract.documents.map((document) =>
      policySection(document, contract.acceptedAt),
    ),
  ]);
}

export function generateCancellationFormPdf(acceptedAt: string) {
  return render("Model cancellation form", acceptedAt, [
    {
      title: "Model cancellation form",
      paragraphs: [
        "Use this form only if you wish to cancel. Any clear notice is enough; you do not have to use this form.",
        `To ${COMPANY.name}, ${COMPANY.registeredOffice}, hello@opulencebliss.com:`,
        "I hereby give notice that I cancel my contract for the supply of the following service:",
        "Service and booking reference: __________________________________________",
        "Ordered on: _________________________________________________________",
        "Name of consumer: __________________________________________________",
        "Address of consumer: ________________________________________________",
        "___________________________________________________________________",
        "Date: ______________________________________________________________",
        "Signature of consumer (only if this form is sent on paper): ____________________",
        "Send your notice to hello@opulencebliss.com. Your accepted policies explain the cancellation rules that apply to your booking.",
      ],
    },
  ]);
}
