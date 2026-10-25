/**
 * اختبارات مدقق ملفات النسخ الاحتياطية (backup-parse):
 *   - قبول نسخة صحيحة (manifest + data) وإجمالي الصفوف
 *   - رفض: JSON تالف / ليس نسخة / بيانات غير مصفوفة
 *   - استخراج JSON من غلاف نصي (نوت باد) وسوار كود MD
 * التشغيل: bun test tests/backup-parse.test.ts
 */
import { describe, expect, test } from "bun:test";

import { parseSnapshotText, snapshotParseErrorMessage, snapshotRowsCount } from "@/lib/backup-parse";

const VALID_DUMP = {
  manifest: {
    app: "ConTrack Online",
    version: "V9.15.18-web",
    createdAt: "2026-02-01T09:00:00.000Z",
    generatedBy: "developer",
    tableCounts: { users: 2, contracts: 3, empty_table: 0 },
  },
  data: {
    users: [{ id: 1, username: "developer" }, { id: 2, username: "raheem" }],
    contracts: [{ id: 1 }, { id: 2 }, { id: 3 }],
    empty_table: [],
  },
};

describe("parseSnapshotText — تحقق بنية ملف النسخة الاحتياطية", () => {
  test("يقبل نسخة صحيحة ويعيد manifest وdata كما هي", () => {
    const s = parseSnapshotText(JSON.stringify(VALID_DUMP));
    expect(s.manifest.app).toBe("ConTrack Online");
    expect(s.manifest.generatedBy).toBe("developer");
    expect(s.manifest.tableCounts.users).toBe(2);
    expect(s.data.users).toHaveLength(2);
    expect(s.data.contracts).toHaveLength(3);
    expect(snapshotRowsCount(s)).toBe(5);
  });

  test("يقبل ملف نوت باد بملاحظة نصية قبل الـJSON", () => {
    const text = "النسخة الاحتياطية لنظام كونتراك — أُخذت يوم الأحد\n" + JSON.stringify(VALID_DUMP);
    const s = parseSnapshotText(text);
    expect(s.data.contracts).toHaveLength(3);
  });

  test("يقبل ملف MD بسوار كود ```json حول النسخة", () => {
    const text = "# نسخة احتياطية\n\n```json\n" + JSON.stringify(VALID_DUMP) + "\n```";
    const s = parseSnapshotText(text);
    expect(s.manifest.version).toBe("V9.15.18-web");
    expect(snapshotRowsCount(s)).toBe(5);
  });

  test("يرفض نصًا ليس JSON أصلًا بـINVALID_JSON", () => {
    expect(() => parseSnapshotText("هذا مجرد ملف نصي عادي بلا JSON")).toThrow("INVALID_JSON");
    expect(snapshotParseErrorMessage(new Error("INVALID_JSON"))).toContain("ليس نص JSON");
  });

  test("يرفض JSON بلا manifest أو data بـNOT_A_BACKUP", () => {
    expect(() => parseSnapshotText(JSON.stringify({ foo: 1 }))).toThrow("NOT_A_BACKUP");
    expect(() => parseSnapshotText(JSON.stringify({ manifest: { app: "x" } }))).toThrow("NOT_A_BACKUP");
    expect(() => parseSnapshotText(JSON.stringify({ data: {} }))).toThrow("NOT_A_BACKUP");
    expect(() => parseSnapshotText(JSON.stringify([1, 2, 3]))).toThrow("NOT_A_BACKUP");
    expect(() => parseSnapshotText("null")).toThrow("NOT_A_BACKUP");
    expect(snapshotParseErrorMessage(new Error("NOT_A_BACKUP"))).toContain("نسخة احتياطية صالحة");
  });

  test("يرفض data قيمها ليست مصفوفات بـBAD_DATA", () => {
    expect(() => parseSnapshotText(JSON.stringify({ manifest: {}, data: { users: { id: 1 } } }))).toThrow("BAD_DATA");
    expect(snapshotParseErrorMessage(new Error("BAD_DATA"))).toContain("مصفوفات");
  });

  test("يتغاضى عن غياب tableCounts (قواميس أقدم) ويعيد كائنًا فارغًا", () => {
    const s = parseSnapshotText(JSON.stringify({ manifest: { app: "x" }, data: { users: [] } }));
    expect(s.manifest.tableCounts).toEqual({});
    expect(snapshotRowsCount(s)).toBe(0);
  });

  test("يرفض JSON مبتور (قص أول { إلى آخر }) بـINVALID_JSON", () => {
    const broken = JSON.stringify(VALID_DUMP).slice(0, Math.floor(JSON.stringify(VALID_DUMP).length / 2));
    expect(() => parseSnapshotText(broken)).toThrow("INVALID_JSON");
  });
});
