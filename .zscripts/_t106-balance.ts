import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const main = async () => {
  const rows = await db.journalLine.groupBy({ by: ["companyId"], _sum: { debit: true, credit: true }, where: { entry: { status: "posted" } } });
  for (const r of rows) console.log(`co${r.companyId}: dr=${Number(r._sum.debit)} cr=${Number(r._sum.credit)} diff=${Math.round((Number(r._sum.debit) - Number(r._sum.credit)) * 1000) / 1000}`);
};
main().finally(() => db.$disconnect());
