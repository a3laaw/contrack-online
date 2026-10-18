// ============================================================
// GET /api/backup — تنزيل نسخة احتياطية كاملة (JSON) — للمدير
// - يبني dump كل جداول Postgres عبر backup-dump.ts (ترتيب طوبولوجي + manifest)
// - Content-Disposition: attachment ⇒ تنزيل مباشر من المتصفح
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, jsonError } from "@/lib/api-utils";
import { buildBackupDump, snapshotFileName } from "@/lib/backup-dump";

export async function GET(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  try {
    const dump = await buildBackupDump(db, guard.user.username);
    const filename = `contrack-${snapshotFileName("backup")}`; // contrack-backup-<stamp>.json
    return new NextResponse(JSON.stringify(dump), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير معروف";
    return jsonError(`تعذر إنشاء النسخة الاحتياطية: ${msg}`, 500);
  }
}
