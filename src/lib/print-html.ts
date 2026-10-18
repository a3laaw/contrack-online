// ============================================================
// مساعد الطباعة: ينسخ محتوى الورقة إلى حاوية #print-root
// على مستوى body (بلا أسلاف fixed/transform) ثم يستدعي window.print
// — يضمن طباعة صحيحة في Chromium حتى داخل حوارات Radix
// ============================================================

export function printElement(el: HTMLElement): void {
  // إزالة أي جذر سابق
  document.getElementById('print-root')?.remove()

  const sheet = el.querySelector('.print-sheet') ?? el
  const root = document.createElement('div')
  root.id = 'print-root'
  root.innerHTML = sheet.outerHTML
  document.body.appendChild(root)

  const cleanup = () => {
    root.remove()
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)
  window.print()
  // أمان إضافي إن لم يُطلق afterprint
  window.setTimeout(() => root.remove(), 3000)
}
