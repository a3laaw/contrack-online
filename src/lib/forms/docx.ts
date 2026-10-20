import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

import {
  extractPlaceholderNames,
  guessField,
  xmlParagraphTexts,
  type GuessedField,
} from "./forms-core";

// إعادة تصدير لعملة الاختبارات ومستهلكي المسارات (التعريف الأصلي في forms-core)
export { xmlParagraphTexts, extractPlaceholderNames } from "./forms-core";

/**
 * محرك docx خادمي (بند 56) — قراءة قوالب Word واستخراج وسوم {{...}} والتوليد.
 * pizzip يفتح حاوية docx (لا تحليل مكتبة ثقيلة) وdocxtemplater يملأ الوسوم
 * داخل الـruns المقطعة تلقائيًا (جوهر اختياره للمهمة).
 */

/** نصوص الفقرات الظاهرة لكل ملفات word/*.xml — مرآة scan_word_placeholders */
export function docxParagraphTexts(buffer: Buffer): string[] {
  const zip = new PizZip(buffer);
  const chunks: string[] = [];
  for (const name of Object.keys(zip.files)) {
    if (!name.startsWith("word/") || !name.endsWith(".xml")) continue;
    const entry = zip.file(name);
    if (!entry || entry.dir) continue;
    let xml = "";
    try {
      xml = entry.asText();
    } catch {
      continue;
    }
    for (const t of xmlParagraphTexts(xml)) chunks.push(t);
  }
  return chunks;
}

export interface ScannedTemplateField extends GuessedField {
  name: string;
}

/** استخراج حقول القالب مع تخمين المصادر — مرآة wfs.scan_docx */
export function scanTemplateFields(buffer: Buffer): ScannedTemplateField[] {
  const text = docxParagraphTexts(buffer).join("\n");
  return extractPlaceholderNames(text).map((name) => ({ name, ...guessField(name) }));
}

/** فتح docx والتحقق من سلامته — يرمي عند التلف (المستدعي يحوّله لرسالة الحرس) */
export function openDocx(buffer: Buffer): PizZip {
  return new PizZip(buffer);
}

export interface RenderOptions {
  data: Record<string, string>;
  /** وسوم غير معروفة تبقى نصًا كما هي — مرآة سلوك المكتبي (استبدال المربوط فقط) */
  nullGetter?: (part: { value?: string }) => string;
}

/** توليد المستند: data ⇒ render ⇒ Buffer (docx) */
export function renderTemplateDocx(templateBuffer: Buffer, opts: RenderOptions): Buffer {
  const zip = new PizZip(templateBuffer);
  const doc = new Docxtemplater(zip, {
    delimiters: { start: "{{", end: "}}" },
    paragraphLoop: true,
    linebreaks: true,
    nullGetter:
      opts.nullGetter ??
      ((part: { value?: string }) => `{{${part.value ?? ""}}}`),
  });
  doc.render(opts.data);
  const out = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
  return out as Buffer;
}

/** بناء docx برمجي (للاختبارات وE2E — لا ملفات ثنائية بالمستودع) */
export function buildTemplateDocx(paragraphs: string[]): Buffer {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>"
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>"
  );
  const body = paragraphs
    .map(
      (p) =>
        "<w:p><w:r><w:t xml:space=\"preserve\">" +
        p
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;") +
        "</w:t></w:r></w:p>"
    )
    .join("");
  zip.file(
    "word/document.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body>${body}</w:body></w:document>`
  );
  return zip.generate({ type: "nodebuffer" }) as Buffer;
}
