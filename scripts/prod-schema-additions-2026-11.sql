-- ======================================================================
-- PROD SCHEMA ADDITIONS — 2026-11  (additive · safe · run ONCE)
-- Target : Supabase Postgres (production)
-- Source : prisma/schema.prisma (Prisma 6.11.1)
-- Scope  : exactly 3 additive changes —
--   [1] boq_items.planned_qty          (BoqItem.plannedQty,      schema ~L304)
--   [2] engineer_appointments (table)  (EngineerAppointment,     schema ~L1917)
--   [3] field_executions      (table)  (FieldExecution,          schema ~L1413)
--
-- DDL text mirrors the exact emit of
--   `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma`
-- (SERIAL ids · TEXT strings · TIMESTAMP(3) datetimes · DECIMAL(18,3) qty).
-- Referenced tables (contracts, boq_items, contract_attachments, engineers,
-- customers) already exist in production; nothing is dropped or altered
-- beyond the statements below, no data is read or modified.
-- Wrapped in ONE transaction: on any failure everything rolls back and
-- production is left untouched. Idempotency guards intentionally omitted.
-- NOT executed anywhere — apply manually via psql / Supabase SQL editor.
-- ======================================================================

BEGIN;

-- ----------------------------------------------------------------------
-- [1/3] boq_items — plannedQty Decimal @default(0) @map("planned_qty")
-- (emitted DECIMAL(18,3) per spec; matches FieldExecution.qty — note the
--  model currently lacks @db.Decimal(18, 3), which would diff as 65,30)
-- ----------------------------------------------------------------------
ALTER TABLE "boq_items" ADD COLUMN "planned_qty" DECIMAL(18,3) NOT NULL DEFAULT 0;

-- ----------------------------------------------------------------------
-- [2/3] engineer_appointments — رادار المواعيد
-- mirrors "visits" constraint style (@@unique date+slot+assignee)
-- ----------------------------------------------------------------------
-- CreateTable
CREATE TABLE "engineer_appointments" (
    "company_id" INTEGER NOT NULL DEFAULT 1,
    "id" SERIAL NOT NULL,
    "engineer_id" INTEGER NOT NULL,
    "appointment_date" TEXT NOT NULL,
    "hour_slot" TEXT NOT NULL,
    "customer_id" INTEGER,
    "contract_id" INTEGER,
    "note" TEXT NOT NULL DEFAULT '',
    "created_by" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engineer_appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex  @@index([engineerId, appointmentDate])
CREATE INDEX "engineer_appointments_engineer_id_appointment_date_idx" ON "engineer_appointments"("engineer_id", "appointment_date");

-- CreateIndex  @@unique([appointmentDate, hourSlot, engineerId]) — name truncated to 63 chars by Prisma
CREATE UNIQUE INDEX "engineer_appointments_appointment_date_hour_slot_engineer_i_key" ON "engineer_appointments"("appointment_date", "hour_slot", "engineer_id");

-- AddForeignKey  engineer onDelete: Cascade
ALTER TABLE "engineer_appointments" ADD CONSTRAINT "engineer_appointments_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "engineers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey  customer (optional relation, no onDelete → Prisma default SET NULL)
ALTER TABLE "engineer_appointments" ADD CONSTRAINT "engineer_appointments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey  contract (optional relation, no onDelete → Prisma default SET NULL)
ALTER TABLE "engineer_appointments" ADD CONSTRAINT "engineer_appointments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ----------------------------------------------------------------------
-- [3/3] field_executions — التنفيذ الميداني
-- ----------------------------------------------------------------------
-- CreateTable
CREATE TABLE "field_executions" (
    "company_id" INTEGER NOT NULL DEFAULT 1,
    "id" SERIAL NOT NULL,
    "contract_id" INTEGER NOT NULL,
    "boq_item_id" INTEGER NOT NULL,
    "execution_date" TEXT NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "documented" BOOLEAN NOT NULL DEFAULT false,
    "gps_lat" TEXT NOT NULL DEFAULT '',
    "gps_lng" TEXT NOT NULL DEFAULT '',
    "attachment_id" INTEGER,
    "note" TEXT NOT NULL DEFAULT '',
    "created_by" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex  @@index([contractId])
CREATE INDEX "field_executions_contract_id_idx" ON "field_executions"("contract_id");

-- CreateIndex  @@index([boqItemId, executionDate])
CREATE INDEX "field_executions_boq_item_id_execution_date_idx" ON "field_executions"("boq_item_id", "execution_date");

-- AddForeignKey  contract onDelete: Cascade
ALTER TABLE "field_executions" ADD CONSTRAINT "field_executions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey  boqItem (REQUIRED relation, no onDelete → Prisma default RESTRICT)
ALTER TABLE "field_executions" ADD CONSTRAINT "field_executions_boq_item_id_fkey" FOREIGN KEY ("boq_item_id") REFERENCES "boq_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey  attachment (optional relation, no onDelete → Prisma default SET NULL)
ALTER TABLE "field_executions" ADD CONSTRAINT "field_executions_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "contract_attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
