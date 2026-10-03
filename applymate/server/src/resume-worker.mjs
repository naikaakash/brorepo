import { parentPort, workerData } from "node:worker_threads";
import { Buffer } from "node:buffer";
import { TextDecoder } from "node:util";
import mammoth from "mammoth";
import yauzl from "yauzl";

async function validateArchive(buffer) {
  await new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) return reject(new Error("The DOCX archive is not readable."));
      let count = 0;
      let size = 0;
      let actual = 0;
      let hasDocument = false;
      const fail = (message) => { zip.close(); reject(new Error(message)); };
      zip.on("error", () => fail("The DOCX archive is damaged."));
      zip.on("entry", (entry) => {
        count++;
        size += entry.uncompressedSize;
        if (count > 500 || size > 32 * 1024 * 1024 || entry.isEncrypted()) return fail("The DOCX is encrypted or exceeds safe extraction limits.");
        if (entry.fileName === "word/document.xml") hasDocument = true;
        if (entry.fileName.endsWith("/")) return zip.readEntry();
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return fail("A DOCX entry could not be read.");
          stream.on("data", (chunk) => {
            actual += chunk.length;
            if (actual > 32 * 1024 * 1024) {
              stream.destroy();
              fail("The DOCX exceeds safe extraction limits.");
            }
          });
          stream.on("error", () => fail("A DOCX entry is damaged."));
          stream.on("end", () => zip.readEntry());
        });
      });
      zip.on("end", () => hasDocument ? resolve() : reject(new Error("This is not a Word DOCX document.")));
      zip.readEntry();
    });
  });
}

try {
  const buffer = Buffer.from(workerData.bytes);
  let text;
  const warnings = [];
  if (workerData.kind === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const parser = await getDocumentProxy(new Uint8Array(buffer), {
      verbosity: 0, maxImageSize: 16777216,
      useSystemFonts: false, useWorkerFetch: false
    });
    try {
      if (parser.numPages > 20) throw new Error("Please upload a resume of 20 pages or fewer.");
      const result = await extractText(parser, { mergePages: true });
      text = result.text;
    } finally {
      await parser.loadingTask.destroy();
    }
  } else if (workerData.kind === "docx") {
    await validateArchive(buffer);
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
    if (result.messages.length) warnings.push("Some document formatting could not be interpreted. Review the extracted text.");
  } else {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  }
  if (text.length > 100000) throw new Error("The extracted resume is too long. Please use a shorter document.");
  if (text.replace(/\s/g, "").length < 40) throw new Error("No usable text was found. Export a text-based PDF or DOCX, or upload a UTF-8 text file.");
  parentPort.postMessage({ ok: true, text, warnings });
} catch {
  parentPort.postMessage({ ok: false, message: "This resume could not be read safely. Use an unencrypted, text-based PDF (up to 20 pages), DOCX, or UTF-8 TXT file under 5 MB. Scanned PDFs need OCR first." });
}
