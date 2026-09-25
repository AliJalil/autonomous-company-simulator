import { LIST_PRICE_PER_KG, isBusinessHour, round2 } from "../constants";
import type { Agent, AgentContext } from "../context";
import { rand } from "../rng";
import type { Customer, Lead } from "../types";

const pct = (d: number) => `${Math.round(d * 100)}%`;

export const SalesAgent: Agent = {
  role: "sales",
  title: "Sales",
  mandate: "Turn leads into profitable subscriptions without over-selling Ops capacity.",
  owns: ["leads", "quotes", "new customers"],

  async act(ctx: AgentContext) {
    if (!isBusinessHour(ctx.now)) return;
    const s = ctx.state;
    const p = s.policy;
    // Capacity awareness through shared state: Ops' throttle signal, or Ops being down.
    const opsDown = ctx.peerDown("ops");
    const throttle = p.salesThrottle || opsDown;
    const throttleWhy = opsDown ? "Ops agent is down — can't confirm capacity" : "Ops signalled capacity is full";

    // 1. Act on decided discount escalations.
    for (const esc of ctx.decided("discount_approval")) {
      const lead = s.leads[esc.ref!.id];
      if (!lead || lead.stage !== "pending_approval") continue;
      const discount = esc.decision === "approve" ? esc.amount! : p.maxDiscount;
      ctx.emit({
        type: "LEAD_QUOTED",
        summary: `Quoted ${lead.name} ${pct(discount)} off (${esc.decision === "approve" ? "approved" : "counter-offer after rejection"})`,
        reason: `${esc.resolvedBy === "system" ? "Approval timed out → safe default" : `Decision by ${esc.resolvedBy}`}: ${esc.decision}`,
        ref: { type: "lead", id: lead.id },
        data: { leadId: lead.id, discount, escalationId: esc.id },
      });
    }

    // 2. Close accepted deals (or park them if capacity is full).
    for (const lead of Object.values(s.leads)) {
      const parkedAccepted = lead.stage === "parked" && lead.quotedDiscount !== undefined;
      if (lead.stage !== "accepted" && !parkedAccepted) continue;
      if (throttle) {
        if (lead.stage === "accepted")
          ctx.emit({
            type: "LEAD_PARKED",
            summary: `Parked signed deal ${lead.name} until capacity frees up`,
            reason: throttleWhy,
            ref: { type: "lead", id: lead.id },
            data: { leadId: lead.id },
          });
        continue;
      }
      const discount = lead.quotedDiscount ?? 0;
      const cid = ctx.nextId("C");
      const customer: Customer = {
        id: cid,
        name: lead.name,
        weeklyKg: lead.weeklyKg,
        pricePerKg: round2(LIST_PRICE_PER_KG * (1 - discount)),
        discount,
        orderDay: Math.floor(rand(ctx.seed, `od:${lead.id}`) * 5),
        since: ctx.now,
        status: "active",
        health: 78,
        reliability: round2(0.62 + rand(ctx.seed, `rel:${lead.id}`) * 0.36),
        creditHold: false,
        lateOrders: 0,
        creditsIssued: 0,
      };
      ctx.emit({
        type: "DEAL_WON",
        summary: `Won ${lead.name}: ${lead.weeklyKg} kg/week at $${customer.pricePerKg}/kg (+$${Math.round(lead.weeklyKg * customer.pricePerKg * 4.33)} MRR)`,
        reason: parkedAccepted ? "Capacity available again — un-parked" : "Prospect accepted quote; capacity confirmed via shared state",
        ref: { type: "lead", id: lead.id },
        data: { leadId: lead.id, customer },
      });
    }

    // 3. Work new leads (max 3 per hour).
    const fresh = Object.values(s.leads)
      .filter((l) => l.stage === "new" || l.stage === "acknowledged" || (!throttle && l.stage === "parked" && l.quotedDiscount === undefined))
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, throttle ? 10 : 3);
    for (const lead of fresh) {
      if (throttle) {
        if (lead.stage !== "parked")
          ctx.emit({
            type: "LEAD_PARKED",
            summary: `Waitlisted ${lead.name} (${lead.weeklyKg} kg/week)`,
            reason: throttleWhy,
            ref: { type: "lead", id: lead.id },
            data: { leadId: lead.id },
          });
        continue;
      }
      await quote(ctx, lead);
    }

    // 4. Covering for Support: high-severity tickets only, half credit authority.
    if (ctx.isCovering("support")) {
      for (const tk of Object.values(s.tickets)) {
        if (tk.status !== "open" || tk.severity !== "high") continue;
        const c = s.customers[tk.customerId];
        const credit = Math.min(p.supportCreditLimit / 2, 25);
        ctx.emit({
          type: "CREDIT_ISSUED",
          summary: `(covering Support) $${credit} goodwill credit to ${c.name}`,
          reason: "Support agent is down; Sales acts as account manager for high-severity tickets (half credit authority).",
          ref: { type: "customer", id: c.id },
          data: { customerId: c.id, amount: credit },
        });
        ctx.emit({
          type: "TICKET_RESOLVED",
          summary: `(covering Support) Resolved ${tk.id} for ${c.name}`,
          reason: "Coverage assigned by watchdog",
          ref: { type: "ticket", id: tk.id },
          data: { ticketId: tk.id, credit },
        });
      }
    }
  },
};

async function quote(ctx: AgentContext, lead: Lead) {
  const s = ctx.state;
  const p = s.policy;
  const ask = lead.askDiscount;
  const big = lead.weeklyKg >= 35;

  let discount = 0;
  let rationale = "No discount requested → list price";
  let brain: "rules" | "llm" = "rules";
  if (ask > 0) {
    const options = [
      { id: "match", label: `match the ask (${pct(ask)})` },
      { id: "split", label: `split the difference (${pct(Math.min(ask, (ask + p.maxDiscount) / 2))})` },
      { id: "cap", label: `offer our standard cap (${pct(Math.min(ask, p.maxDiscount))})` },
    ];
    const def = ask <= p.maxDiscount ? "match" : big ? "match" : "cap";
    const verdict = await ctx.brain.judge({
      role: "sales",
      question: `How much discount should we quote ${lead.name} (${lead.weeklyKg} kg/week, asked ${pct(ask)})?`,
      context: { lead, maxDiscountWithoutApproval: p.maxDiscount, financeAuthority: p.financeDiscountAuthority, listPrice: LIST_PRICE_PER_KG },
      options,
      defaultChoice: def,
      defaultRationale: ask <= p.maxDiscount ? "Ask is within my authority" : big ? "Large account — worth asking for approval" : "Small account — hold the line at policy cap",
    });
    brain = verdict.source;
    rationale = verdict.rationale;
    discount = verdict.choice === "match" ? ask : verdict.choice === "split" ? Math.min(ask, (ask + p.maxDiscount) / 2) : Math.min(ask, p.maxDiscount);
    discount = round2(discount);
  }

  if (discount <= p.maxDiscount + 1e-9) {
    ctx.emit({
      type: "LEAD_QUOTED",
      summary: `Quoted ${lead.name} ${pct(discount)} off for ${lead.weeklyKg} kg/week`,
      reason: rationale,
      brain,
      ref: { type: "lead", id: lead.id },
      data: { leadId: lead.id, discount },
    });
    return;
  }
  // Above my authority → Finance (peer) if it can decide, else the human.
  const financeCan = !ctx.peerDown("finance") && discount <= p.financeDiscountAuthority + 1e-9;
  const mrr = Math.round(lead.weeklyKg * LIST_PRICE_PER_KG * (1 - discount) * 4.33);
  ctx.escalate(
    {
      to: financeCan ? "finance" : "human",
      kind: "discount_approval",
      title: `${pct(discount)} discount for ${lead.name} (${lead.weeklyKg} kg/week, ~$${mrr.toLocaleString()}/mo)`,
      detail: `Prospect asked ${pct(ask)}. Sales may give ${pct(p.maxDiscount)} alone; Finance up to ${pct(p.financeDiscountAuthority)}. ${rationale}`,
      recommendation: discount <= 0.22 ? "approve" : "reject",
      onExpiry: "reject",
      ref: { type: "lead", id: lead.id },
      amount: discount,
      labels: { approve: `Approve ${pct(discount)}`, reject: `Counter at ${pct(p.maxDiscount)}` },
    },
    financeCan ? "Above Sales discount authority — asking Finance." : ctx.peerDown("finance") ? "Finance is down — routing to human." : "Above Finance authority — needs a human.",
  );
}
