import "server-only";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";

/* أثر تتبع الملفات (node-file-tracing): readdirSync ثابت على مجلد bin يجبر
 * المتتبع على تضمين ثنائية chromium.br وaws.tar.br في حزمة الـserverless —
 * دون هذا يفشل executablePath() على Vercel بمجلد bin ناقص. */
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pkgDir = path.dirname(require.resolve("@sparticuz/chromium/package.json"));
  readdirSync(path.join(pkgDir, "bin"));
} catch {
  /* بيئات بلا الحزمة (لن تحدث — حزمة إلزامية) */
}

/**
 * تحويل HTML إلى PDF عبر Chromium بلا واجهة (المرحلة 8).
 * ترتيب البحث عن الملف التنفيذي:
 *   1) PDF_EXECUTABLE_PATH (override صريح)
 *   2) @sparticuz/chromium — الافتراضي للإنتاج (Vercel serverless، يفك ضغط نسخته إلى /tmp)
 *   3) كاش playwright المحلي داخل ms-playwright في مجلد المنزل (chrome-linux64/chrome)
 *      (احتياط بيئات التطوير — مثل هذا الحاوية حيث يفشل استخراج al2023)
 * الخط العربي مضمّن داخل HTML نفسه (font-data.ts) فلا حاجة لخطوط النظام.
 */

const BASE_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--font-render-hinting=none",
];

async function resolveChromium(): Promise<{ path: string; args: string[] }> {
  const envPath = process.env.PDF_EXECUTABLE_PATH;
  if (envPath && existsSync(envPath)) return { path: envPath, args: BASE_ARGS };

  let sparticuzError = "";
  try {
    const chromium = (await import("@sparticuz/chromium")).default;
    const p = await chromium.executablePath();
    if (p && existsSync(p))
      return { path: p, args: [...chromium.args] }; // أعلامهم إلزامية لبنائهم (--single-process --no-zygote...)
    sparticuzError = `أعاد مسارًا غير موجود: ${p}`;
    console.error("[pdf] @sparticuz/chromium", sparticuzError);
  } catch (e) {
    sparticuzError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    // محليًا قد يفشل الاستخراج (بيئة غير Amazon Linux) — ننسحب إلى كاش playwright
    console.error("[pdf] فشل @sparticuz/chromium executablePath:", sparticuzError);
  }

  const cache = path.join(homedir(), ".cache", "ms-playwright");
  if (existsSync(cache)) {
    try {
      const dirs = readdirSync(cache)
        .filter((d) => d.startsWith("chromium") && !d.includes("headless"))
        .sort()
        .reverse();
      for (const dir of dirs) {
        for (const sub of ["chrome-linux64", "chrome-linux"]) {
          const candidate = path.join(cache, dir, sub, "chrome");
          if (existsSync(candidate)) return { path: candidate, args: BASE_ARGS };
        }
      }
    } catch {
      // تجاهل واقذف الخطأ الواضح أدناه
    }
  }
  throw new Error(
    `لا يوجد كروميوم متاح لتحويل HTML إلى PDF (حدد PDF_EXECUTABLE_PATH)${sparticuzError ? ` · سبب sparticuz: ${sparticuzError}` : ""}`
  );
}

/** يطبع HTML مستقل (بـ@page كامل) إلى PDF A4 — الهوامش تأتي من CSS لا من الخيار */
export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  let executablePath: string;
  let args: string[];
  try {
    ({ path: executablePath, args } = await resolveChromium());
  } catch (e) {
    console.error("[pdf] لا كروميوم:", e instanceof Error ? e.message : e);
    throw e;
  }
  const browser = await puppeteer.launch({
    args,
    executablePath,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    // HTML مستقل بلا موارد خارجية (الخط مضمّن base64) — «load» كافية
    // (نوع setContent في puppeteer-core 25 لا يقبل networkidle0)
    await page.setContent(html, { waitUntil: "load", timeout: 45_000 });
    // انتظار جهوزية الخط المضمّن قبل الطباعة
    await page.evaluateHandle("document.fonts.ready");
    const buf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
    return Buffer.from(buf);
  } finally {
    await browser.close();
  }
}
