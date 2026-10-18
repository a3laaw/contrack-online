/**
 * التفقيط — نسخ حرفي من قواعد tafqeet.py (spec-core K)
 * دينار كويتي: 3 خانات فلس. الصياغة: «فقط … لا غير»
 */

const ONES = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة"];
const TEENS = ["عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
const TENS = ["", "عشرة", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const HUNDREDS = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];

function threeDigits(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h > 0) parts.push(HUNDREDS[h]);
  if (rest >= 10 && rest < 20) {
    parts.push(TEENS[rest - 10]);
  } else {
    const t = Math.floor(rest / 10);
    const o = rest % 10;
    if (o > 0) parts.push(ONES[o]);
    if (t > 1) parts.push(TENS[t]);
  }
  return parts.join(" و");
}

function thousandsWord(n: number): string {
  if (n === 1) return "ألف";
  if (n === 2) return "ألفان";
  if (n >= 3 && n <= 10) return `${threeDigits(n)} آلاف`;
  return `${threeDigits(n)} ألفًا`;
}

function millionsWord(n: number): string {
  if (n === 1) return "مليون";
  if (n === 2) return "مليونان";
  if (n >= 3 && n <= 10) return `${threeDigits(n)} ملايين`;
  return `${threeDigits(n)} مليونًا`;
}

export function numberToWordsArabic(n: number): string {
  n = Math.floor(n);
  if (n === 0) return "صفر";
  if (n < 0) return `سالب ${numberToWordsArabic(-n)}`;
  const parts: string[] = [];
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const remainder = n % 1000;
  if (millions > 0) parts.push(millionsWord(millions));
  if (thousands > 0) parts.push(thousandsWord(thousands));
  if (remainder > 0) parts.push(threeDigits(remainder));
  return parts.join(" و");
}

const CURRENCIES: Record<string, { main: string; sub: string; perMain: number }> = {
  "د.ك": { main: "دينار كويتي", sub: "فلس", perMain: 1000 },
  دينار: { main: "دينار كويتي", sub: "فلس", perMain: 1000 },
  "ر.س": { main: "ريال سعودي", sub: "هللة", perMain: 100 },
  ريال: { main: "ريال سعودي", sub: "هللة", perMain: 100 },
  "د.إ": { main: "درهم إماراتي", sub: "فلس", perMain: 100 },
  درهم: { main: "درهم إماراتي", sub: "فلس", perMain: 100 },
  "ج.م": { main: "جنيه مصري", sub: "قرش", perMain: 100 },
  جنيه: { main: "جنيه مصري", sub: "قرش", perMain: 100 },
};

/** تفقيط مبلغ إلى «فقط … لا غير» */
export function tafqeet(value: number, currency = "د.ك"): string {
  const cur = CURRENCIES[currency] || { main: currency, sub: "فلس", perMain: 1000 };
  const totalSubs = Math.round(Math.abs(value) * cur.perMain);
  const main = Math.floor(totalSubs / cur.perMain);
  const sub = totalSubs % cur.perMain;
  const sign = value < 0 ? "سالب " : "";
  if (main === 0 && sub === 0) return `صفر ${cur.main} لا غير`;
  const parts: string[] = [];
  if (main > 0) parts.push(numberToWordsArabic(main));
  if (sub > 0) parts.push(numberToWordsArabic(sub));
  const mainPart = main > 0 ? `${sign}${numberToWordsArabic(main)} ${cur.main}` : "";
  const subPart = sub > 0 ? `و${numberToWordsArabic(sub)} ${cur.sub}` : "";
  return `فقط ${[mainPart, subPart].filter(Boolean).join(" ")} لا غير`;
}

/** تفقيط بالدينار الكويتي — اسم متوافق مع حوارات الطباعة */
export const tafqeetKWD = (value: number): string => tafqeet(value, "د.ك");
