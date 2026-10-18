# -*- coding: utf-8 -*-
"""منطق الأعمال الخاص بالعملاء."""
import sqlite3

from database.database import get_connection, DatabaseError
from database.models import Customer
from services.search_utils import normalized_search_clause


class ValidationError(Exception):
    """خطأ تحقق برسالة عربية تُعرض للمستخدم."""


def _norm_name(name: str) -> str:
    """تطبيع اسم العميل لمنع تكراره بين الأجهزة على القاعدة المشتركة."""
    import re
    text = (name or "").strip().lower()
    text = text.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")
    text = text.replace("ة", "ه").replace("ى", "ي")
    return re.sub(r"\s+", " ", text)


def _phone_digits(phone: str) -> str:
    """أرقام الهاتف فقط؛ يستخدم لمنع تكرار الهاتف حتى لو اختلف التنسيق."""
    return "".join(ch for ch in (phone or "") if ch.isdigit())


def _ensure_unique_customer_identity(name: str, phone: str, exclude_id: int | None = None) -> None:
    """منع تكرار اسم/هاتف العميل في قاعدة واحدة مشتركة.

    SQLite لا يطبّق تطبيع عربي/أرقام الهاتف، لذلك يتم الفحص في الخدمة.
    """
    n_name = _norm_name(name)
    n_phone = _phone_digits(phone)
    with get_connection() as conn:
        rows = conn.execute("SELECT id, name, phone, customer_code FROM customers").fetchall()
    for r in rows:
        if exclude_id and int(r["id"]) == int(exclude_id):
            continue
        if n_phone and _phone_digits(r["phone"] or "") == n_phone:
            raise ValidationError(
                f"رقم الهاتف مسجل من قبل للعميل: {r['name']} ({r['customer_code']}).")
        if n_name and _norm_name(r["name"] or "") == n_name:
            raise ValidationError(
                f"اسم العميل مسجل من قبل بنفس الصيغة تقريبًا: {r['name']} ({r['customer_code']}).")


def compose_address(governorate: str = "", area: str = "", block: str = "", plot: str = "", fallback: str = "") -> str:
    """العنوان الموحد للعرض من خانات: المحافظة - المنطقة - القطعة - القسيمة."""
    parts = [governorate, area,
             f"قطعة {block}" if str(block or "").strip() else "",
             f"قسيمة {plot}" if str(plot or "").strip() else ""]
    text = " - ".join(p.strip() for p in parts if str(p or "").strip())
    return text or (fallback or "").strip()


def _row_to_customer(row) -> Customer:
    keys = row.keys()
    gov = (row["address_governorate"] if "address_governorate" in keys else "") or ""
    area = (row["address_area"] if "address_area" in keys else "") or ""
    block = (row["address_block"] if "address_block" in keys else "") or ""
    plot = (row["address_plot"] if "address_plot" in keys else "") or ""
    address = compose_address(gov, area, block, plot, row["address"] or "")
    return Customer(
        id=row["id"], customer_code=row["customer_code"], name=row["name"],
        phone=row["phone"] or "", address=address,
        address_governorate=gov, address_area=area,
        address_block=block, address_plot=plot,
        email=row["email"] or "", notes=row["notes"] or "",
        folder_path=(row["folder_path"] if "folder_path" in keys else "") or "",
        created_at=row["created_at"],
        created_by=(row["created_by"] if "created_by" in keys else "") or "",
        updated_at=(row["updated_at"] if "updated_at" in keys else "") or "",
        updated_by=(row["updated_by"] if "updated_by" in keys else "") or "",
    )


def next_customer_code() -> str:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT customer_code FROM customers "
            "WHERE customer_code LIKE 'CUS-%' "
            "ORDER BY CAST(SUBSTR(customer_code, 5) AS INTEGER) DESC LIMIT 1"
        ).fetchone()
    if row:
        try:
            num = int(row["customer_code"].split("-")[1]) + 1
        except (IndexError, ValueError):
            num = count_customers() + 1
    else:
        num = 1
    return f"CUS-{num:04d}"


def _customers_where(search: str = "") -> tuple[str, tuple]:
    """جملة WHERE ومعاملاتها للبحث في العملاء (مشتركة بين العد والجلب)."""
    if not (search or "").strip():
        return "", ()
    clause, p = normalized_search_clause(
        ["name", "customer_code", "phone", "email", "address",
         "address_governorate", "address_area", "address_block",
         "address_plot"],
        search)
    return " WHERE " + clause, tuple(p)


def list_customers(search: str = "", limit: int | None = None,
                   offset: int = 0) -> list[Customer]:
    """قائمة العملاء.

    limit/offset اختياريان: عند تمريرهما يتم الترقيم **داخل قاعدة
    البيانات** فلا تُنقل كل السجلات لعرض صفحة واحدة (فرق كبير على
    القاعدة المشتركة). بدونهما يبقى السلوك كما كان تمامًا.
    """
    where, params = _customers_where(search)
    sql = "SELECT * FROM customers" + where + " ORDER BY id DESC"
    if limit is not None:
        sql += " LIMIT ? OFFSET ?"
        params = params + (int(limit), int(offset or 0))
    with get_connection() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_row_to_customer(r) for r in rows]


def count_customers_filtered(search: str = "") -> int:
    """عدد العملاء المطابقين للبحث — لحساب عدد الصفحات بلا جلب البيانات."""
    where, params = _customers_where(search)
    with get_connection() as conn:
        return int(conn.execute(
            "SELECT COUNT(*) FROM customers" + where, params).fetchone()[0])


def get_customer(customer_id: int) -> Customer | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM customers WHERE id = ?", (customer_id,)).fetchone()
    return _row_to_customer(row) if row else None


def count_customers() -> int:
    with get_connection() as conn:
        return conn.execute("SELECT COUNT(*) FROM customers").fetchone()[0]


def _validate(customer: Customer) -> None:
    if not customer.name.strip():
        raise ValidationError("اسم العميل مطلوب.")
    if not customer.customer_code.strip():
        raise ValidationError("رقم العميل مطلوب.")
    if not _phone_digits(customer.phone):
        raise ValidationError("رقم الهاتف مطلوب.")
    _ensure_unique_customer_identity(customer.name, customer.phone,
                                     getattr(customer, "id", None))


def add_customer(customer: Customer) -> int:
    _validate(customer)
    from services import auth_service
    username = auth_service.current_username() or ""
    # في القاعدة المشتركة قد يفتح جهازان شاشة عميل بنفس الرقم؛ لو اصطدم الرقم
    # نعيد توليد رقم جديد ونحفظ تلقائيًا بدل فشل المستخدم بسبب السباق.
    for attempt in range(8):
        try:
            with get_connection() as conn:
                cur = conn.execute(
                    "INSERT INTO customers (customer_code, name, phone, address, "
                    "address_governorate, address_area, address_block, address_plot, "
                    "email, notes, folder_path, created_by) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (customer.customer_code.strip(), customer.name.strip(),
                     customer.phone.strip(), compose_address(
                         customer.address_governorate, customer.address_area,
                         customer.address_block, customer.address_plot,
                         customer.address),
                     customer.address_governorate.strip(), customer.address_area.strip(),
                     customer.address_block.strip(), customer.address_plot.strip(),
                     customer.email.strip(), customer.notes.strip(),
                     customer.folder_path.strip(), username),
                )
                new_id = cur.lastrowid
            try:
                from services import workflow_service as _wf
                _wf.start_for_customer(new_id)
            except Exception:
                pass
            return new_id
        except sqlite3.IntegrityError as exc:
            msg = str(exc).lower()
            if "customer_code" in msg and attempt < 7:
                customer.customer_code = next_customer_code()
                continue
            if "customer_code" in msg:
                raise ValidationError("رقم العميل مستخدم من قبل، اختر رقمًا آخر.") from exc
            raise ValidationError("بيانات العميل مكررة، راجع الاسم أو الهاتف.") from exc
        except sqlite3.Error as exc:
            raise DatabaseError(f"خطأ في قاعدة البيانات: {exc}") from exc
    raise ValidationError("تعذر حجز رقم عميل غير مكرر، حاول مرة أخرى.")

def update_customer(customer: Customer) -> None:
    _validate(customer)
    if not customer.id:
        raise ValidationError("لم يتم تحديد العميل.")
    from services import auth_service
    username = auth_service.current_username() or ""
    try:
        with get_connection() as conn:
            new_name = customer.name.strip()
            conn.execute(
                "UPDATE customers SET customer_code=?, name=?, phone=?, address=?, "
                "address_governorate=?, address_area=?, address_block=?, address_plot=?, "
                "email=?, notes=?, folder_path=?, "
                "updated_at=datetime('now','localtime'), updated_by=? "
                "WHERE id=?",
                (customer.customer_code.strip(), new_name,
                 customer.phone.strip(), compose_address(
                     customer.address_governorate, customer.address_area,
                     customer.address_block, customer.address_plot,
                     customer.address),
                 customer.address_governorate.strip(), customer.address_area.strip(),
                 customer.address_block.strip(), customer.address_plot.strip(),
                 customer.email.strip(), customer.notes.strip(),
                 customer.folder_path.strip(), username, customer.id),
            )
            # السندات تحفظ اسم الطرف نصيًا لأغراض الطباعة والبحث. عند تعديل
            # اسم العميل نزامن الاسم في سندات القبض/الصرف المرتبطة بمعرف
            # العميل أو بعقوده حتى لا تبقى شاشة السندات تعرض الاسم القديم.
            conn.execute(
                "UPDATE vouchers SET party=? "
                "WHERE party_type='customer' AND party_id=?",
                (new_name, customer.id))
            conn.execute(
                "UPDATE vouchers SET party=? "
                "WHERE vtype='receipt' AND contract_id IN "
                "(SELECT id FROM contracts WHERE customer_id=?)",
                (new_name, customer.id))
    except sqlite3.IntegrityError as exc:
        raise ValidationError("رقم العميل مستخدم من قبل، اختر رقمًا آخر.") from exc
    except sqlite3.Error as exc:
        raise DatabaseError(f"خطأ في قاعدة البيانات: {exc}") from exc


def customer_links(customer_id: int) -> tuple[int, int]:
    """عدد العقود والفواتير المرتبطة بالعميل."""
    with get_connection() as conn:
        contracts = conn.execute(
            "SELECT COUNT(*) FROM contracts WHERE customer_id=?", (customer_id,)
        ).fetchone()[0]
        invoices = conn.execute(
            "SELECT COUNT(*) FROM invoices WHERE customer_id=?", (customer_id,)
        ).fetchone()[0]
    return contracts, invoices


def delete_customer(customer_id: int) -> None:
    contracts, invoices = customer_links(customer_id)
    if contracts or invoices:
        raise ValidationError(
            f"لا يمكن حذف العميل لأنه مرتبط بـ {contracts} عقد و {invoices} فاتورة.\n"
            "احذف العقود والفواتير المرتبطة أولاً."
        )
    try:
        with get_connection() as conn:
            conn.execute("DELETE FROM customers WHERE id=?", (customer_id,))
    except sqlite3.Error as exc:
        raise DatabaseError(f"خطأ في قاعدة البيانات: {exc}") from exc
