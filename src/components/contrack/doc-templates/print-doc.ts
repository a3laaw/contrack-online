/**
 * طباعة منطقة المستند حصرًا — مستقل عن TipTap ليبقى قابلًا للاستيراد الثابت
 * في الشاشات بدون سحب محرر المحرر الثقيل إلى الباندل (D7).
 */
export function printDoc() {
  document.body.classList.add("doc-printing");
  const cleanup = () => document.body.classList.remove("doc-printing");
  window.addEventListener("afterprint", cleanup, { once: true });
  setTimeout(cleanup, 1500);
  window.print();
}
