/**
 * مساعد تنزيل الملفات الثنائية (CSV/XLSX/PDF) — المرحلة 8.
 * يجلب النقطة مع التوكن/الكوكيز ثم ينزّل الرد كـblob بالاسم المعطى.
 * يرمي خطأ فيه status=401 ليتعامل معه المستدعي مع onAuthError.
 */

export interface BlobFetchInit {
  url: string;
  method?: "GET" | "POST";
  body?: unknown;
  token?: string;
  filename: string;
}

export async function fetchBlobDownload({ url, method = "GET", body, token, filename }: BlobFetchInit): Promise<void> {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
  if (res.status === 401) {
    const err = new Error("انتهت الجلسة — أعد تسجيل الدخول") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error || `فشل التصدير (${res.status})`);
  }
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}
