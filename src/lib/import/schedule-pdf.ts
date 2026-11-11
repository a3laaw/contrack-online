/**
 * استخراج نص PDF للبرنامج الزمني — docs/schedule-import-design.md §3.
 *
 * pdf-parse v2 (pdfjs-dist legacy) يمس DOMMatrix/Path2D/ImageData وقت التحميل حتى
 * لاستخراج النص فقط — البيئة الخادمية بلا canvas فنضيف رقعاً استئثارية فارغة
 * (استخراج النص لا يرسم شيئاً — الرقع لا تؤثر على أي نتيجة).
 */

type MinimalCtor = new (...args: never[]) => unknown;

function ensureCanvasStubs(): void {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.DOMMatrix === "undefined") {
    g.DOMMatrix = class {
      // pdfjs يستخدمها لتحويلات الرسم فقط — استخراج النص لا يمر بها عملياً
      constructor(_init?: unknown) {}
      static get scale(): unknown { return 1; }
    } as unknown as MinimalCtor;
  }
  if (typeof g.Path2D === "undefined") {
    g.Path2D = class {} as unknown as MinimalCtor;
  }
  if (typeof g.ImageData === "undefined") {
    g.ImageData = class {} as unknown as MinimalCtor;
  }
}

/** استخراج نص مستند PDF كاملاً (صفحة-صفحة يدمجها pdf-parse بنفسها). */
export async function extractPdfText(buffer: Buffer): Promise<{ text: string; pages: number }> {
  ensureCanvasStubs();
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const res = await parser.getText();
    return { text: res.text, pages: res.pages?.length ?? 0 };
  } finally {
    await parser.destroy();
  }
}
