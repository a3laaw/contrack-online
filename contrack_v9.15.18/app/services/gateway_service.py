# -*- coding: utf-8 -*-
"""مطابقة تسوية بوابة الدفع مع سندات القبض.

القاعدة (حسب طلب العميل): نبحث في عملائنا فقط برقم الهاتف والمبلغ —
ما يطابق فهو لشركتنا، وما لا يظهر معنا فهو للشركة الأخرى.
"""
import re
from datetime import date, datetime

from database.database import get_connection

# عناوين الأعمدة المقبولة في ملف التسوية (مرن — أي بوابة)
PHONE_KEYS = ("هاتف", "جوال", "موبايل", "تليفون", "رقم الهاتف", "رقم",
              "phone", "mobile", "msisdn", "tel", "هاتف العميل")
AMOUNT_KEYS = ("مبلغ", "المبلغ", "amount", "value", "القيمة", "الصافي",
               "net", "total")
DATE_KEYS = ("تاريخ", "التاريخ", "date", "يوم", "تاريخ التسوية",
             "settlement")
REF_KEYS = ("مرجع", "المرجع", "ref", "reference", "رقم العملية",
            "tran", "عملية", "id")
# V4.9: اسم العميل (بديل الهوية عند غياب الهاتف — Hesabe) + حالة الدفع
CUSTOMER_KEYS = ("customer name", "اسم العميل", "customer", "العميل")
# V4.11: بيان العملية (قد يذكر رقم العقد)
DESCR_KEYS = ("description", "البيان", "بيان", "details", "التفاصيل")
STATUS_SKIP_KEYS = ("sms",)  # أعمدة حالة تُتجاهل (حالة الرسائل…)
# V4.25: تاريخ الدفع (Updated) · تاريخ الإنشاء · توكن العملية (سجل)
UPDATED_KEYS = ("updated", "تحديث", "الدفع")
CREATED_KEYS = ("created", "الإنشاء", "انشاء")
TOKEN_KEYS = ("transaction token", "token", "التوكن")
# V4.24: المعلق يُحفظ (غير محوَّل) · الملغى يُعلَّم · الفاشل يُستبعد
PENDING_PATTERNS = ("not paid", "unpaid", "pending", "غير مدفوع",
                    "قيد", "بانتظار")
CANCELLED_PATTERNS = ("cancel", "void", "refund", "ملغ")
UNPAID_PATTERNS = ("failed", "fail", "expire", "فاشل",
                   "منته", "مرفوض")

STATUS_MINE = "mine"      # شركتنا — مطابق
STATUS_DIFF = "diff"      # (قديم) فرق مطابقة — يُقرأ كـ«غير مصنّف»
STATUS_OTHER = "other"    # شركة أخرى
STATUS_UNMARKED = "unmarked"  # غير مصنّف — بانتظار قرار المستخدم

STATUS_LABEL = {STATUS_MINE: "✅ شركتنا",
                STATUS_DIFF: "⚪ غير مصنّف",
                STATUS_OTHER: "🏢 شركة أخرى",
                STATUS_UNMARKED: "⚪ غير مصنّف"}

WINDOW_DAYS = 5  # نافذة التسوية (T+1 عادة · الخميس←الأحد T+4)
NAME_WINDOW_DAYS = 3  # V4.11: نافذة المطابقة بالاسم (قاعدة المستخدم)


def normalize_phone(raw) -> str:
    """أرقام فقط بلا أصفار بادئة — للمقارنة المرنة."""
    digits = re.sub(r"\D", "", str(raw or ""))
    return digits.lstrip("0")


def canon_phone(raw) -> str:
    """الصيغة الموحدة للروابط: تجريد رمز الكويت 965 (جوال/أرضي)."""
    d = normalize_phone(raw)
    if len(d) == 11 and d.startswith("965"):
        return d[3:]
    if len(d) == 9 and d.startswith("965") and d[3] in "234":
        return d[3:]
    return d


def phones_match(a: str, b: str) -> bool:
    """تطابق إذا تساويا أو احتوى أحدهما الآخر (تجاهل رمز الدولة)."""
    na, nb = normalize_phone(a), normalize_phone(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    if len(na) >= 7 and len(nb) >= 7:
        return na.endswith(nb) or nb.endswith(na)
    return False


def normalize_name(raw) -> str:
    """توحيد الاسم العربي/اللاتيني للمقارنة (تشكيل/ألف/تاء/مسافات)."""
    s = str(raw or "")
    s = re.sub(r"[ً-ٰٟ]", "", s)  # التشكيل
    s = s.replace("ـ", "")
    s = re.sub(r"[أإآ]", "ا", s)
    s = s.replace("ة", "ه").replace("ى", "ي")
    s = re.sub(r"\s+", " ", s).strip().casefold()
    return s


def names_match(a: str, b: str) -> bool:
    """تطابق الاسمين بعد التوحيد (3 أحرف فأكثر)."""
    na, nb = normalize_name(a), normalize_name(b)
    return len(na) >= 3 and na == nb


def names_similar(file_name: str, sys_name: str) -> bool:
    """تشابه جزئي: كلمات الأقصر كلها في الأطول (V4.11)."""
    a = normalize_name(file_name).split()
    b = normalize_name(sys_name).split()
    if not a or not b:
        return False
    short, long = (a, b) if len(a) <= len(b) else (b, a)
    return all(tok in long for tok in short)


def _norm_contract(text) -> str:
    return re.sub(r"[\s\-_/]+", "", str(text or "")).casefold()


def contract_hint(file_descr: str, file_ref: str,
                  contract_number: str) -> bool:
    """البيان/المرجع يذكر رقم العقد؟ (رابط مرجّح — لا يكفي وحده)."""
    cn = _norm_contract(contract_number)
    if len(cn) < 3:
        return False
    hay = _norm_contract(file_descr) + "|" + _norm_contract(file_ref)
    return cn in hay


def _word_set(text) -> set:
    """كلمات مهمة: توحيد عربي + بلا ترقيم + 3 أحرف فأكثر + بلا (ال)."""
    s = re.sub(r"[^\w\s]", " ", normalize_name(text))
    words = set()
    for tok in s.split():
        if tok.startswith("ال") and len(tok) > 4:
            tok = tok[2:]
        if len(tok) >= 3:
            words.add(tok)
    return words


def text_hint(file_descr: str, file_ref: str, voucher_descr: str,
              contract_name: str, contract_descr: str) -> bool:
    """كلمة مشتركة بين وصف حسابي و(بيان السند/اسم ووصف العقد)؟ (V4.12)"""
    hesabe = _word_set(file_descr) | _word_set(file_ref)
    if not hesabe:
        return False
    system = (_word_set(voucher_descr) | _word_set(contract_name)
              | _word_set(contract_descr))
    return bool(hesabe & system)


def _date_gap(vdate: str, sdate: str) -> int:
    """فرق الأيام مطلقًا — 999 عند غياب أحدهما."""
    try:
        if not vdate or not sdate:
            return 999
        return abs((date.fromisoformat(sdate[:10])
                    - date.fromisoformat(vdate[:10])).days)
    except ValueError:
        return 999


def is_unpaid_status(value) -> bool:
    """قيمة حالة نهائية فاشلة (تُستبعد من التسوية)."""
    v = str(value or "").strip().lower()
    return any(p in v for p in UNPAID_PATTERNS)


def paid_state_of(value) -> int | None:
    """حالة تحصيل البوابة: 1 محوَّلة · 0 معلقة · 2 ملغاة · -1 فاشلة.

    None = قيمة غير معروفة (يُحفظ الصف بلا معلومة).
    """
    v = str(value or "").strip().lower()
    if any(p in v for p in CANCELLED_PATTERNS):
        return 2
    if any(p in v for p in UNPAID_PATTERNS):
        return -1
    if not v or any(p in v for p in PENDING_PATTERNS):
        return 0
    if "paid" in v or "success" in v or "ناجح" in v or "مدفوع" in v:
        return 1
    return None


def _match_key(header: str, keys: tuple) -> bool:
    h = (header or "").strip().lower()
    return any(k in h for k in keys)


def _prefer(cands: list[tuple], keys: tuple) -> int | None:
    """أول مرشح لأعلى كلمة تفضيل (بالترتيب)، وإلا الأول."""
    if not cands:
        return None
    for k in keys:
        for i, hh in cands:
            if k in (hh or "").strip().lower():
                return i
    return cands[0][0]


def detect_columns(headers: list) -> dict | None:
    """اكتشاف الأعمدة — الأولوية لتاريخ الدفع ومرجع الفاتورة (V4.9)."""
    found: dict = {}
    date_cands: list[tuple] = []
    ref_cands: list[tuple] = []
    for i, h in enumerate(headers):
        hh = str(h or "")
        if "phone" not in found and _match_key(hh, PHONE_KEYS):
            found["phone"] = i
        elif "amount" not in found and _match_key(hh, AMOUNT_KEYS):
            found["amount"] = i
        elif ("status" not in found
                and _match_key(hh, ("invoice status", "payment status",
                                    "status", "الحالة"))
                and not _match_key(hh, STATUS_SKIP_KEYS)):
            found["status"] = i
        elif "customer" not in found and _match_key(hh, CUSTOMER_KEYS):
            found["customer"] = i
        elif "descr" not in found and _match_key(hh, DESCR_KEYS):
            found["descr"] = i
        elif "token" not in found and _match_key(hh, TOKEN_KEYS):
            found["token"] = i
        elif "updated" not in found and _match_key(hh, UPDATED_KEYS):
            found["updated"] = i
            date_cands.append((i, hh))
        elif "created" not in found and _match_key(hh, CREATED_KEYS):
            found["created"] = i
            date_cands.append((i, hh))
        elif _match_key(hh, DATE_KEYS):
            date_cands.append((i, hh))
        elif _match_key(hh, REF_KEYS + ("invoice", "number")):
            ref_cands.append((i, hh))
    _d = _prefer(date_cands, ("transaction date", "transaction", "trans",
                              "payment", "الدفع", "العملية"))
    if _d is not None:
        found["date"] = _d
        found["txn_date"] = _d
        for _i, _hh in date_cands:
            if _i != _d:
                found["date_fallback"] = _i
                break
    _r = _prefer(ref_cands, ("invoice number", "invoice", "الفاتورة"))
    if _r is not None:
        found["ref"] = _r
    if "phone" not in found or "amount" not in found:
        return None
    return found


_EN_MONTHS = {"jan": "01", "feb": "02", "mar": "03", "apr": "04",
              "may": "05", "jun": "06", "jul": "07", "aug": "08",
              "sep": "09", "sept": "09", "oct": "10", "nov": "11",
              "dec": "12"}


def parse_date(value) -> str:
    """تاريخ مرن ← yyyy-MM-dd أو '' (يدعم Hesabe: '26-Sep-2026 …)."""
    if value is None or value == "":
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    s = str(value).strip().strip("'\"").strip()
    token = re.split(r"[ T,]", s, maxsplit=1)[0].strip("'\"")
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d",
                "%d.%m.%Y"):
        try:
            return datetime.strptime(token, fmt).date().isoformat()
        except ValueError:
            continue
    m = re.match(r"(\d{1,2})-([A-Za-z]+)-(\d{2,4})$", token)
    if m:
        mon = _EN_MONTHS.get(m.group(2).lower()[:4]
                             if m.group(2).lower().startswith("sept")
                             else m.group(2).lower()[:3], "")
        day = int(m.group(1))
        if mon and 1 <= day <= 31:
            yy = m.group(3)
            yy = ("20" + yy) if len(yy) == 2 else yy
            return f"{yy}-{mon}-{day:02d}"
    m = re.match(r"(\d{4})(\d{2})(\d{2})$", re.sub(r"\D", "", token))
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    return ""


def parse_amount(value) -> float:
    try:
        return round(float(str(value).replace(",", "").strip() or 0), 3)
    except (ValueError, TypeError):
        return 0.0


_LAST_INFO: dict = {}


def last_read_info() -> dict:
    """إحصاءات آخر قراءة: المستبعد/بلا تاريخ/الأعمدة (لقائمة التحقق)."""
    return dict(_LAST_INFO)


def _extract_rows(matrix: list) -> list[dict]:
    """مصفوفة خام ← صفوف تسوية (تخطي غير المدفوع) + تعبئة الإحصاءات."""
    global _LAST_INFO
    if not matrix:
        raise ValueError("الملف فارغ.")
    header_idx = 0
    cols = None
    for i, r in enumerate(matrix[:5]):
        cols = detect_columns([c for c in (r or [])])
        if cols:
            header_idx = i
            break
    if not cols:
        raise ValueError("تعذر إيجاد عمودي الهاتف والمبلغ في أول 5 صفوف.")
    out = []
    skipped = 0
    for n, r in enumerate(matrix[header_idx + 1:], header_idx + 2):
        if not r:
            continue
        r = list(r) + [""] * (max(cols.values()) + 1 - len(list(r)))
        _gw: int | None = None
        if "status" in cols:
            _gw = paid_state_of(r[cols["status"]])
            if _gw is not None and _gw < 0:
                skipped += 1
                continue
        phone = str(r[cols["phone"]] or "").strip()
        amount = parse_amount(r[cols["amount"]])
        if not phone and amount <= 0:
            continue
        _dt = parse_date(r[cols["date"]]) if "date" in cols else ""
        if not _dt and "date_fallback" in cols:
            _dt = parse_date(r[cols["date_fallback"]])
        if _gw == 1 and "updated" in cols:
            _up = parse_date(r[cols["updated"]])
            if _up:
                _dt = _up
        elif _gw == 0 and "created" in cols:
            _cr = parse_date(r[cols["created"]])
            if _cr:
                _dt = _cr
        _gw_date = ""
        if _gw == 1 and "txn_date" in cols:
            _gw_date = parse_date(r[cols["txn_date"]])
        out.append({
            "phone": phone,
            "amount": amount,
            "date": _dt,
            "ref": (str(r[cols["ref"]] or "").strip().strip("'\"")
                    if "ref" in cols else ""),
            "customer": (str(r[cols["customer"]] or "").strip()
                         if "customer" in cols else ""),
            "descr": (str(r[cols["descr"]] or "").strip()
                      if "descr" in cols else ""),
            "row_no": n,
            "gw_paid": _gw,
            "gw_paid_date": _gw_date,
            "gw_token": (str(r[cols["token"]] or "").strip().strip("'\"")
                         if "token" in cols else ""),
        })
    _LAST_INFO = {"total": len(out), "skipped_unpaid": skipped,
                  "dateless": sum(1 for x in out if not x["date"]),
                  "no_identity": sum(1 for x in out
                                     if not x["phone"] and not x["customer"]),
                  "no_phone": sum(1 for x in out if not x["phone"]),
                  "has_date_col": "date" in cols,
                  "has_customer_col": "customer" in cols,
                  "has_status_col": "status" in cols,
                  "has_paid_col": "status" in cols}
    return out


def read_settlement_excel(path: str) -> list[dict]:
    """قراءة ملف التسوية: [{phone, amount, date, ref, customer, row_no}]."""
    from openpyxl import load_workbook
    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    wb.close()
    return _extract_rows(rows)


def read_settlement_csv(path: str) -> list[dict]:
    """قراءة ملف تسوية CSV (ترميز عربي/أجنبي)."""
    import csv
    try:
        with open(path, encoding="utf-8-sig", newline="") as f:
            matrix = list(csv.reader(f))
    except UnicodeDecodeError:
        with open(path, encoding="cp1256", newline="") as f:
            matrix = list(csv.reader(f))
    return _extract_rows(matrix)


def read_settlement_file(path: str) -> list[dict]:
    """قراءة ملف تسوية (xlsx/csv) حسب الامتداد."""
    if str(path or "").lower().endswith(".csv"):
        return read_settlement_csv(path)
    return read_settlement_excel(path)


def receipt_phones() -> list[dict]:
    """سندات القبض السارية مع هاتف العميل (للمطابقة)."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT v.id, v.voucher_number, v.vdate, v.amount, "
            "v.description AS voucher_descr, "
            "COALESCE(cu1.phone, cu2.phone, '') AS phone, "
            "COALESCE(cu1.name, cu2.name, '') AS customer, "
            "COALESCE(cu1.id, cu2.id, 0) AS customer_id, "
            "c.contract_number AS contract_number, "
            "COALESCE(c.contract_name, '') AS contract_name, "
            "COALESCE(c.description, '') AS contract_descr "
            "FROM vouchers v "
            "LEFT JOIN customers cu1 ON cu1.id = v.party_id "
            "AND v.party_type = 'customer' "
            "LEFT JOIN contracts c ON c.id = v.contract_id "
            "LEFT JOIN customers cu2 ON cu2.id = c.customer_id "
            "WHERE v.vtype = 'receipt' AND COALESCE(v.cancelled, 0) = 0 "
            "ORDER BY v.vdate, v.id").fetchall()
    return [dict(r) for r in rows]


def _within_window(receipt_date: str, settle_date: str,
                   window: int = WINDOW_DAYS) -> bool:
    if not receipt_date or not settle_date:
        return True
    try:
        d1 = date.fromisoformat(receipt_date[:10])
        d2 = date.fromisoformat(settle_date[:10])
        return abs((d2 - d1).days) <= window
    except ValueError:
        return True


# ---------- الروابط اليدوية المحفوظة (V4.11) ----------
def ensure_alias_table() -> None:
    with get_connection() as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS match_aliases ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "file_phone TEXT DEFAULT '', file_name TEXT DEFAULT '', "
            "customer_id INTEGER DEFAULT 0, "
            "created_at TEXT DEFAULT (datetime('now','localtime')))")
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_match_aliases ON "
            "match_aliases(file_phone, file_name)")


def save_alias(file_phone: str, file_name: str, customer_id: int) -> None:
    """حفظ رابط يدوي: هوية الملف ← عميل النظام (يتعلمها للملفات القادمة)."""
    if not int(customer_id or 0):
        raise ValueError("اختر سندًا بعميل صحيح.")
    ensure_alias_table()
    with get_connection() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO match_aliases "
            "(file_phone, file_name, customer_id) VALUES (?, ?, ?)",
            (canon_phone(file_phone), normalize_name(file_name),
             int(customer_id)))


def delete_alias(file_phone: str, file_name: str) -> None:
    ensure_alias_table()
    with get_connection() as conn:
        conn.execute("DELETE FROM match_aliases WHERE file_phone=? "
                     "AND file_name=?",
                     (canon_phone(file_phone),
                      normalize_name(file_name)))


def _alias_rows() -> list[tuple]:
    ensure_alias_table()
    with get_connection() as conn:
        return [(x[0] or "", x[1] or "", int(x[2] or 0))
                for x in conn.execute(
                    "SELECT file_phone, file_name, customer_id "
                    "FROM match_aliases").fetchall()]


def _alias_hit(rows: list[tuple], fp: str, fn: str) -> int:
    """عميل الرابط المحفوظ: اسم دقيق + هاتف (دقيق أو لاحقة ≥7)."""
    if not fn:
        return 0
    for sp, sn, cid in rows:
        if sn != fn or not sp or not fp:
            continue
        if sp == fp or (len(sp) >= 7 and len(fp) >= 7
                        and (sp.endswith(fp) or fp.endswith(sp))):
            return cid
    return 0


def find_alias(file_phone: str, file_name: str) -> dict | None:
    cid = _alias_hit(_alias_rows(), canon_phone(file_phone),
                     normalize_name(file_name))
    return {"customer_id": cid} if cid else None


def link_row_manual(gateway: str, key: tuple, receipt_id: int) -> dict:
    """ربط يدوي: تحديث العملية المثبتة + حفظ الرابط — يرجع التفاصيل."""
    from services import settlement_service as _st
    _st.ensure_ops_table()
    ensure_alias_table()
    d, p, a, ref = key
    with get_connection() as conn:
        op = conn.execute(
            "SELECT id, phone, customer FROM gateway_ops "
            "WHERE gateway=? AND op_date=? AND phone=? "
            "AND ABS(amount-?)<0.0005 AND ref=?",
            (gateway, d, p, float(a), ref)).fetchone()
        if not op:
            raise ValueError("العملية غير مثبتة — أعد الاستيراد.")
        v = conn.execute(
            "SELECT v.voucher_number, COALESCE(cu1.name, cu2.name, '') AS cn, "
            "COALESCE(cu1.id, cu2.id, 0) AS cid "
            "FROM vouchers v LEFT JOIN customers cu1 ON cu1.id=v.party_id "
            "AND v.party_type='customer' "
            "LEFT JOIN contracts c ON c.id=v.contract_id "
            "LEFT JOIN customers cu2 ON cu2.id=c.customer_id "
            "WHERE v.id=? AND v.vtype='receipt' "
            "AND COALESCE(v.cancelled,0)=0", (int(receipt_id),)).fetchone()
        if not v or not v["cid"]:
            raise ValueError("السند غير صالح أو بلا عميل.")
        conn.execute("UPDATE gateway_ops SET status='mine', receipt_no=? "
                     "WHERE id=?", (v["voucher_number"], op["id"]))
    save_alias(op["phone"] or "", op["customer"] or "", int(v["cid"]))
    return {"voucher_number": v["voucher_number"], "customer": v["cn"]}


def delete_alias_phone(file_phone: str) -> None:
    """حذف كل الروابط المحفوظة لهاتف ملف (احتياط الفك)."""
    ensure_alias_table()
    with get_connection() as conn:
        conn.execute("DELETE FROM match_aliases WHERE file_phone=?",
                     (canon_phone(file_phone),))


def unlink_row_manual(gateway: str, key: tuple) -> None:
    """فك رابط يدوي: إعادة العملية للأخرى + حذف الرابط المحفوظ."""
    from services import settlement_service as _st
    _st.ensure_ops_table()
    ensure_alias_table()
    d, p, a, ref = key
    with get_connection() as conn:
        op = conn.execute(
            "SELECT id, phone, customer FROM gateway_ops "
            "WHERE gateway=? AND op_date=? AND phone=? "
            "AND ABS(amount-?)<0.0005 AND ref=?",
            (gateway, d, p, float(a), ref)).fetchone()
        if not op:
            delete_alias_phone(p)
            return
        conn.execute("UPDATE gateway_ops SET status='other', receipt_no='' "
                     "WHERE id=?", (op["id"],))
    delete_alias(op["phone"] or "", (op["customer"] or ""))


def candidate_receipts(amount: float | None = None, query: str = "") -> list[dict]:
    """سندات قبض مرشحة للربط اليدوي (فلترة اختيارية)."""
    out = []
    q = (query or "").strip().casefold()
    for r in receipt_phones():
        if amount is not None and abs(float(r["amount"] or 0) - amount) > 0.001:
            continue
        if q:
            hay = " ".join(str(r.get(k) or "") for k in (
                "voucher_number", "customer", "phone")).casefold()
            if q not in hay:
                continue
        out.append(r)
    return out


def match_settlement(rows: list[dict],
                     window_days: int = WINDOW_DAYS) -> list[dict]:
    """مطابقة كل صف: هوية (هاتف أو اسم) + مبلغ + نافذة تاريخ + سبب."""
    receipts = receipt_phones()
    # فهرس الهواتف لتسريع البحث (الأسماء تُقارن مباشرة للجزئي)
    by_phone: dict[str, list] = {}
    for r in receipts:
        np = normalize_phone(r.get("phone"))
        if np:
            by_phone.setdefault(np, []).append(r)
    # الروابط اليدوية المحفوظة: (هاتف، اسم) ← عميل
    aliases = _alias_rows()
    # عملاؤنا (حتى بلا سندات — لكشف "عميلنا بلا سند")
    with get_connection() as conn:
        _ours = [(normalize_phone(x[0]), normalize_name(x[1]),
                  (x[1] or "").strip()) for x in conn.execute(
                      "SELECT phone, name FROM customers").fetchall()]

    def _our_customer(phone: str, name: str) -> str:
        for _np, _nn, _nm in _ours:
            if phone and _np and phones_match(_np, phone):
                return _nm
            if name and _nn and (names_match(_nn, name)
                                 or names_similar(name, _nm)):
                return _nm
        return ""

    out = []
    for row in rows:
        phone = (row.get("phone") or "").strip()
        fname = (row.get("customer") or "").strip()
        amount = float(row.get("amount") or 0)
        sdate = row.get("date") or ""
        item = {**row, "status": STATUS_OTHER, "receipt_no": "",
                "customer": fname, "via": "",
                "note": "لا يوجد عميل بهذه الهوية — للشركة الأخرى"}
        if not phone and not fname:
            item["note"] = "صف بلا هاتف ولا اسم — تعذر المطابقة"
            out.append(item)
            continue
        # مرشحون: هاتف/اسم/جزئي/محفوظ — مرتبون (تلميح عقد ← هوية ← الأقرب)
        fdescr = (row.get("descr") or "").strip()
        _hit: dict[int, list] = {}
        for np, lst in by_phone.items():
            if phone and phones_match(np, phone):
                for c in lst:
                    _hit.setdefault(c["id"], [c, False, False, False,
                                              False])[1] = True
        if fname:
            for c in receipts:
                _cn = c.get("customer")
                if not _cn:
                    continue
                _e = _hit.setdefault(c["id"], [c, False, False, False,
                                               False])
                if names_match(normalize_name(_cn), fname):
                    _e[2] = True
                elif names_similar(fname, _cn):
                    _e[3] = True
        _acid = _alias_hit(aliases, canon_phone(phone),
                           normalize_name(fname))
        if _acid:
            for c in receipts:
                if int(c.get("customer_id") or 0) == _acid:
                    _hit.setdefault(c["id"], [c, False, False, False,
                                              False])[4] = True
        cands = []
        for c, pok, exa, par, als in _hit.values():
            if exa and pok:
                _via, _rk = "الهاتف والاسم", 0
            elif pok:
                _via, _rk = "الهاتف", 1
            elif als:
                _via, _rk = "رابط محفوظ", 1
            elif exa:
                _via, _rk = "الاسم", 2
            elif par:
                _via, _rk = "اسم جزئي", 3
            else:
                continue
            _hint = contract_hint(fdescr, row.get("ref") or "",
                                  c.get("contract_number") or "")
            _whint = text_hint(fdescr, row.get("ref") or "",
                               c.get("voucher_descr") or "",
                               c.get("contract_name") or "",
                               c.get("contract_descr") or "")
            if _hint:
                _via = "عقد + " + _via
            elif _whint:
                _via = "وصف + " + _via
            _mw = window_days if (pok or als) else NAME_WINDOW_DAYS
            cands.append((0 if (_hint or _whint) else 1, _rk,
                          _date_gap(c.get("vdate") or "", sdate), _mw,
                          c["id"], c, _via))
        cands.sort(key=lambda x: (x[0], x[1], x[2], x[4]))
        # مطابق تام: مبلغ أساسي + نافذة (الأقوى والأقرب أولًا)
        best = None
        for _h, _rk, _gp, _mw, _i, c, _via in cands:
            if abs(float(c["amount"] or 0) - amount) > 0.001:
                continue
            if not _within_window(c.get("vdate") or "", sdate, _mw):
                continue
            best = (c, _via)
            break
        if best:
            c, _via = best
            item.update(status=STATUS_MINE, via=_via,
                        receipt_no=c["voucher_number"],
                        customer=(c.get("customer") or "").strip(),
                        note=(f"مطابق: {_via} + مبلغ"
                              + ("" if sdate else " (بلا تاريخ في الملف)")))
            out.append(item)
            continue
        # هوية صحيحة لكن المبلغ أو التاريخ؟ (لماذا؟)
        if cands:
            amt_ok = [t for t in cands
                      if abs(float(t[5]["amount"] or 0) - amount)
                      <= 0.001]
            if amt_ok:
                t0 = amt_ok[0]
                c0 = t0[5]
                _gap = ("بلا تاريخ" if t0[2] >= 9999
                        else f"الفرق {int(t0[2])} يومًا")
                item.update(
                    status=STATUS_DIFF, receipt_no=c0["voucher_number"],
                    customer=(c0.get("customer") or "").strip(),
                    note=(f"المبلغ يطابق سندنا {c0['voucher_number']} لكن "
                          f"التاريخ خارج النافذة (النافذة {t0[3]} أيام، "
                          f"{_gap}: سندنا {c0.get('vdate') or '؟'}"
                          f" والصف {sdate or 'بلا تاريخ'})"))
            else:
                c0 = cands[0][5]
                diff = round(amount - float(c0["amount"] or 0), 3)
                item.update(
                    status=STATUS_DIFF, receipt_no=c0["voucher_number"],
                    customer=(c0.get("customer") or "").strip(),
                    note=(f"الهوية لعميلنا لكن المبلغ مختلف: "
                          f"{amount:,.3f} ≠ سندنا "
                          f"{float(c0['amount']):,.3f} (فرق {diff:,.3f})"))
            out.append(item)
            continue
        cust = _our_customer(phone, fname)
        if cust:
            item.update(status=STATUS_DIFF, customer=cust,
                        note="الهوية لعميلنا لكن لا سند بهذا المبلغ")
            out.append(item)
            continue
        out.append(item)
    return out


def summary(matched: list[dict]) -> dict:
    """إجماليات كل تصنيف (عدد + مجموع) — القديم diff يُحسب غير مصنّف."""
    s = {STATUS_MINE: [0, 0.0], STATUS_OTHER: [0, 0.0],
         STATUS_UNMARKED: [0, 0.0]}
    for r in matched:
        st = r.get("status") or STATUS_UNMARKED
        if st not in s:
            st = STATUS_UNMARKED
        s[st][0] += 1
        s[st][1] += float(r.get("amount") or 0)
    total_n = len(matched)
    total_a = sum(float(r.get("amount") or 0) for r in matched)
    return {"mine": {"count": s[STATUS_MINE][0],
                     "amount": round(s[STATUS_MINE][1], 3)},
            "other": {"count": s[STATUS_OTHER][0],
                      "amount": round(s[STATUS_OTHER][1], 3)},
            "unmarked": {"count": s[STATUS_UNMARKED][0],
                         "amount": round(s[STATUS_UNMARKED][1], 3)},
            "total": {"count": total_n, "amount": round(total_a, 3)}}


def auto_classify(matched: list[dict]) -> list[dict]:
    """التصنيف التلقائي المبدئي: المطابق الواضح ← شركتنا، الباقي ←
    غير مصنّف (ملاحظة المطابقة تبقى تلميحًا مساعدًا)."""
    for r in matched:
        r["status"] = (STATUS_MINE if r.get("status") == STATUS_MINE
                       else STATUS_UNMARKED)
    return matched
