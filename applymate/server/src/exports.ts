import PdfPrinter from "pdfmake";
import fontData from "pdfmake/build/vfs_fonts.js";
import fontkit from "@foliojs-fork/fontkit";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces.js";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import type { ApplicationPackage } from "@applymate/contracts";
import { packageHash } from "./tailoring.js";
import { requireCondition } from "./errors.js";

const fonts = {
  Roboto: {
    normal: Buffer.from(fontData["Roboto-Regular.ttf"], "base64"),
    bold: Buffer.from(fontData["Roboto-Medium.ttf"], "base64"),
    italics: Buffer.from(fontData["Roboto-Italic.ttf"], "base64"),
    bolditalics: Buffer.from(fontData["Roboto-MediumItalic.ttf"], "base64")
  }
};
const exportFonts = [fonts.Roboto.normal, fonts.Roboto.bold].map((bytes) => {
  const font = fontkit.create(bytes);
  if (!("hasGlyphForCodePoint" in font)) throw new Error("The bundled PDF font is not a single font.");
  return font;
});
const sectionNames: Record<string, string> = {
  summary: "Professional summary", skill: "Skills", experience: "Experience", project: "Projects",
  achievement: "Achievements", education: "Education", certification: "Certifications", other: "Additional experience"
};
interface Block { text: string; kind: "name" | "heading" | "body"; keywords?: string[] }
function blocks(pkg: ApplicationPackage, kind: "resume" | "cover"): Block[] {
  requireCondition(pkg.state === "approved" && pkg.hash === packageHash(pkg), 409, "UNAPPROVED_EXPORT", "Only intact, approved versions can be exported.");
  if (kind === "cover") return pkg.coverLetter.split("\n\n").map((text) => ({ text, kind: "body" }));
  const output: Block[] = [
    { text: pkg.candidate.fullName, kind: "name" },
    { text: [pkg.candidate.email, pkg.candidate.phone, pkg.candidate.location].filter(Boolean).join(" | "), kind: "body" }
  ];
  if (pkg.candidate.headline) output.push({ text: pkg.candidate.headline, kind: "body" });
  if (pkg.candidate.website) output.push({ text: pkg.candidate.website, kind: "body" });
  let previous = "";
  for (const change of pkg.changes.filter((item) => item.decision === "approved")) {
    if (change.section !== previous) {
      output.push({ text: sectionNames[change.section], kind: "heading" });
      previous = change.section;
    }
    output.push({ text: change.proposed, kind: "body", keywords: change.keywords });
  }
  return output;
}
function runs(text: string, keywords: string[] = []): { text: string; bold: boolean }[] {
  if (!keywords.length) return [{ text, bold: false }];
  const regex = new RegExp(`(${keywords.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(regex).filter(Boolean).map((part) => ({ text: part, bold: keywords.some((word) => word.toLowerCase() === part.toLowerCase()) }));
}

export async function exportPdf(pkg: ApplicationPackage, kind: "resume" | "cover"): Promise<Buffer> {
  const documentBlocks = blocks(pkg, kind);
  for (const block of documentBlocks) {
    for (const character of block.text) {
      const codePoint = character.codePointAt(0);
      requireCondition(/\s/u.test(character) || (codePoint !== undefined && exportFonts.every((font) => font.hasGlyphForCodePoint(codePoint))),
        422, "PDF_FONT_UNSUPPORTED", "The bundled PDF font cannot display every character in this version. Download DOCX instead; your text has not been altered.");
    }
  }
  const content: Content[] = documentBlocks.map((block) => ({
    text: runs(block.text, block.keywords).map((run) => ({ ...run, bold: run.bold || block.kind !== "body" })),
    fontSize: block.kind === "name" ? 21 : block.kind === "heading" ? 12 : 10.5,
    bold: block.kind !== "body", margin: [0, block.kind === "heading" ? 12 : 0, 0, 7]
  }));
  const definition: TDocumentDefinitions = {
    content, pageSize: "A4", pageMargins: [48, 45, 48, 45],
    defaultStyle: { font: "Roboto", lineHeight: 1.15, color: "#1f2533" },
    info: { title: `${pkg.candidate.fullName} - ${kind}`, author: pkg.candidate.fullName, subject: `Approved version ${pkg.version}` }
  };
  return new Promise((resolve, reject) => {
    const stream = new PdfPrinter(fonts).createPdfKitDocument(definition);
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(Buffer.concat(chunks)));
    stream.end();
  });
}
export async function exportDocx(pkg: ApplicationPackage, kind: "resume" | "cover"): Promise<Buffer> {
  const paragraphs = blocks(pkg, kind).map((block) => new Paragraph({
    ...(block.kind === "name" ? { heading: HeadingLevel.TITLE } : block.kind === "heading" ? { heading: HeadingLevel.HEADING_1 } : {}),
    spacing: { after: 140 },
    children: runs(block.text, block.keywords).map((run) => new TextRun({
      text: run.text, bold: run.bold || block.kind !== "body", font: "Calibri",
      size: block.kind === "name" ? 40 : block.kind === "heading" ? 25 : 22
    }))
  }));
  return Packer.toBuffer(new Document({
    creator: pkg.candidate.fullName, title: `${pkg.candidate.fullName} - ${kind}`, description: `Approved version ${pkg.version}`,
    sections: [{ properties: {}, children: paragraphs }]
  }));
}
