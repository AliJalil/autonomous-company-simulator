import { contributionMargin } from "./agents/finance";
import type { CompanyState, KpiSnapshot, Tick } from "./types";

export function computeKpis(s: CompanyState, tick: Tick): KpiSnapshot {
  const customers = Object.values(s.customers);
  const live = customers.filter((c) => c.status !== "churned");
  const open = Object.values(s.orders).filter((o) => o.status === "open");
  const shipped = s.counters.shippedOnTime + s.counters.shippedLate;
  const f = s.fin;
  const costs = f.cogs + f.overtime + f.opex + f.agentRuntime + f.credits + f.writeOffs;
  return {
    tick,
    cash: Math.round(s.cash),
    revenue: Math.round(f.revenue),
    costs: Math.round(costs),
    grossMargin: contributionMargin(f),
    backlogOrders: open.length,
    backlogKg: Math.round(open.reduce((a, o) => a + o.kg, 0)),
    lateOrders: open.filter((o) => tick > o.dueAt).length,
    onTimeRate: shipped ? s.counters.shippedOnTime / shipped : 1,
    activeCustomers: live.length,
    atRisk: live.filter((c) => c.status === "at_risk").length,
    churned: customers.length - live.length,
    churnRate: customers.length ? (customers.length - live.length) / customers.length : 0,
    mrr: Math.round(live.reduce((a, c) => a + c.weeklyKg * c.pricePerKg * 4.33, 0)),
    avgHealth: live.length ? Math.round(live.reduce((a, c) => a + c.health, 0) / live.length) : 0,
    openTickets: Object.values(s.tickets).filter((t) => t.status !== "resolved").length,
    openEscalations: Object.values(s.inbox).filter((e) => e.status === "open" && e.to === "human").length,
    greenKg: Math.round(s.inventory.greenKg),
    roastedKg: Math.round(s.inventory.roastedKg),
    maxDiscount: s.policy.maxDiscount,
  };
}
