import { useMemo } from "react";
import type { KpiSnapshot, SimEvent } from "../../engine";
import { money } from "../../engine";

export function Sparkline({ values, color, height = 28 }: { values: number[]; color: string; height?: number }) {
  const w = 120;
  if (values.length < 2) return <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${height - 2 - ((v - min) / span) * (height - 4)}`).join(" ");
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

interface Series {
  label: string;
  color: string;
  values: number[];
  dashed?: boolean;
}

export function LineChart({
  title,
  series,
  totalTicks,
  format = (n) => String(Math.round(n)),
  markers = [],
  height = 170,
}: {
  title: string;
  series: Series[];
  totalTicks: number;
  format?: (n: number) => string;
  markers?: { tick: number; label: string; color: string }[];
  height?: number;
}) {
  const W = 560;
  const H = height;
  const pad = { l: 52, r: 10, t: 10, b: 20 };
  const all = series.flatMap((s) => s.values);
  const min = Math.min(0, ...all);
  const max = Math.max(1, ...all);
  const x = (i: number) => pad.l + (i / Math.max(1, totalTicks - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min || 1)) * (H - pad.t - pad.b);
  const ticks = [min, (min + max) / 2, max];
  const days = Math.ceil(totalTicks / 24);

  return (
    <div className="panel p-3">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold text-slate-200">{title}</div>
        <div className="flex flex-wrap gap-3">
          {series.map((s) => (
            <span key={s.label} className="flex items-center gap-1 text-[10px] text-slate-400">
              <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title}>
        {Array.from({ length: days + 1 }, (_, d) => (
          <g key={d}>
            <line x1={x(d * 24)} x2={x(d * 24)} y1={pad.t} y2={H - pad.b} stroke="rgba(255,255,255,0.06)" />
            {d < days && (
              <text x={x(d * 24 + 12)} y={H - 6} fontSize="9" fill="#64748b" textAnchor="middle">
                D{d + 1}
              </text>
            )}
          </g>
        ))}
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.05)" />
            <text x={pad.l - 6} y={y(v) + 3} fontSize="9" fill="#64748b" textAnchor="end">
              {format(v)}
            </text>
          </g>
        ))}
        {markers.map((m, i) => (
          <g key={i}>
            <line x1={x(m.tick)} x2={x(m.tick)} y1={pad.t} y2={H - pad.b} stroke={m.color} strokeDasharray="3 3" opacity={0.7} />
            <text x={x(m.tick) + 3} y={pad.t + 9 + (i % 3) * 10} fontSize="8.5" fill={m.color}>
              {m.label}
            </text>
          </g>
        ))}
        {series.map((s) =>
          s.values.length > 1 ? (
            <polyline
              key={s.label}
              points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
              fill="none"
              stroke={s.color}
              strokeWidth={1.8}
              strokeDasharray={s.dashed ? "4 3" : undefined}
              strokeLinejoin="round"
            />
          ) : null,
        )}
      </svg>
    </div>
  );
}

const MARKER_TYPES: Record<string, { label: (e: SimEvent) => string; color: string }> = {
  AGENT_FAILED: { label: (e) => `${e.data.role} crashed`, color: "#fb7185" },
  AGENT_RECOVERY_DETECTED: { label: (e) => `${e.data.role} back`, color: "#34d399" },
  OVERTIME_SET: { label: (e) => (e.data.on ? "overtime on" : "overtime off"), color: "#fbbf24" },
  PO_CANCELLED: { label: () => "switch supplier", color: "#fb923c" },
};

export function ChartsPanel({ history, events, totalTicks }: { history: KpiSnapshot[]; events: SimEvent[]; totalTicks: number }) {
  const markers = useMemo(
    () =>
      events
        .filter((e) => MARKER_TYPES[e.type])
        .map((e) => ({ tick: e.tick, label: MARKER_TYPES[e.type].label(e), color: MARKER_TYPES[e.type].color })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, events.length],
  );
  const col = <K extends keyof KpiSnapshot>(k: K) => history.map((h) => h[k] as number);
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <LineChart title="Cash" totalTicks={totalTicks} format={money} markers={markers} series={[{ label: "cash", color: "#34d399", values: col("cash") }]} />
      <LineChart
        title="Revenue vs costs (cumulative)"
        totalTicks={totalTicks}
        format={money}
        series={[
          { label: "revenue", color: "#38bdf8", values: col("revenue") },
          { label: "costs", color: "#fb7185", values: col("costs") },
        ]}
      />
      <LineChart
        title="Backlog (kg) & late open orders ×10"
        totalTicks={totalTicks}
        markers={markers}
        series={[
          { label: "backlog kg", color: "#fbbf24", values: col("backlogKg") },
          { label: "late orders ×10", color: "#fb7185", values: history.map((h) => h.lateOrders * 10), dashed: true },
        ]}
      />
      <LineChart
        title="Customers & health"
        totalTicks={totalTicks}
        series={[
          { label: "active", color: "#a78bfa", values: col("activeCustomers") },
          { label: "at risk", color: "#fb923c", values: col("atRisk") },
          { label: "churned", color: "#fb7185", values: col("churned") },
          { label: "avg health ÷5", color: "#94a3b8", values: history.map((h) => h.avgHealth / 5), dashed: true },
        ]}
      />
      <LineChart
        title="Green beans vs roasted stock (kg)"
        totalTicks={totalTicks}
        markers={markers.filter((m) => m.label === "switch supplier")}
        series={[
          { label: "green", color: "#84cc16", values: col("greenKg") },
          { label: "roasted", color: "#d97706", values: col("roastedKg") },
        ]}
      />
      <LineChart
        title="Contribution margin & Sales discount cap (policy written by Finance)"
        totalTicks={totalTicks}
        format={(n) => `${Math.round(n * 100)}%`}
        series={[
          { label: "margin (cum.)", color: "#34d399", values: col("grossMargin") },
          { label: "max discount", color: "#38bdf8", values: col("maxDiscount"), dashed: true },
        ]}
      />
    </div>
  );
}
