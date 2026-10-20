# Task 50-a — مجموعات العقود (Contract Groups, desktop contract_group_service.py parity)

## Scope kept
- `src/lib/contract-groups-core.ts` — NEW pure lib: `nextGroupNumber` / `dedupeContractIds` / `validateGroupContracts` / `computeGroupTotals` (imports `round3` from `@/lib/format`).
- `tests/phase9-contract-groups.test.ts` — NEW, TDD (red → green): 17 tests / 47 expect().
- `src/lib/contract-groups-server.ts` — NEW server-only helper shared by both routes: `buildGroupsResponse` (financial summary per group) + `loadGroupContracts`.
- `src/app/api/contract-groups/route.ts` — NEW GET (`screen_contracts`, `?customerId=&contractId=`) + POST (`action_add_contract`, validation → GRP numbering → 8× P2002 retry → audit in tx → 201).
- `src/app/api/contract-groups/[id]/route.ts` — NEW GET (`screen_contracts`) + DELETE (`adminGuard`, web-only safety addition, cascade items, audit «حذف مجموعة عقود»).
- `src/components/contrack/ContractGroupsView.tsx` — NEW: header + toolbar (customer filter/refresh/«＋ مجموعة جديدة») + 11-col table + create/view/delete dialogs (react-query + apiGet/apiPost/apiDelete + ApiError 401 → onAuthError + useToast, RTL, status tokens only).
- `src/components/contrack/contrack-types.ts` — added `"contract-groups"` to ViewName union only.
- `src/components/contrack/nav-structure.ts` — imported `Layers`, child after "contracts" (`perm: "screen_customers"`), updated out-of-scope comment (removed مجموعات العقود).
- `src/components/contrack/ConTrackApp.tsx` — import + `{view === "contract-groups" && <ContractGroupsView user={user} onAuthError={onAuthError} />}`; activeNav falls back to `view` (child.id === view) so nav click + highlight work with no extra mapping (same as custody).
- Did NOT touch AdvancesView.tsx / voucher-server.ts (50-b owns them), prisma schema (models already existed), no db push, no git commits, no build.

## Desktop parity (contract_group_service.py via research/spec-8-f.md §6.2 + spec-subs-gateway.md §H)
- Numbering `GRP-%04d` from top existing number, failure → GRP-0001; retry ≤8 on UNIQUE (P2002) then «تعذر إنشاء رقم مجموعة غير مكرر.» (500).
- Validation order + verbatim messages: ids<2 → «اختر عقدين على الأقل للضم في مجموعة واحدة.» ; missing row → «يوجد عقد غير موجود ضمن الاختيارات.» ; different customer → «لا يمكن ضم عقود عملاء مختلفين في نفس المجموعة.» ; status==="ملغى" → «لا يمكن ضم عقد ملغى داخل مجموعة جديدة.»
- Totals (ملغى rows fully excluded): current = amount + netApprovedAddendums + supExtension (SAME composition as report-server:284 — reused `contractCurrentValue` + `supervisionExtension`/`actualSupervisionEnd` exactly like /api/contracts does); collected = Σ receipt vouchers (cancelled=false); paid = Σ payment vouchers (cancelled=false); subs = Σ SubContract.amount (status ≠ «ملغى»); cost = paid + max(0, subs − paid); profit = collected − cost; margin = collected > 0.001 ? profit/collected×100 : 0 — all r3.
- groupNumber re-derived from DB inside each retry attempt (fresh top number), items `createMany skipDuplicates`, createdBy = guard.user.username, audit entityName `${groupNumber} — ${groupName}`.

## API shapes consumed by UI (verified against actual routes)
- `GET /api/customers` → `{ customers: [{ id, customerCode, name, phone, email, ... }] }`.
- `GET /api/contracts?customerId=X` → `{ contracts: [{ id, contractNumber, contractName, contractType, status, amount (Number), ... }] }` — UI filters out `status === "ملغى"` and renders `contractNumber — contractName (amount)`.
- `GET /api/contract-groups` → `{ groups: GroupRow[] }`; `[id]` → `{ group, contracts, totals }`.

## Checks (all pass)
- `bun test` → **201/201 pass, 792 expect() calls** (184 existing + 17 new).
- `bunx tsc --noEmit` → 0 errors.
- `bun run lint` → 0 errors, 0 warnings.

## Notes/deviations
- DELETE is a web-only addition (desktop lacks it) — coordinator must flag for user approval.
- POST also rejects empty customerId with «اختر العميل أولًا.» (400) — not in desktop but required since customerId is a NOT NULL FK column.
- createdAt serialized as `toISOString().slice(0,10)` (YYYY-MM-DD text per conventions).
- Server validation accepts only status «ملغى» as cancelled (verbatim desktop rule); UI hides only «ملغى» from the checkbox list too.
- Dev server not running during handoff (no dev.log) → browser verification deferred to coordinator: nav «مجموعات العقود» under tab «العقود», create flow (customer → checkboxes disabled until ≥2 selected), view dialog totals cards, admin-only delete, secretary seeing no 🗑 button.
