# -*- coding: utf-8 -*-
"""حفظ تفضيلات الواجهة: آخر ترتيب/فلتر لكل شاشة."""
import json

from database.database import get_connection


def _load_all() -> dict:
    with get_connection() as conn:
        try:
            row = conn.execute("SELECT ui_prefs FROM settings WHERE id=1").fetchone()
            return json.loads(row[0] or "{}") if row else {}
        except Exception:
            return {}


def get_pref(key: str, default=None):
    return _load_all().get(key, default)


def set_pref(key: str, value) -> None:
    prefs = _load_all()
    prefs[key] = value
    try:
        with get_connection() as conn:
            conn.execute("UPDATE settings SET ui_prefs=? WHERE id=1",
                         (json.dumps(prefs, ensure_ascii=False),))
    except Exception:
        pass
