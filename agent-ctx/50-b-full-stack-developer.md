# Task 50-b — استعادة سلفة ملغاة (advances restore, desktop V8.4 parity)

## Scope kept
- `src/lib/voucher-server.ts` — added `restoreVoucherTx` only (end of file, after `cancelVoucherTx`).
- `src/app/api/employees/advances/restore/route.ts` — new POST route.
- `src/components/contrack/AdvancesView.tsx` — restore button + `RestoreDialog` + types.
- Did NOT touch nav-structure / ConTrackApp / contract-groups. No git commits, no build, no dev-server changes.

## Server: restoreVoucherTx(tx, voucherId, username, reason="")
- Guards: `السند غير موجود` (404) → `السند غير ملغى` → `هذا الإجراء مخصص لسلف الموظفين.` (advanceEmployeeId only).
- Re-posts original journals (`sourceType:"voucher", sourceId` rows) with SAME debit/credit (not swapped), description `استعادة قيد السند {رقم}[ — {سبب}]`, entryDate `todayStr()`, copied contractId/subContractId, `sourceType:"voucher_restore"`. Net: original + voucher_cancel reversal + voucher_restore = original.
- Un-cancels: `cancelled:false, cancelReason:"", cancelledAt:""` (schema field is String @default("") — not nullable, so spec's `null` became `""`, matching cancelVoucherTx convention).
- Audit action «استعادة», reason fallback «استعادة سلفة موظف». Returns `{voucherNumber, amount}`.
- Fee children NOT auto-restored (desktop parity) — documented in JSDoc.

## API: POST /api/employees/advances/restore
- `authGuard(req, "screen_custody")` (advances page gate), body `{voucherId, reason?}`, `intOr` + «رقم السند مطلوب», `db.$transaction(restoreVoucherTx)`, VoucherError → `{error}` with its status, ok `{restored:true, voucherNumber, amount}`.
- GET not added: existing `GET /api/employees/advances?includeCancelled=1` ALREADY returns `cancelled, cancelReason, cancelledAt, voucherNumber, vdate, amount` (verified route.ts lines 29–61) — zero GET changes.

## UI: AdvancesView
- Button «♻️ استعادة سلفة» (Recycle icon, outline, same row as «✂ خصم من راتب»); no employee → destructive toast «أضف موظفًا أولًا.» and no open.
- `RestoreDialog`: query key `["advances-cancelled", employeeId]` on existing list endpoint `includeCancelled=1`, enabled only while open; client-filter `cancelled===true`, latest 20; columns المرجع/التاريخ/المبلغ(formatKWD + د.ك)/سبب الإلغاء(truncate+title) + row action «استعادة»; empty «لا توجد سلف ملغاة لهذا الموظف.».
- Confirm step inside same dialog: «هل تريد استعادة السلفة {رقم}؟» + «المبلغ: {..} د.ك» + تأكيد الاستعادة/رجوع.
- Mutation → POST restore: success toast «تمت استعادة السلفة ✅» + close + `refreshAll()` (same keys: employees-advances / advances-ledger / advances-summary) + invalidate `["advances-cancelled"]`; 401 → onAuthError; else destructive toast with server message.

## Checks (all pass)
- `bun test` → 184/184 pass, 745 expect() calls.
- `bunx tsc --noEmit` → 0 errors.
- `bun run lint` → 0 errors, 0 warnings.

## Notes/deviations
- `cancelledAt: ""` instead of `null` (schema String, non-nullable).
- No reason input in dialog (spec didn't request one); API still accepts optional `reason`.
- Dev server wasn't running during handoff (system-managed auto-start) → live curl smoke test replaced by static convention check (SessionUser.username verified; route mirrors sibling advances POST exactly).
- Worklog appended once via single heredoc per template.
