import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
const db = new PrismaClient();
const ser = (_k: string, v: unknown) => (typeof v === "bigint" ? String(v) : v);
const main = async () => {
  const [accounts, vouchers, entries, lines, vouchersRaw] = await Promise.all([
    db.account.findMany(),
    db.voucher.findMany(),
    db.journalEntry.findMany(),
    db.journalLine.findMany(),
    db.voucher.findMany(),
  ]);
  void vouchersRaw;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = `db/backups/task106-pre-dims-backfill-${stamp}.json`;
  fs.writeFileSync(file, JSON.stringify({ stamp, counts: { accounts: accounts.length, vouchers: vouchers.length, entries: entries.length, lines: lines.length }, accounts, vouchers, journalEntries: entries, journalLines: lines }, ser, 2));
  console.log("SAFETY DUMP:", file, "| lines:", lines.length, "| entries:", entries.length);
  await db.$disconnect();
};
main();
