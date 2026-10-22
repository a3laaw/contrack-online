// Task 85 — تحويل المخطط لنظام SaaS: Company + company_id على الجداول التشغيلية + قيود فريدة مركّبة
// يُشغَّل مرة واحدة: bun scripts/tenant-schema.ts  (يعدل prisma/schema.prisma — راجع diff قبل db:push)
import fs from "fs";

const SRC = "prisma/schema.prisma";
let s = fs.readFileSync(SRC, "utf8");

const TENANT = [
  "TransactionParticipant", "StageMove", "NumberSequence", "Customer", "Contract",
  "ContractStage", "BoqItem", "PaymentPlanItem", "Voucher", "Project",
  "Quotation", "QuotationItem", "VoucherPaymentLink", "Addendum", "AddendumItem",
  "Claim", "Subcontractor", "SubContract", "SubContractItem", "SubPaymentPlanItem",
  "SubPaymentSource", "ContractType", "TypePaymentTemplate", "TypePaymentStage", "TypeBundleComponent",
  "ContractComponent", "EntityBackup", "WorkflowStage", "ContractScope", "Setting",
  "PaymentMethod", "ExpenseAccount", "ContractGroup", "ContractGroupItem", "Invoice",
  "Employee", "Task", "VisitStaff", "Visit", "Comment",
  "ContractAttachment", "GatewayProfile", "GatewayOp", "BankLine", "OtherCompanyTransfer",
  "TransferOpAlloc", "OtherCompanyOpening", "GatewayFeeVoucher", "MatchAlias", "JournalEntry",
  "ContractEvent", "FormCategory", "FormTemplate", "FormField", "FormDocument",
  "StageNote", "TxMessage",
];

// الاستثناءات (جداول عامة بلا company_id): User (له companyId عضوية), UserPermission, AppNotification,
// FeatureFlag, AuditLog, PurgeAudit, DismissedAlert, Company نفسه

// 1) نموذج Company قبل User
if (!s.includes("model Company {")) {
  const companyModel = `// ==================== SaaS — الشركات (Task 85) ====================
// فصل بيانات الشركات: الجداول التشغيلية تحمل company_id (الافتراضي 1 = الشركة الرئيسية).
// الفصل التطبيقي عبر غلاف Prisma في src/lib/db.ts — بلا علاقات FK على الجداول التشغيلية عمدًا.
model Company {
  id        Int      @id @default(autoincrement())
  name      String
  shortName String   @default("") @map("short_name")
  isActive  Boolean  @default(true) @map("is_active")
  notes     String   @default("")
  createdAt DateTime @default(now()) @map("created_at")
  users     User[]

  @@map("companies")
}

`;
  s = s.replace("model User {", companyModel + "model User {");
}

// 2) User: عضوية الشركة مع علاقة
if (!s.includes("company      Company")) {
  s = s.replace(
    `model User {
  id           Int              @id @default(autoincrement())`,
    `model User {
  id           Int              @id @default(autoincrement())
  companyId    Int              @default(1) @map("company_id")
  company      Company          @relation(fields: [companyId], references: [id])`,
  );
}

// 3) حقن companyId كأول حقل في كل نموذج تشغيلي (Setting يُعالج خصيصًا لأن PK يتغير)
for (const m of TENANT) {
  if (m === "Setting") continue;
  const re = new RegExp(`(model ${m} \\{\\n)`);
  if (!re.test(s)) { console.error("MODEL NOT FOUND:", m); process.exit(1); }
  if (new RegExp(`model ${m} \\{\\n\\s*companyId`).test(s)) continue; // مضاف سلفًا
  s = s.replace(re, `$1  companyId Int @default(1) @map("company_id")\n`);
}

// Setting: استبدال PK id بـ companyId
s = s.replace(
  `model Setting {
  id                    Int      @id @default(1)`,
  `model Setting {
  companyId             Int      @id @map("company_id")`,
);

// 4) القيود الفريدة المفردة → مركّبة [companyId, field]
// (نموذج → حقل) — username يبقى فريدًا عالميًا (User جدول عام)
const CONVERT: Record<string, string> = {
  Customer: "customerCode",
  Contract: "contractNumber",
  Voucher: "voucherNumber",
  Quotation: "quotationNumber",
  Claim: "claimNumber",
  SubContract: "subCode",
  ContractGroup: "groupNumber",
  Invoice: "invoiceNumber",
  ContractType: "name",
  PaymentMethod: "name",
  Employee: "name",
  GatewayProfile: "name",
  FormCategory: "name",
};

// تقسيم لنماذج (كتل) والمعالجة سطرًا سطرًا
const lines = s.split("\n");
let currentModel: string | null = null;
const stripped: { model: string; field: string }[] = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const mOpen = line.match(/^model (\w+) \{/);
  if (mOpen) { currentModel = mOpen[1]; continue; }
  if (/^\}/.test(line)) { currentModel = null; continue; }
  if (!currentModel) continue;
  const m = line.match(/^(\s*)(\w+)\s+(String|Int)\s+(.*?)$/);
  if (!m) continue;
  const [, indent, field, , rest] = m;
  if (currentModel === "NumberSequence" && field === "name" && rest.trim() === "@id") {
    lines[i] = `${indent}name   String`;
    stripped.push({ model: currentModel, field });
    continue;
  }
  if (CONVERT[currentModel] === field && rest.includes("@unique")) {
    lines[i] = `${indent}${field} ${"String"} ${rest.replace("@unique", "").replace(/\s+/g, " ").trim()}`;
    stripped.push({ model: currentModel, field });
  }
}
s = lines.join("\n");

// إدراج @@unique / @@id المركّبة قبل سطر @@map لكل نموذج
const addBeforeMap = (model: string, decl: string) => {
  const re = new RegExp(`(model ${model} \\{[\\s\\S]*?)(\\n  @@map\\()`);
  if (!re.test(s)) { console.error("MAP NOT FOUND for", model); process.exit(1); }
  s = s.replace(re, `$1\n${decl}$2`);
};
for (const { model, field } of stripped) {
  if (model === "NumberSequence") {
    if (!s.includes("@@id([companyId, name])")) addBeforeMap("NumberSequence", "  @@id([companyId, name])");
  } else {
    const decl = `  @@unique([companyId, ${field}])`;
    // تجنب التكرار عند إعادة التشغيل
    const block = s.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`))?.[0] || "";
    if (!block.includes(decl)) addBeforeMap(model, decl);
  }
}

fs.writeFileSync(SRC, s);
console.log("✅ schema updated — companies:", (s.match(/model Company \{/) || []).length ? "added" : "missing",
  "| companyId fields:", (s.match(/@map\("company_id"\)/g) || []).length,
  "| compound uniques:", stripped.length);
