import { describe, expect, it } from "vitest";
import PdfPrinter from "pdfmake";
import fontData from "pdfmake/build/vfs_fonts.js";
import { Document, Packer, Paragraph } from "docx";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { parseResume } from "./candidate.js";
import { exportDocx, exportPdf } from "./exports.js";
import { fixturePackage, sampleResume } from "./fixtures.js";
import { coverLetter, packageHash } from "./tailoring.js";

async function plainPdf(text: string, pages = 1): Promise<Buffer> {
  const printer = new PdfPrinter({ Roboto: { normal: Buffer.from(fontData["Roboto-Regular.ttf"], "base64") } });
  const stream = printer.createPdfKitDocument({
    content: Array.from({ length: pages }, (_, index) => ({ text, ...(index ? { pageBreak: "before" as const } : {}) })),
    defaultStyle: { font: "Roboto" }
  });
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(Buffer.concat(chunks)));
    stream.end();
  });
}

describe("bounded resume extraction", () => {
  it("reads actual PDFs and DOCX files without native graphics dependencies", async () => {
    const resume = sampleResume.replace("Taylor Reed", "Ren\u00e9e M\u00fcller");
    const documents = [
      { originalname: "resume.pdf", buffer: await plainPdf(resume) },
      { originalname: "resume.docx", buffer: await Packer.toBuffer(new Document({
        sections: [{ children: resume.split("\n").map((line) => new Paragraph(line)) }]
      })) }
    ];
    for (const file of documents) {
      const parsed = await parseResume(file);
      expect(parsed.proposedFields.fullName.value).toBe("Ren\u00e9e M\u00fcller");
      expect(parsed.proposedFields.email.value).toBe("taylor@example.test");
      expect(parsed.text).toContain("20%");
      expect(parsed.proposedFacts.some((fact) => fact.text.includes("PostgreSQL"))).toBe(true);
      expect(parsed.proposedFacts.every((fact) => fact.state === "proposed" && fact.source.documentId === parsed.id)).toBe(true);
    }
  });
  it("rejects damaged, textless, over-page-limit, and over-entry-limit files", async () => {
    await expect(parseResume({ originalname: "bad.pdf", buffer: Buffer.from("%PDF-invalid") })).rejects.toMatchObject({ status: 422 });
    await expect(parseResume({ originalname: "empty.pdf", buffer: await plainPdf(" ") })).rejects.toMatchObject({ status: 422 });
    await expect(parseResume({ originalname: "long.pdf", buffer: await plainPdf(sampleResume, 21) })).rejects.toMatchObject({ status: 422 });
    const oversizedArchive = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph(sampleResume)] }] }), undefined,
      Array.from({ length: 501 }, (_, index) => ({ path: `extra/${index}.xml`, data: "<extra/>" })));
    await expect(parseResume({ originalname: "entries.docx", buffer: oversizedArchive })).rejects.toMatchObject({ status: 422 });
    await expect(parseResume({ originalname: "bad-encoding.txt", buffer: Buffer.from([0xff, 0xfe, 0xff]) })).rejects.toMatchObject({ status: 422 });
  });
  it("normalizes a proposed profile URL without inventing career evidence", async () => {
    const parsed = await parseResume({ originalname: "links.txt", buffer: Buffer.from(sampleResume.replace("Seattle, WA", "Seattle, WA\nlinkedin.com/in/example-person")) });
    expect(parsed.proposedFields.website.value).toBe("https://linkedin.com/in/example-person");
    expect(parsed.proposedFields.website.source.excerpt).toBe("linkedin.com/in/example-person");
    expect(parsed.proposedFields.website.state).toBe("proposed");
  });
});

describe("actual approved document exports", () => {
  it("preserves accented text, contact links, sections, and only approved claims in both formats", async () => {
    const pkg = fixturePackage(sampleResume.replace("Taylor Reed", "Ren\u00e9e M\u00fcller"));
    pkg.candidate.website = "https://example.test/portfolio";
    const rejected = pkg.changes.find((change) => change.proposed.includes("20%"))!;
    rejected.decision = "rejected";
    pkg.coverLetter = coverLetter(pkg);
    pkg.hash = packageHash(pkg);
    for (const kind of ["resume", "cover"] as const) {
      const pdf = await getDocumentProxy(new Uint8Array(await exportPdf(pkg, kind)));
      try {
        const pdfText = (await extractText(pdf, { mergePages: true })).text;
        const docxText = (await mammoth.extractRawText({ buffer: await exportDocx(pkg, kind) })).value;
        for (const text of [pdfText, docxText]) {
          expect(text).toContain("Ren\u00e9e M\u00fcller");
          expect(text).not.toContain("20%");
          if (kind === "resume") {
            expect(text).toContain(pkg.candidate.website);
            expect(text).toContain("Professional summary");
            expect(text).toContain("Education");
            for (const change of pkg.changes.filter((item) => item.decision === "approved")) {
              expect(text.replace(/\s+/g, "")).toContain(change.proposed.replace(/\s+/g, ""));
            }
          } else {
            expect(text).toContain(pkg.job.company);
          }
        }
      } finally { await pdf.loadingTask.destroy(); }
    }
  });
  it("uses distinct heading and keyword font runs, not a regular-font override", async () => {
    const pdf = await getDocumentProxy(new Uint8Array(await exportPdf(fixturePackage(), "resume")));
    try {
      const page = await pdf.getPage(1);
      const content: { items: ({ str: string; fontName: string } | { type: string })[] } = await page.getTextContent();
      const items = content.items.filter((item): item is { str: string; fontName: string } => "str" in item);
      const name = items.find((item) => item.str === "Taylor Reed");
      const heading = items.find((item) => item.str === "Professional summary");
      const regular = items.find((item) => item.str.includes("taylor@example.test"));
      expect(name).toBeDefined();
      expect(heading?.fontName).toBe(name?.fontName);
      expect(heading?.fontName).not.toBe(regular?.fontName);
      expect(items.find((item) => item.str === "React")?.fontName).toBe(name?.fontName);
    } finally { await pdf.loadingTask.destroy(); }
  });
  it("refuses unapproved or tampered versions and does not silently lose unsupported glyphs", async () => {
    const pkg = fixturePackage();
    await expect(exportPdf({ ...pkg, state: "needs_review" }, "resume")).rejects.toMatchObject({ code: "UNAPPROVED_EXPORT" });
    await expect(exportDocx({ ...pkg, coverLetter: "tampered" }, "cover")).rejects.toMatchObject({ code: "UNAPPROVED_EXPORT" });
    pkg.candidate.fullName = "\u5f20\u4f1f";
    pkg.hash = packageHash(pkg);
    await expect(exportPdf(pkg, "resume")).rejects.toMatchObject({ code: "PDF_FONT_UNSUPPORTED" });
    expect((await mammoth.extractRawText({ buffer: await exportDocx(pkg, "resume") })).value).toContain("\u5f20\u4f1f");
  });
});
