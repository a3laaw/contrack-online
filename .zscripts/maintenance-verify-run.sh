#!/bin/bash
# ============================================================
# maintenance-verify-run.sh — سيناريو التحقق الحي الآلي (docs/maintenance-design.md §8.5)
# المتطلبات: .env.local (روابط Supabase) + خادم dev على 3000 + مستخدم devcheck (sales-verify-setup.ts)
# المعرفات كلها ديناميكية من الردود — لا يفترض القاعدة فارغة التسلسلات (عدادات autoincrement محفوظة)
# الاستخدام: bash .zscripts/maintenance-verify-run.sh
#   ثم الفحوص: DATABASE_URL=$DIRECT_URL MAINT_VERIFY_COMPANY_ID=$COMPANY bun .zscripts/maintenance-verify-check.ts phase1|2|3
#   ثم التنظيف: DATABASE_URL=$DIRECT_URL MAINT_VERIFY_COMPANY_ID=$COMPANY bun .zscripts/maintenance-verify-cleanup.ts
# ============================================================
set -euo pipefail
BASE=http://localhost:3000
J='Content-Type: application/json'
today=$(date +%F)
start35=$(date -d "-35 days" +%F 2>/dev/null || date -v-35d +%F)
jqpy() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }

say() { echo -e "\n========== $1 =========="; }

# ===== 0) دخول المطور وإنشاء شركة التحقق =====
say "0) دخول المطور + شركة التحقق بموديولاتها"
TOKEN=$(curl -s -X POST $BASE/api/auth/login -H "$J" -d '{"username":"devcheck","password":"dev123456"}' | jqpy 'd["token"]')
AUTH="Authorization: Bearer $TOKEN"
COMPANY=$(curl -s -X POST $BASE/api/companies -H "$AUTH" -H "$J" \
  -d '{"name":"تحقق الصيانة","adminUsername":"maintadmin","adminPassword":"maint123456","adminFullName":"مدير التحقق","modules":["contracting","warehouses","maintenance"]}' | jqpy 'd["company"]["id"]')
echo "company: $COMPANY"
ATOKEN=$(curl -s -X POST $BASE/api/auth/login -H "$J" -d '{"username":"maintadmin","password":"maint123456"}' | jqpy 'd["token"]')
AAUTH="Authorization: Bearer $ATOKEN"
echo "maintadmin logged in"

# ===== 1) البذر: مستودع + صنف + عميل + فني =====
say "1) بذر المستودع والصنف والعميل والفني"
WH=$(curl -s -X POST $BASE/api/warehouses/warehouses -H "$AAUTH" -H "$J" -d '{"name":"المستودع الرئيسي"}' | jqpy 'd["warehouse"]["id"]')
ITEM=$(curl -s -X POST $BASE/api/warehouses/items -H "$AAUTH" -H "$J" -d '{"name":"فلتر تكييف","unit":"قطعة","minQty":10}' | jqpy 'd["item"]["id"]')
CUST=$(curl -s -X POST $BASE/api/customers -H "$AAUTH" -H "$J" -d '{"name":"عميل الصيانة — فيلا السالم"}' | jqpy 'd["customer"]["id"]')
TECH=$(curl -s -X POST $BASE/api/visits/staff -H "$AAUTH" -H "$J" -d '{"name":"فني التحقق"}' | jqpy 'd["staff"]["id"]')
echo "WH=$WH ITEM=$ITEM CUST=$CUST TECH=$TECH"

# ===== 2) إدخال نقدي 20 فلتر @1.500 = 30.000 =====
say "2) إدخال نقدي 20 @1.500 = 30.000 (قيد مدين 1160/دائن الصندوق)"
CASH=$(curl -s $BASE/api/accounts -H "$AAUTH" | jqpy '[a for a in d["accounts"] if a["code"]=="1111"][0]["id"]')
curl -s -X POST $BASE/api/warehouses/docs -H "$AAUTH" -H "$J" -d "{
  \"kind\":\"entry\",\"entrySource\":\"cash\",\"vdate\":\"$today\",\"warehouseId\":$WH,\"payAccountId\":$CASH,
  \"lines\":[{\"itemId\":$ITEM,\"qty\":20,\"snapUnitCost\":1.5}]}"
echo

# ===== 3) عقد صيانة 360.000 بدايته اليوم−35 =====
say "3) عقد صيانة دورية 360.000"
echo "--- فتح قسم عقود الصيانة أولًا (البذر المؤجل للنوع — د2) ---"
curl -s $BASE/api/maintenance/contracts -H "$AAUTH"
echo
CONTRACT=$(curl -s -X POST $BASE/api/contracts -H "$AAUTH" -H "$J" -d "{
  \"customerId\":$CUST,\"contractType\":\"صيانة دورية\",\"contractName\":\"صيانة دورية\",\"amount\":360,
  \"contractDate\":\"$start35\",\"startDate\":\"$start35\",\"description\":\"عقد صيانة — تحقق\"}" | jqpy 'd["contract"]["id"]')
echo "contract: $CONTRACT"

# ===== 4) خطة وقائية: فاصل 1 × 3 زيارات من اليوم−35 (الحدث الأول متأخر) =====
say "4) خطة وقائية فاصل 1 × 3 (أول حدث متأخر)"
curl -s -X POST $BASE/api/maintenance/plans -H "$AAUTH" -H "$J" -d "{
  \"contractId\":$CONTRACT,\"name\":\"زيارات شهرية\",\"intervalMonths\":1,\"occurrencesCount\":3,\"startDate\":\"$start35\"}"
echo
curl -s $BASE/api/maintenance/summary -H "$AAUTH"
echo

# ===== 5) MO-0001 من الحدث المتأخر (حدث 1) بفني =====
say "5) MO-0001 من الحدث المتأخر بفني"
OCC1=$(curl -s $BASE/api/maintenance/plans -H "$AAUTH" | jqpy 'sorted([o["id"] for p in d["plans"] for o in p["occurrences"]], key=lambda i: i)[0]')
MO1=$(curl -s -X POST $BASE/api/maintenance/orders -H "$AAUTH" -H "$J" -d "{
  \"title\":\"صيانة تكييف — زيارة دورية\",\"description\":\"تنظيف الفلاتر\",\"contractId\":$CONTRACT,
  \"occurrenceId\":$OCC1,\"technicianId\":$TECH,\"scheduledDate\":\"$start35\"}" | jqpy 'd["id"]')
echo "occurrence: $OCC1 — MO-0001 id: $MO1"

# ===== 6) صرف مواد 4 فلتر = 6.000 (لقطة خادمية 1.5 — قيد 5110 ببُعد العقد) =====
say "6) صرف مواد 4 فلتر = 6.000"
curl -s -X POST $BASE/api/maintenance/orders/$MO1/materials -H "$AAUTH" -H "$J" -d "{
  \"vdate\":\"$today\",\"warehouseId\":$WH,\"lines\":[{\"itemId\":$ITEM,\"qty\":4,\"note\":\"فلاتر مستهلكة\"}]}"
echo

# ===== 7) إنهاء MO-0001 + فاتورة الزيارة 120.000 (=360÷3 المقترح) =====
say "7) إنهاء MO-0001 + فاتورة الزيارة 120"
curl -s -X POST $BASE/api/maintenance/orders/$MO1/status -H "$AAUTH" -H "$J" -d '{"to":"منجزة","completedNote":"تمت الصيانة"}'
echo
curl -s -X POST $BASE/api/maintenance/orders/$MO1/invoice -H "$AAUTH" -H "$J" -d "{\"invoiceDate\":\"$today\"}"
echo

# ===== 8) سند قبض RV 120.000 نقديًا (يخصص FIFO عبر expenseCustomerId — نمط المبيعات) =====
say "8) سند قبض RV 120"
curl -s -X POST $BASE/api/vouchers -H "$AAUTH" -H "$J" -d "{
  \"vtype\":\"receipt\",\"amount\":120,\"vdate\":\"$today\",\"method\":\"نقداً\",\"account\":\"صندوق\",
  \"party\":\"عميل الصيانة — فيلا السالم\",\"expenseCustomerId\":$CUST,\"description\":\"سداد فاتورة الزيارة\"}"
echo

# ===== 9) MO-0002 مباشر + صرف 2 ثم رفض الإلغاء (له إذن) =====
say "9) MO-0002 + صرف 2 فلتر ثم محاولة إلغائه ⇒ رفض عربي يسمي الإذن"
MO2=$(curl -s -X POST $BASE/api/maintenance/orders -H "$AAUTH" -H "$J" -d "{
  \"title\":\"إصلاح طارئ\",\"contractId\":$CONTRACT,\"scheduledDate\":\"$today\"}" | jqpy 'd["id"]')
echo "MO-0002 id: $MO2"
curl -s -X POST $BASE/api/maintenance/orders/$MO2/materials -H "$AAUTH" -H "$J" -d "{
  \"vdate\":\"$today\",\"warehouseId\":$WH,\"lines\":[{\"itemId\":$ITEM,\"qty\":2}]}"
echo
echo "--- إلغاء MO-0002 (المتوقع: رفض يسمّي إذن WO-0002) ---"
curl -s -X POST $BASE/api/maintenance/orders/$MO2/status -H "$AAUTH" -H "$J" -d '{"to":"ملغاة","reason":"تجربة"}'
echo

# ===== 10) إلغاء إذن WO-0002 من المخازن (مدير — عكس القيد) ثم إلغاء الأمر ينجح =====
say "10) إلغاء WO-0002 من المخازن ثم إلغاء MO-0002 ينجح"
WO2=$(curl -s "$BASE/api/warehouses/docs?kind=issue" -H "$AAUTH" | jqpy '[x["id"] for x in d["docs"] if x["docNumber"]=="WO-0002"][0]')
curl -s -X POST $BASE/api/warehouses/docs/$WO2/cancel -H "$AAUTH" -H "$J" -d '{"reason":"إلغاء أمر العمل المرتبط"}'
echo
curl -s -X POST $BASE/api/maintenance/orders/$MO2/status -H "$AAUTH" -H "$J" -d '{"to":"ملغاة","reason":"أُلغي بعد سحب إذنه"}'
echo

# ===== 11) تعديل الخطة (الفاصل 2) — المنجز يبقى والمعلق يُعاد بمسافة شهرين =====
say "11) تعديل الخطة: الفاصل 2 (محفوظ 1 · مولّدان)"
PLAN=$(curl -s $BASE/api/maintenance/plans -H "$AAUTH" | jqpy '[p["id"] for p in d["plans"]][0]')
curl -s -X PATCH $BASE/api/maintenance/plans/$PLAN -H "$AAUTH" -H "$J" -d "{
  \"name\":\"زيارات شهرية\",\"intervalMonths\":2,\"occurrencesCount\":3,\"startDate\":\"$start35\"}"
echo

# ===== 12) تخطي أحد المواعيد الجديدة =====
say "12) تخطي الحدث المعلق الأول"
SK=$(curl -s $BASE/api/maintenance/plans -H "$AAUTH" | jqpy '[o["id"] for p in d["plans"] for o in p["occurrences"] if o["status"]=="مجدولة"][0]')
curl -s -X POST $BASE/api/maintenance/occurrences/$SK/skip -H "$AAUTH" -H "$J"
echo

# ===== 13) المؤشرات ونظرة العقد =====
say "13) المؤشرات النهائية + كتلة الصيانة بنظرة العقد"
curl -s $BASE/api/maintenance/summary -H "$AAUTH"
echo
curl -s $BASE/api/contracts/$CONTRACT/overview -H "$AAUTH" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(json.dumps({"materialsCost":d.get("materialsCost"),"maintenance":d.get("maintenance")},ensure_ascii=False))'
echo
say "انتهى السيناريو — شغّل فحوص المراحل الثلاثة ثم التنظيف:"
echo "  DATABASE_URL=\$DIRECT_URL MAINT_VERIFY_COMPANY_ID=$COMPANY bun .zscripts/maintenance-verify-check.ts phase1|phase2|phase3"
echo "  DATABASE_URL=\$DIRECT_URL MAINT_VERIFY_COMPANY_ID=$COMPANY bun .zscripts/maintenance-verify-cleanup.ts"
