import {
  OVERTIME_HOURS,
  OVERTIME_KG_PER_HOUR,
  ROAST_HOURS,
  ROAST_YIELD,
  SUPPLIERS,
  hourOf,
  round2,
} from "../constants";
import type { Agent, AgentContext } from "../context";
import type { PurchaseOrder, Supplier } from "../types";


export const OpsAgent: Agent = {
  role: "ops",
  title: "Operations",
  mandate: "Roast, ship on time, keep green beans in stock, signal capacity to Sales.",
  owns: ["roasting", "shipping", "inventory", "purchase orders", "sales throttle signal"],

  async act(ctx: AgentContext) {
    const s = ctx.state;
    const t = ctx.now;
    const h = hourOf(t);
    const p = s.policy;
    const DAILY_CAPACITY_KG = (ROAST_HOURS.end - ROAST_HOURS.start) * s.capacity.greenKgPerHour * ROAST_YIELD; // roasted kg / day

    const openOrders = Object.values(s.orders)
      .filter((o) => o.status === "open")
      .sort((a, b) => a.dueAt - b.dueAt);
    const shippable = openOrders.filter((o) => !s.customers[o.customerId].creditHold);
    const backlogKg = shippable.reduce((a, o) => a + o.kg, 0);

    // ── 1. Supplier watch (self-correction): late primary PO → cancel & switch to backup.
    for (const po of Object.values(s.purchaseOrders)) {
      if (po.status === "placed" && po.supplier === "primary" && po.etaAt !== undefined && t > po.etaAt + 6) {
        ctx.emit({
          type: "PO_CANCELLED",
          summary: `Cancelled ${po.id} — ${SUPPLIERS.primary.name} is ${t - po.etaAt}h late`,
          reason: "Self-correction: supplier missed ETA by >6h; stock-out risk is higher than the price difference.",
          ref: { type: "po", id: po.id },
          data: { poId: po.id },
        });
        requestPO(ctx, "backup", po.kg, `Replacement for late ${po.id} (switching to backup supplier)`);
      }
    }

    // ── 2. Act on decided PO escalations.
    for (const esc of ctx.decided("po_approval")) {
      const po = s.purchaseOrders[esc.ref!.id];
      if (!po || po.status !== "pending_approval") continue;
      if (esc.decision === "approve") {
        placePO(ctx, po, `Approved by ${esc.resolvedBy === "system" ? "SLA default" : esc.resolvedBy}`, esc.id, esc.resolvedBy === "system" ? "system" : esc.resolvedBy);
      } else {
        ctx.emit({
          type: "PO_REJECTED",
          summary: `Dropped ${po.id} (${po.kg} kg) after rejection`,
          reason: esc.note ?? "Approval rejected",
          ref: { type: "po", id: po.id },
          data: { poId: po.id, escalationId: esc.id },
        });
      }
    }

    // ── 3. Roast.
    const inShift = h >= ROAST_HOURS.start && h < ROAST_HOURS.end;
    const inOvertime = s.capacity.overtime && h >= OVERTIME_HOURS.start && h < OVERTIME_HOURS.end;
    if (inShift || inOvertime) {
      const safety = 40;
      const needRoasted = backlogKg + safety - s.inventory.roastedKg;
      if (needRoasted > 0 && s.inventory.greenKg >= 1) {
        const cap = inOvertime ? OVERTIME_KG_PER_HOUR : s.capacity.greenKgPerHour;
        const green = round2(Math.min(cap, s.inventory.greenKg, needRoasted / ROAST_YIELD));
        if (green >= 1) {
          ctx.emit({
            type: "ROAST_BATCH",
            summary: `Roasted ${green} kg green → ${round2(green * ROAST_YIELD)} kg${inOvertime ? " (overtime)" : ""}`,
            reason: `Backlog ${Math.round(backlogKg)} kg vs ${Math.round(s.inventory.roastedKg)} kg roasted on hand`,
            data: { greenKg: green, roastedKg: round2(green * ROAST_YIELD), overtime: inOvertime },
          });
        }
      }
    }

    // ── 4. Ship (earliest due first; respect Finance's credit holds).
    if (h >= 7 && h <= 20) {
      for (const o of openOrders) {
        const c = s.customers[o.customerId];
        if (c.creditHold) continue;
        if (s.inventory.roastedKg + 1e-9 < o.kg) break;
        const late = t > o.dueAt;
        ctx.emit({
          type: "ORDER_SHIPPED",
          summary: `Shipped ${o.id} to ${c.name} (${o.kg} kg)${late ? ` — ${t - o.dueAt}h late` : ""}`,
          reason: late ? "Oldest overdue order first" : "Earliest due date first",
          ref: { type: "order", id: o.id },
          data: { orderId: o.id },
        });
      }
    }

    // ── 5. Capacity control loop (self-correction: overtime + sales throttle).
    const remaining = Object.values(s.orders).filter((o) => o.status === "open" && !s.customers[o.customerId].creditHold).reduce((a, o) => a + o.kg, 0);
    const pressure = (remaining - s.inventory.roastedKg) / DAILY_CAPACITY_KG; // days of work queued
    if (!s.capacity.overtime && pressure > 1.1 && p.overtimeAllowed) {
      ctx.emit({
        type: "OVERTIME_SET",
        summary: "Started evening overtime shift (+34 kg roasted/day)",
        reason: `Backlog is ${pressure.toFixed(1)} days of roasting; on-time delivery at risk.`,
        data: { on: true },
      });
    } else if (s.capacity.overtime && (pressure < 0.4 || !p.overtimeAllowed)) {
      ctx.emit({
        type: "OVERTIME_SET",
        summary: "Stopped overtime shift",
        reason: !p.overtimeAllowed ? "Finance disallowed overtime (cash protection)." : `Backlog down to ${pressure.toFixed(1)} days.`,
        data: { on: false },
      });
    }
    const committedWeekly = Object.values(s.customers).filter((c) => c.status !== "churned").reduce((a, c) => a + c.weeklyKg, 0);
    const weeklyCapacity = DAILY_CAPACITY_KG * 7;
    const overCommitted = committedWeekly > weeklyCapacity * 0.9;
    if (!p.salesThrottle && (pressure > 1.6 || overCommitted)) {
      ctx.emit({
        type: "POLICY_CHANGED",
        summary: "Signalled Sales: pause new deals (capacity full)",
        reason: overCommitted
          ? `Committed ${Math.round(committedWeekly)} kg/week ≥ 90% of ${Math.round(weeklyCapacity)} kg capacity.`
          : `Backlog ${pressure.toFixed(1)} days — new customers would be served late.`,
        data: { changes: { salesThrottle: true } },
      });
    } else if (p.salesThrottle && pressure < 0.7 && !overCommitted) {
      ctx.emit({
        type: "POLICY_CHANGED",
        summary: "Signalled Sales: capacity available again",
        reason: `Backlog down to ${pressure.toFixed(1)} days.`,
        data: { changes: { salesThrottle: false } },
      });
    }

    // Structural capacity gap → a human decision (capex / hiring is not delegated).
    const asked = Object.values(s.inbox).some((e) => e.kind === "capacity_expansion" && (e.status === "open" || ctx.now - e.createdAt < 72));
    if (overCommitted && p.salesThrottle && !asked && h >= 8 && h < 18) {
      ctx.escalate(
        {
          to: "human",
          kind: "capacity_expansion",
          title: `Roaster is ${Math.round((committedWeekly / weeklyCapacity) * 100)}% committed — add a permanent second shift (+3 kg/h, +$110/day)?`,
          detail: `Committed demand ${Math.round(committedWeekly)} kg/week vs ${Math.round(weeklyCapacity)} kg/week capacity. Sales is waitlisting new deals until capacity grows.`,
          recommendation: "approve",
          onExpiry: "reject",
          slaHours: 12,
          labels: { approve: "Add second shift", reject: "Stay small" },
        },
        "Capacity investments change fixed costs — a human owns that trade-off.",
      );
    }

    // ── 6. Procurement.
    const incoming = Object.values(s.purchaseOrders)
      .filter((po) => po.status === "placed" || po.status === "pending_approval")
      .reduce((a, po) => a + po.kg, 0);
    // Expedite (self-correction): stock-out within a day and nothing arriving in time → backup supplier.
    const arrivingSoon = Object.values(s.purchaseOrders).some((po) => po.status === "placed" && (po.etaAt ?? Infinity) <= t + 16);
    const burnPerDay = (ROAST_HOURS.end - ROAST_HOURS.start) * s.capacity.greenKgPerHour + (s.capacity.overtime ? (OVERTIME_HOURS.end - OVERTIME_HOURS.start) * OVERTIME_KG_PER_HOUR : 0);
    const expediteOpen = Object.values(s.purchaseOrders).some((po) => po.supplier === "backup" && (po.status === "placed" || po.status === "pending_approval"));
    if (h >= 7 && h < 19 && backlogKg > 0 && s.inventory.greenKg < burnPerDay * 0.8 && !arrivingSoon && !expediteOpen) {
      requestPO(ctx, "backup", 150, `Expedite: ${Math.round(s.inventory.greenKg)} kg green left (< 1 day of roasting) and no delivery due within 16h`);
    }
    // Reorder point adapts to the current burn rate (overtime burns faster).
    const reorderPoint = Math.max(p.reorderPointKg, Math.round(burnPerDay * 2.5));
    if (h >= 8 && h < 18 && s.inventory.greenKg + incoming < reorderPoint) {
      const weeklyGreen = committedWeekly / ROAST_YIELD;
      const need = reorderPoint + weeklyGreen * 0.8 - (s.inventory.greenKg + incoming);
      const kg = Math.max(150, Math.ceil(need / 50) * 50);
      requestPO(ctx, "primary", kg, `Green stock ${Math.round(s.inventory.greenKg)} kg + ${incoming} kg incoming < reorder point ${reorderPoint} kg`);
    }
  },
};

/** Place a PO within authority, otherwise request approval (Finance first, human if Finance is down / over its limit). */
export function requestPO(ctx: AgentContext, supplier: Supplier, kg: number, why: string) {
  const s = ctx.state;
  const sup = SUPPLIERS[supplier];
  const cost = round2(kg * sup.pricePerKg);
  const id = ctx.nextId("PO");
  const po: PurchaseOrder = { id, supplier, kg, cost, requestedAt: ctx.now, requestedBy: ctx.role, status: "pending_approval" };

  if (cost <= s.policy.opsPOLimit) {
    placePO(ctx, po, why);
    return;
  }
  ctx.emit({
    type: "PO_REQUESTED",
    summary: `Requested ${kg} kg from ${sup.name} ($${Math.round(cost)}) — needs approval`,
    reason: `${why}. $${Math.round(cost)} is above Ops authority ($${s.policy.opsPOLimit}).`,
    ref: { type: "po", id },
    data: { po },
  });
  const financeAvailable = !ctx.peerDown("finance");
  const to = financeAvailable && cost <= s.policy.financePOLimit ? "finance" : "human";
  ctx.escalate(
    {
      to,
      kind: "po_approval",
      title: `Approve PO ${id}: ${kg} kg green beans from ${sup.name} for $${Math.round(cost)}`,
      detail: `${why}. Current cash $${Math.round(s.cash)}.`,
      recommendation: "approve",
      onExpiry: "approve",
      ref: { type: "po", id },
      amount: cost,
      labels: { approve: "Approve purchase", reject: "Reject" },
    },
    !financeAvailable
      ? "Finance agent is down — routing money approvals straight to the human."
      : to === "human"
        ? `Above Finance authority ($${s.policy.financePOLimit}).`
        : `Above Ops PO authority ($${s.policy.opsPOLimit}) — asking Finance.`,
  );
}

function placePO(ctx: AgentContext, po: PurchaseOrder, why: string, escalationId?: string, approvedBy?: string) {
  const sup = SUPPLIERS[po.supplier];
  ctx.emit({
    type: "PO_PLACED",
    summary: `Ordered ${po.kg} kg green beans from ${sup.name} ($${Math.round(po.cost)}, ETA ${sup.leadHours}h)`,
    reason: why,
    ref: { type: "po", id: po.id },
    data: { po: { ...po, etaAt: ctx.now + sup.leadHours }, escalationId, approvedBy },
  });
}
