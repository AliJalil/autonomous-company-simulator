import type { KpiSnapshot } from "../../engine";
import { money } from "../../engine";
import { pct } from "../theme";
import { Sparkline } from "./Charts";

interface Kpi {
  label: string;
  value: string;
  sub?: string;
  series: number[];
  color: string;
  delta?: number;
  goodWhenUp?: boolean;
  hint: string;
}

export function KpiStrip({ history }: { history: KpiSnapshot[] }) {
  const last = history[history.length - 1];
  const dayAgo = history[Math.max(0, history.length - 25)];
  if (!last) {
    return (
      <div className="panel flex items-center justify-center p-6 text-sm text-slate-400">
        Press <span className="mx-1 rounded bg-amber-400/20 px-1.5 text-amber-200">▶ Run the week</span> — the agents take it from there.
      </div>
    );
  }
  const d = (k: keyof KpiSnapshot) => (last[k] as number) - (dayAgo[k] as number);
  const kpis: Kpi[] = [
    { label: "Cash", value: money(last.cash), series: history.map((h) => h.cash), color: "#34d399", delta: d("cash"), goodWhenUp: true, hint: "Bank balance (cash in − cash out)" },
    { label: "Revenue", value: money(last.revenue), sub: `costs ${money(last.costs)}`, series: history.map((h) => h.revenue), color: "#38bdf8", delta: d("revenue"), goodWhenUp: true, hint: "Recognised when Finance invoices a shipment" },
    { label: "Margin", value: last.revenue > 0 ? pct(last.grossMargin, 1) : "—", sub: "contribution", series: history.map((h) => h.grossMargin), color: "#2dd4bf", hint: "(revenue − beans − overtime − credits) / revenue" },
    { label: "MRR", value: money(last.mrr), sub: `${last.activeCustomers} customers`, series: history.map((h) => h.mrr), color: "#a78bfa", delta: d("mrr"), goodWhenUp: true, hint: "Monthly recurring revenue of live subscriptions" },
    { label: "Backlog", value: `${last.backlogKg} kg`, sub: `${last.backlogOrders} open · ${last.lateOrders} late`, series: history.map((h) => h.backlogKg), color: "#fbbf24", hint: "Open orders not yet shipped" },
    { label: "On-time", value: pct(last.onTimeRate, 0), sub: "of shipments", series: history.map((h) => h.onTimeRate), color: "#84cc16", hint: "Shipped before due time" },
    { label: "Churn", value: `${last.churned}`, sub: `${last.atRisk} at risk · health ${last.avgHealth}`, series: history.map((h) => h.avgHealth), color: "#fb7185", hint: "Customers lost; sparkline = avg health" },
    { label: "Your inbox", value: `${last.openEscalations}`, sub: "open decisions", series: history.map((h) => h.openEscalations), color: "#f43f5e", hint: "Escalations waiting for a human" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
      {kpis.map((k) => (
        <div key={k.label} className="panel px-3 pb-1.5 pt-2.5" title={k.hint}>
          <div className="flex items-baseline justify-between gap-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{k.label}</div>
            {k.delta !== undefined && Math.round(k.delta) !== 0 && (
              <div className={`text-[10px] font-semibold ${k.delta > 0 === !!k.goodWhenUp ? "text-emerald-400" : "text-rose-400"}`}>
                {k.delta > 0 ? "▲" : "▼"} {Math.abs(Math.round(k.delta)).toLocaleString()}
              </div>
            )}
          </div>
          <div className="mt-0.5 font-mono text-lg font-semibold text-white">{k.value}</div>
          <div className="h-3.5 truncate text-[10px] text-slate-500">{k.sub}</div>
          <Sparkline values={k.series} color={k.color} />
        </div>
      ))}
    </div>
  );
}
