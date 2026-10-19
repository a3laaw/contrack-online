"use client";

/**
 * الرسم الشهري للتقرير المالي — مرآة CashflowChart المكتبي (ui/cashflow_chart.py):
 * أعمدة شهرية RTL (أول شهر يمين) · أخضر #16A34A = وارد · أحمر #DC2626 = منصرف ·
 * شبكة أفقية (4+1) · قيم فوق الأعمدة بآلاف k · وسيلة إيضاح أعلى اليسار · بلا مكتبات خارجية.
 */

import { chartValueLabel, type ChartDatum } from "@/lib/cashflow-modes-core";

const GREEN = "#16A34A"; // style.OK_GREEN المكتبي
const RED = "#DC2626"; // style.DANGER المكتبي
const TEXT = "#334155";
const MUTED = "#64748B";

const W = 640;
const H = 220;
const PAD_R = 12;
const PAD_L = 12;
const PAD_T = 26;
const PAD_B = 34;

export function CashflowChart({ data }: { data: ChartDatum[] }) {
  if (!data.length) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="الرسم الشهري للتدفق النقدي">
        <text x={W / 2} y={H / 2} textAnchor="middle" dominantBaseline="middle" fontSize={13} fill={MUTED}>
          لا توجد حركة مالية بعد
        </text>
      </svg>
    );
  }

  const plotW = W - PAD_R - PAD_L;
  const plotH = H - PAD_T - PAD_B;
  const maxVal = Math.max(1, ...data.map((d) => Math.max(d.in, d.out)));
  const baseY = PAD_T + plotH;
  const groupW = plotW / data.length;
  const barW = Math.min(26, groupW * 0.32);
  const gap = 4;
  const gridLines = [0, 1, 2, 3, 4].map((i) => PAD_T + plotH - (plotH * i) / 4);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label="الرسم الشهري للتدفق النقدي — أخضر الوارد وأحمر المنصرف"
    >
      {gridLines.map((y, i) => (
        <line key={i} x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke={MUTED} strokeOpacity={0.18} strokeWidth={1} />
      ))}
      {data.map((d, i) => {
        // المجموعة i من اليمين (RTL: أول شهر يمين كالمكتبي)
        const cx = W - PAD_R - groupW * i - groupW / 2;
        const inH = plotH * (d.in / maxVal);
        const outH = plotH * (d.out / maxVal);
        const inX = cx - barW - gap / 2; // الوارد يمين المجموعة
        const outX = cx + gap / 2;
        return (
          <g key={`${d.label}-${i}`}>
            {d.in > 0 && <rect x={inX} y={baseY - inH} width={barW} height={inH} rx={3} fill={GREEN} />}
            {d.out > 0 && <rect x={outX} y={baseY - outH} width={barW} height={outH} rx={3} fill={RED} />}
            {d.in > 0 && (
              <text x={inX + barW / 2} y={baseY - inH - 6} textAnchor="middle" fontSize={10} fill={GREEN}>
                {chartValueLabel(d.in)}
              </text>
            )}
            {d.out > 0 && (
              <text x={outX + barW / 2} y={baseY - outH - 6} textAnchor="middle" fontSize={10} fill={RED}>
                {chartValueLabel(d.out)}
              </text>
            )}
            <text x={cx} y={baseY + 14} textAnchor="middle" fontSize={10} fill={MUTED}>
              {d.label}
            </text>
          </g>
        );
      })}
      {/* وسيلة الإيضاح أعلى اليسار كالمكتبي */}
      <rect x={PAD_L} y={6} width={10} height={10} rx={2} fill={GREEN} />
      <text x={PAD_L + 14} y={15} fontSize={11} fill={TEXT}>
        الوارد
      </text>
      <rect x={PAD_L + 78} y={6} width={10} height={10} rx={2} fill={RED} />
      <text x={PAD_L + 92} y={15} fontSize={11} fill={TEXT}>
        المنصرف
      </text>
    </svg>
  );
}
