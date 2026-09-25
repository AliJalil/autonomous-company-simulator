import { LIST_PRICE_PER_KG, isBusinessHour, round2 } from "../constants";
import type { Agent, AgentContext } from "../context";
import type { Customer, Ticket } from "../types";

export const SupportAgent: Agent = {
  role: "support",
  title: "Customer Success",
  mandate: "Resolve tickets, warn customers before they feel a problem, stop churn.",
  owns: ["tickets", "credits", "customer health", "retention offers"],

  async act(ctx: AgentContext) {
    if (!isBusinessHour(ctx.now)) return;
    const s = ctx.state;
    const t = ctx.now;

    // 1. Decided escalations (credits, retention offers).
    for (const esc of ctx.decided("credit_approval")) {
      const tk = s.tickets[esc.ref!.id];
      if (!tk || tk.status !== "pending_approval") continue;
      const c = s.customers[tk.customerId];
      const credit = esc.decision === "approve" ? esc.amount! : 0;
      if (credit > 0)
        ctx.emit({
          type: "CREDIT_ISSUED",
          summary: `$${credit} credit to ${c.name} (approved)`,
          reason: `Approved by ${esc.resolvedBy}`,
          ref: { type: "customer", id: c.id },
          data: { customerId: c.id, amount: credit, escalationId: esc.id },
        });
      ctx.emit({
        type: "TICKET_RESOLVED",
        summary: `Resolved ${tk.id} for ${c.name}${credit ? ` with $${credit} credit` : " (apology, no credit)"}`,
        reason: credit ? "Credit approved" : "Credit not approved — resolved with apology",
        ref: { type: "ticket", id: tk.id },
        data: { ticketId: tk.id, credit, escalationId: esc.id },
      });
    }
    for (const esc of ctx.decided("retention_offer")) {
      const c = s.customers[esc.ref!.id];
      if (!c || c.status === "churned") continue;
      if (esc.decision === "approve") {
        const discount = esc.amount!;
        ctx.emit({
          type: "RETENTION_OFFER",
          summary: `Retention offer accepted by ${c.name}: ${Math.round(discount * 100)}% off for 3 months`,
          reason: `Approved by ${esc.resolvedBy}`,
          ref: { type: "customer", id: c.id },
          data: { customerId: c.id, discount, pricePerKg: round2(LIST_PRICE_PER_KG * (1 - discount)), escalationId: esc.id },
        });
      } else {
        ctx.emit({
          type: "CUSTOMER_CONTACTED",
          summary: `Called ${c.name} (no discount) to repair the relationship`,
          reason: "Retention discount not approved — personal outreach instead",
          ref: { type: "customer", id: c.id },
          data: { customerId: c.id, healthGain: 6, escalationId: esc.id, retention: true },
        });
      }
    }

    // 2. Resolve open tickets (up to 3 per hour, oldest first, after 1h triage).
    const open = Object.values(s.tickets)
      .filter((tk) => tk.status === "open" && tk.openedAt < t)
      .sort((a, b) => (a.severity === b.severity ? a.openedAt - b.openedAt : a.severity === "high" ? -1 : 1))
      .slice(0, 3);
    for (const tk of open) resolveTicket(ctx, tk);

    // 3. Delay notices. Baseline: reactive, once an order is >4h late.
    //    Compensation: if Ops is down, warn EVERY customer with an order due in the next 24h.
    const opsDown = ctx.peerDown("ops");
    const byCustomer = new Map<string, string[]>();
    for (const o of Object.values(s.orders)) {
      if (o.status !== "open" || o.notifiedLate) continue;
      const atRisk = t > o.dueAt + 4 || (opsDown && o.dueAt - t < 24);
      if (atRisk) byCustomer.set(o.customerId, [...(byCustomer.get(o.customerId) ?? []), o.id]);
    }
    for (const [cid, orderIds] of byCustomer) {
      const c = s.customers[cid];
      ctx.emit({
        type: "CUSTOMER_CONTACTED",
        summary: `Warned ${c.name}: ${orderIds.join(", ")} will be late`,
        reason: opsDown ? "Ops agent is down — pre-emptive notice before the customer notices" : "Order is more than 4h past its due time",
        ref: { type: "customer", id: cid },
        data: { customerId: cid, orderIds, healthGain: 2 },
      });
    }

    // 4. Churn prevention for at-risk customers (once per 72h each).
    for (const c of Object.values(s.customers)) {
      if (c.status !== "at_risk") continue;
      if (c.retentionOfferAt !== undefined && t - c.retentionOfferAt < 72) continue;
      const pendingEsc = Object.values(s.inbox).some((e) => e.kind === "retention_offer" && e.ref?.id === c.id && (e.status === "open" || !e.consumed));
      if (pendingEsc) continue;
      await retain(ctx, c);
    }

    // 5. Covering for Sales: keep inbound leads warm.
    if (ctx.isCovering("sales")) {
      for (const l of Object.values(s.leads)) {
        if (l.stage !== "new") continue;
        ctx.emit({
          type: "LEAD_ACKNOWLEDGED",
          summary: `(covering Sales) Acknowledged ${l.name} — "a specialist will follow up shortly"`,
          reason: "Sales agent is down; acknowledging keeps the lead from going cold (Support may not quote).",
          ref: { type: "lead", id: l.id },
          data: { leadId: l.id },
        });
      }
    }
  },
};

function resolveTicket(ctx: AgentContext, tk: Ticket) {
  const s = ctx.state;
  const c = s.customers[tk.customerId];
  let credit = 0;
  if (tk.kind === "late_delivery") {
    const o = tk.orderId ? s.orders[tk.orderId] : undefined;
    credit = Math.round((o?.kg ?? 20) * c.pricePerKg * 0.1);
  } else if (tk.kind === "quality") credit = tk.severity === "high" ? 40 : 20;

  if (credit > s.policy.supportCreditLimit) {
    ctx.escalate(
      {
        to: "human",
        kind: "credit_approval",
        title: `$${credit} credit for ${c.name} (${tk.kind.replace("_", " ")})`,
        detail: `10% of order value for a late delivery. Support may credit up to $${s.policy.supportCreditLimit}. Customer health ${c.health}/100.`,
        recommendation: c.weeklyKg >= 25 || c.health < 50 ? "approve" : "reject",
        onExpiry: "reject",
        ref: { type: "ticket", id: tk.id },
        amount: credit,
        labels: { approve: `Approve $${credit}`, reject: "Apology only" },
      },
      `Credit above Support authority ($${s.policy.supportCreditLimit}).`,
    );
    return;
  }
  if (credit > 0)
    ctx.emit({
      type: "CREDIT_ISSUED",
      summary: `$${credit} credit to ${c.name}`,
      reason: `${tk.kind.replace("_", " ")} ticket; within Support authority`,
      ref: { type: "customer", id: c.id },
      data: { customerId: c.id, amount: credit },
    });
  ctx.emit({
    type: "TICKET_RESOLVED",
    summary: `Resolved ${tk.id} (${tk.kind.replace("_", " ")}) for ${c.name}`,
    reason: tk.kind === "billing" ? "Explained invoice line items" : tk.kind === "quality" ? "Replacement bag shipped with next order" : "Apologised + credit",
    ref: { type: "ticket", id: tk.id },
    data: { ticketId: tk.id, credit },
  });
}

async function retain(ctx: AgentContext, c: Customer) {
  const s = ctx.state;
  const p = s.policy;
  const big = c.weeklyKg >= 30;
  const offer = round2(Math.min(0.25, c.discount + 0.08));
  const verdict = await ctx.brain.judge({
    role: "support",
    question: `${c.name} is at risk of churning (health ${c.health}). How do we respond?`,
    context: { customer: c, maxDiscount: p.maxDiscount, proposedDiscount: offer },
    options: [
      { id: "call", label: "personal call + check-in (no discount)" },
      { id: "offer", label: `retention discount ${Math.round(offer * 100)}%` },
    ],
    defaultChoice: big ? "offer" : "call",
    defaultRationale: big ? "High-value account — a discount is cheaper than losing it" : "Small account — a personal call is usually enough",
  });
  if (verdict.choice === "call") {
    ctx.emit({
      type: "CUSTOMER_CONTACTED",
      summary: `Check-in call with at-risk ${c.name}`,
      reason: verdict.rationale,
      brain: verdict.source,
      ref: { type: "customer", id: c.id },
      data: { customerId: c.id, healthGain: 5, retention: true },
    });
    ctx.emit({
      type: "CREDIT_ISSUED",
      summary: `$20 goodwill credit to ${c.name}`,
      reason: "Paired with check-in call",
      ref: { type: "customer", id: c.id },
      data: { customerId: c.id, amount: 20 },
    });
    return;
  }
  if (offer <= p.maxDiscount) {
    ctx.emit({
      type: "RETENTION_OFFER",
      summary: `Retention offer to ${c.name}: ${Math.round(offer * 100)}% off`,
      reason: verdict.rationale,
      brain: verdict.source,
      ref: { type: "customer", id: c.id },
      data: { customerId: c.id, discount: offer, pricePerKg: round2(LIST_PRICE_PER_KG * (1 - offer)) },
    });
    return;
  }
  const monthly = Math.round(c.weeklyKg * c.pricePerKg * 4.33);
  ctx.escalate(
    {
      to: "human",
      kind: "retention_offer",
      title: `Save ${c.name}? ${Math.round(offer * 100)}% retention discount (~$${monthly.toLocaleString()}/mo account)`,
      detail: `Health ${c.health}/100, ${c.lateOrders} late orders. ${verdict.rationale}`,
      recommendation: "approve",
      onExpiry: "reject",
      ref: { type: "customer", id: c.id },
      amount: offer,
      slaHours: 8,
      labels: { approve: `Offer ${Math.round(offer * 100)}%`, reject: "Call only" },
    },
    `Retention discount above policy cap (${Math.round(p.maxDiscount * 100)}%) — a human owns pricing exceptions.`,
  );
}
