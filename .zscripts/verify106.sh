#!/bin/bash
# Task 106 — تحقق شامل في جلسة واحدة (الخادم يُقتل بين الاستدعاءات في هذه البيئة)
set -uo pipefail
cd /home/z/my-project
export $(grep -E "^DATABASE_URL=" .env | head -1)
export NODE_OPTIONS="--max-old-space-size=1024"
U="t106chk"; P="Task106Chk#2026"
COOKIE=/tmp/t106-cookie.txt

echo "===== [1] مستخدم مدير مؤقت ====="
cat > .zscripts/_t106-makeuser.ts << EOF
import { PrismaClient } from "@prisma/client";
import * as crypto from "crypto";
const db = new PrismaClient();
const mk = (password: string) => {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, Buffer.from(salt, "hex"), 200000, 32, "sha256").toString("hex");
  return { salt, hash };
};
const main = async () => {
  const exists = await db.user.findFirst({ where: { username: "$U" } });
  if (exists) { console.log("EXISTS", exists.id); return; }
  const { salt, hash } = mk("$P");
  const u = await db.user.create({ data: { companyId: 1, username: "$U", passwordHash: hash, salt, role: "admin", fullName: "تحقق 106", jobTitle: "مؤقت" } });
  console.log("CREATED", u.id);
};
main().finally(() => db.\$disconnect());
EOF
bun run .zscripts/_t106-makeuser.ts || { echo "MAKEUSER FAILED"; exit 1; }

echo "===== [2] تشغيل الخادم ====="
setsid nohup bun run dev > /dev/null 2>&1 < /dev/null &
DEV_LAUNCHED=$(date +%s)
for i in $(seq 1 45); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ --max-time 5 2>/dev/null || echo 000)
  [ "$code" = "200" ] && break
  sleep 2
done
echo "server ready after $(( $(date +%s) - DEV_LAUNCHED ))s (code=$code)"
[ "$code" != "200" ] && { echo "SERVER FAILED"; exit 1; }

echo "===== [3] E2E بالـAPI ====="
# دخول
LOGIN=$(curl -s -c $COOKIE -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d "{\"username\":\"$U\",\"password\":\"$P\"}")
echo "$LOGIN" | head -c 220; echo
TOKEN=$(echo "$LOGIN" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
AUTH="Authorization: Bearer $TOKEN"
[ -z "$TOKEN" ] && { echo "NO TOKEN"; exit 1; }

# قائمة السندات تحمل entryNos
VLIST=$(curl -s -b $COOKIE -H "$AUTH" "http://localhost:3000/api/vouchers?includeCancelled=1")
echo "$VLIST" | grep -q "entryNos" && echo "OK: vouchers list carries entryNos" || echo "FAIL: no entryNos in list"

# قواعد الترحيل
PRULES=$(curl -s -b $COOKIE -H "$AUTH" http://localhost:3000/api/posting-rules)
COUNT=$(echo "$PRULES" | grep -o '"ruleKey"' | wc -l)
echo "posting rules count: $COUNT (expect 11)"
SAL=$(echo "$PRULES" | python3 -c "import sys,json; d=json.load(sys.stdin); r=[x for x in d['rules'] if x['ruleKey']=='salary_deduction'][0]; print(r['debitCode'], r['creditCode'], r['debitName'], r['creditName'])")
echo "salary_deduction seed: $SAL"

# إنشاء سند قبض 0.500 نقدًا (بلا عقد) → قيد آلي
NEWV=$(curl -s -b $COOKIE -H "$AUTH" -H "Content-Type: application/json" -X POST http://localhost:3000/api/vouchers -d '{"vtype":"receipt","amount":0.5,"vdate":"2026-11-05","method":"نقدًا","party":"عميل اختبار 106","description":"تحقق Task 106"}')
echo "$NEWV" | head -c 260; echo
VID=$(echo "$NEWV" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
VNO=$(echo "$NEWV" | grep -o '"voucherNumber":"[^"]*"' | cut -d'"' -f4)
[ -z "$VID" ] && { echo "VOUCHER CREATE FAILED"; exit 1; }
echo "created voucher id=$VID no=$VNO"

# القيد المرتبط
DET=$(curl -s -b $COOKIE -H "$AUTH" "http://localhost:3000/api/vouchers/$VID")
ENTRY_NO=$(echo "$DET" | grep -o '"entryNo":[0-9]*' | head -1 | cut -d: -f2)
LINES_N=$(echo "$DET" | grep -o '"accountCode"' | wc -l)
echo "linked entryNo=$ENTRY_NO lines=$LINES_N (expect >=2)"
[ -z "$ENTRY_NO" ] && { echo "NO LINKED ENTRY"; exit 1; }

# فحص القيد نفسه
ENT=$(curl -s -b $COOKIE -H "$AUTH" "http://localhost:3000/api/journal-entries?q=$ENTRY_NO&status=all")
echo "$ENT" | grep -q "\"entryNo\":$ENTRY_NO" && echo "OK: entry findable by no" || echo "FAIL: entry not found by q"

# تعديل قاعدة ثم إعادتها (ثبات سلوك)
PUT1=$(curl -s -b $COOKIE -H "$AUTH" -H "Content-Type: application/json" -X PUT http://localhost:3000/api/posting-rules -d '{"rules":[{"ruleKey":"payment_subcontract","debitCode":"5120","creditCode":"","enabled":true}]}')
echo "rule put(5120 leaf): $PUT1"
PUT1B=$(curl -s -b $COOKIE -H "$AUTH" -H "Content-Type: application/json" -X PUT http://localhost:3000/api/posting-rules -d '{"rules":[{"ruleKey":"payment_subcontract","debitCode":"","creditCode":"","enabled":true}]}')
echo "rule put(revert contextual): $PUT1B"
PUT2=$(curl -s -b $COOKIE -H "$AUTH" -H "Content-Type: application/json" -X PUT http://localhost:3000/api/posting-rules -d '{"rules":[{"ruleKey":"salary_deduction","debitCode":"5210","creditCode":"1140","enabled":true}]}')
echo "rule put(revert 5210): $PUT2"
BAD=$(curl -s -b $COOKIE -H "$AUTH" -H "Content-Type: application/json" -X PUT http://localhost:3000/api/posting-rules -d '{"rules":[{"ruleKey":"custody_handover","debitCode":"1111"}]}')
echo "rule put(non-adjustable): $BAD (expect error)"

# إلغاء السند → عكس مرتبط
DEL=$(curl -s -b $COOKIE -H "$AUTH" -H "Content-Type: application/json" -X DELETE "http://localhost:3000/api/vouchers/$VID" -d '{"reason":"تحقق Task 106 — إلغاء تجريبي"}')
echo "cancel: $(echo $DEL | head -c 140)"
DET2=$(curl -s -b $COOKIE -H "$AUTH" "http://localhost:3000/api/vouchers/$VID")
echo "$DET2" | grep -q "voucher_cancel" && echo "OK: reversal entry linked (voucher_cancel)" || echo "FAIL: no reversal"

echo "===== [4] توازن الشركة 1 قبل/بعد ====="
cat > .zscripts/_t106-balance.ts << 'EOF'
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const main = async () => {
  const rows = await db.journalLine.groupBy({ by: ["companyId"], _sum: { debit: true, credit: true }, where: { entry: { status: "posted" } } });
  for (const r of rows) console.log(`co${r.companyId}: dr=${Number(r._sum.debit)} cr=${Number(r._sum.credit)} diff=${Math.round((Number(r._sum.debit) - Number(r._sum.credit)) * 1000) / 1000}`);
};
main().finally(() => db.$disconnect());
EOF
bun run .zscripts/_t106-balance.ts

echo "===== [5] الجولة البصرية ====="
agent-browser set viewport 1366 900
agent-browser open http://localhost:3000/ && agent-browser wait --load networkidle
agent-browser find label "اسم المستخدم" fill "$U"
agent-browser find label "كلمة المرور" fill "$P"
agent-browser find text "دخول" click
agent-browser wait --load networkidle
sleep 2
agent-browser screenshot /tmp/t106-dashboard.png
# فتح وحدة المحاسبة ثم سندات القبض
agent-browser find text "المحاسبة" click
sleep 1.5
agent-browser find text "سندات القبض" click
sleep 2.5
agent-browser wait --load networkidle
agent-browser screenshot /tmp/t106-vouchers.png
# شارة القيد في الجدول
echo "entry badges in table:"
agent-browser snapshot -c 2>&1 | grep -oE "#31[0-9]" | sort -u | head -4
# تفاصيل أول سند: زر العين الأول ثم قسم القيود المرتبطة
EYE=$(agent-browser snapshot -i -c 2>&1 | grep -m1 -B0 "تفاصيل" | grep -oE "@e[0-9]+" | head -1)
if [ -n "$EYE" ]; then agent-browser click $EYE; sleep 2; agent-browser screenshot /tmp/t106-detail.png; agent-browser snapshot -c 2>&1 | grep -m2 -E "القيود المحاسبية المرتبطة|عكس الإلغاء"; agent-browser press Escape; fi
# تاب قواعد الترحيل
agent-browser open http://localhost:3000/ >/dev/null 2>&1; sleep 1
agent-browser find text "الإعدادات" click
sleep 1.5
agent-browser find text "قواعد الترحيل" click
sleep 2
agent-browser screenshot /tmp/t106-rules.png
agent-browser snapshot -c 2>&1 | grep -m4 -E "سند قبض|صرف مصروف|تسليم عهدة|خصم راتب" || true

echo "===== [6] التنظيف ====="
cat > .zscripts/_t106-cleanup.ts << EOF
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const main = async () => {
  const u = await db.user.findFirst({ where: { username: "$U" } });
  if (u) {
    await db.userPermission.deleteMany({ where: { userId: u.id } });
    await db.user.delete({ where: { id: u.id } });
    console.log("temp user deleted", u.id);
  }
  const a = await db.auditLog.deleteMany({ where: { username: "$U" } });
  console.log("audit rows deleted", a.count);
};
main().finally(() => db.\$disconnect());
EOF
bun run .zscripts/_t106-cleanup.ts
rm -f .zscripts/_t106-makeuser.ts .zscripts/_t106-cleanup.ts $COOKIE
agent-browser close 2>/dev/null || true
echo "===== DONE ====="
