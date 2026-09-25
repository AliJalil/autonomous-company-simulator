import { DEFAULT_POLICY, SUPPLIERS, isBusinessHour, round2 } from "../constants";
import type { Agent, AgentContext } from "../context";
import type { Escalation, Financials } from "../types";

/** Margin over the last ~2 days (since the day-close checkpoint two days ago). */
export function trailingMargin(fin: Financials, checkpoints: Financials[]) {
  const base = checkpoints.length >= 2 ? checkpoints[checkpoints.length - 2] : undefined;
  if (!base) return { margin: contributionMargin(fin), revenue: fin.revenue };
  const d = { revenue: fin.revenue - base.revenue, cogs: fin.cogs - base.cogs, overtime: fin.overtime - base.overtime, credits: fin.credits - base.credits };
  return { margin: contributionMargin(d), revenue: d.revenue };
}

export function contributionMargin(fin: { revenue: number; cogs: number; overtime: number; credits: number }) {
  return fin.revenue > 0 ? (fin.revenue - fin.cogs - fin.overtime - fin.credits) / fin.revenue : 0;
}

export const FinanceAgent: Agent = {
  role: "finance",
  title: "Finance",
  mandate: "Bill every shipment, collect cash, protect margin and runway, approve spend within authority.",
  owns: ["invoices", "collections", "credit holds", "discount & PO approvals", "pricing policy", "overtime permission"],

  async act(ctx: AgentContext) {
    if (!isBusinessHour(ctx.now)) return;
    const s = ctx.state;
    const p = s.policy;
    const t = ctx.now;
    const margin = contributionMargin(s.fin);

    // 1. Decide escalations addressed to Finance by peers.
    const mine = Object.values(s.inbox).filter((e) => e.to === "finance" && e.status === "open");
    for (const esc of mine) decide(ctx, esc, margin);

    // 2. Invoice every shipped order.
    const invoiced = new Set(Object.values(s.invoices).map((i) => i.orderId));
    for (const o of Object.values(s.orders)) {
      if (o.status !== "shipped" || invoiced.has(o.id)) continue;
      const c = s.customers[o.customerId];
      const id = ctx.nextId("INV");
      const amount = round2(o.kg * c.pricePerKg);
      ctx.emit({
        type: "INVOICE_ISSUED",
        summary: `Invoiced ${c.name} $${Math.round(amount)} for ${o.id}`,
        reason: "Shipment confirmed in shared record",
        ref: { type: "invoice", id },
        data: { invoice: { id, customerId: c.id, orderId: o.id, amount, issuedAt: t, dueAt: t + p.paymentTermsHours, status: "open", reminders: 0 } },
      });
    }

    // 3. Collections.
    const supportDown = ctx.peerDown("support");
    for (const inv of Object.values(s.invoices)) {
      if (inv.status !== "open" || t <= inv.dueAt) continue;
      const c = s.customers[inv.customerId];
      const hasOpenTicket = Object.values(s.tickets).some((tk) => tk.customerId === c.id && tk.status !== "resolved");
      if (supportDown && hasOpenTicket) continue; // don't chase money from someone nobody is helping
      const overdue = t - inv.dueAt;
      if ((inv.remindedAt === undefined || t - inv.remindedAt >= 24) && inv.reminders < 3) {
        ctx.emit({
          type: "PAYMENT_REMINDER",
          summary: `Reminder #${inv.reminders + 1} to ${c.name} for ${inv.id} ($${Math.round(inv.amount)}, ${overdue}h overdue)`,
          reason: "Invoice past terms",
          ref: { type: "invoice", id: inv.id },
          data: { invoiceId: inv.id },
        });
      }
      if (overdue > 72 && inv.reminders >= 2 && !c.creditHold && c.status !== "churned") {
        const verdict = await ctx.brain.judge({
          role: "finance",
          question: `${c.name} is ${overdue}h overdue on $${Math.round(inv.amount)} after ${inv.reminders} reminders. Put them on credit hold (Ops stops shipping)?`,
          context: { customer: c, invoice: inv },
          options: [
            { id: "hold", label: "credit hold" },
            { id: "keep", label: "keep shipping, keep chasing" },
          ],
          defaultChoice: c.health > 70 && c.weeklyKg >= 35 ? "keep" : "hold",
          defaultRationale: c.health > 70 && c.weeklyKg >= 35 ? "Healthy strategic account — don't disrupt supply" : "Limit exposure: stop shipping until paid",
        });
        if (verdict.choice === "hold")
          ctx.emit({
            type: "CREDIT_HOLD_SET",
            summary: `Credit hold on ${c.name} — Ops will pause shipments`,
            reason: verdict.rationale,
            brain: verdict.source,
            ref: { type: "customer", id: c.id },
            data: { customerId: c.id, on: true },
          });
      }
      if (overdue > 144 && !inv.writeOffEscalationId) {
        ctx.escalate(
          {
            to: "human",
            kind: "write_off",
            title: `Write off ${inv.id}: $${Math.round(inv.amount)} from ${c.name}?`,
            detail: `${overdue}h overdue, ${inv.reminders} reminders, customer ${c.status}.`,
            recommendation: c.status === "churned" ? "approve" : "reject",
            onExpiry: "reject",
            ref: { type: "invoice", id: inv.id },
            amount: inv.amount,
            labels: { approve: "Write off", reject: "Keep chasing" },
          },
          "Write-offs always need a human.",
        );
      }
    }
    for (const esc of ctx.decided("write_off")) {
      const inv = s.invoices[esc.ref!.id];
      if (esc.decision === "approve" && inv.status === "open")
        ctx.emit({
          type: "INVOICE_WRITTEN_OFF",
          summary: `Wrote off ${inv.id} ($${Math.round(inv.amount)})`,
          reason: `Approved by ${esc.resolvedBy}`,
          ref: { type: "invoice", id: inv.id },
          data: { invoiceId: inv.id, escalationId: esc.id },
        });
      else
        ctx.emit({
          type: "PAYMENT_REMINDER",
          summary: `Final notice to ${s.customers[inv.customerId].name} for ${inv.id}`,
          reason: "Write-off not approved — keep chasing",
          ref: { type: "invoice", id: inv.id },
          data: { invoiceId: inv.id, escalationId: esc.id },
        });
    }
    // Release holds once nothing is overdue.
    for (const c of Object.values(s.customers)) {
      if (!c.creditHold) continue;
      const stillOverdue = Object.values(s.invoices).some((i) => i.customerId === c.id && i.status === "open" && t > i.dueAt + 24);
      if (!stillOverdue)
        ctx.emit({
          type: "CREDIT_HOLD_SET",
          summary: `Released credit hold on ${c.name}`,
          reason: "Overdue balance cleared",
          ref: { type: "customer", id: c.id },
          data: { customerId: c.id, on: false },
        });
    }

    // 4. Margin guard (self-correction): tune the discount Sales may give alone.
    const trailing = trailingMargin(s.fin, s.finCheckpoints); // after today's invoices are in
    const marginNow = trailing.margin;
    if (trailing.revenue > 2500 && (p.pricingChangedAt === undefined || t - p.pricingChangedAt >= 24)) {
      if (marginNow < p.targetMargin - 0.02 && p.maxDiscount > 0.04) {
        const next = round2(Math.max(0.04, p.maxDiscount - 0.03));
        ctx.emit({
          type: "POLICY_CHANGED",
          summary: `Tightened Sales discount cap ${Math.round(p.maxDiscount * 100)}% → ${Math.round(next * 100)}%`,
          reason: `Self-correction: trailing 2-day margin ${(marginNow * 100).toFixed(1)}% is below target ${(p.targetMargin * 100).toFixed(0)}%.`,
          data: { changes: { maxDiscount: next, pricingChangedAt: t } },
        });
      } else if (marginNow > p.targetMargin + 0.03 && p.maxDiscount < DEFAULT_POLICY.maxDiscount) {
        const next = round2(Math.min(DEFAULT_POLICY.maxDiscount, p.maxDiscount + 0.03));
        ctx.emit({
          type: "POLICY_CHANGED",
          summary: `Restored Sales discount cap ${Math.round(p.maxDiscount * 100)}% → ${Math.round(next * 100)}%`,
          reason: `Margin ${(marginNow * 100).toFixed(1)}% back above target — restoring room to win deals.`,
          data: { changes: { maxDiscount: next, pricingChangedAt: t } },
        });
      }
    }

    // 5. Cash guard.
    if (s.cash < p.cashFloor) {
      if (p.overtimeAllowed)
        ctx.emit({
          type: "POLICY_CHANGED",
          summary: "Disallowed overtime to protect cash",
          reason: `Cash $${Math.round(s.cash)} below floor $${p.cashFloor}.`,
          data: { changes: { overtimeAllowed: false } },
        });
      const recent = Object.values(s.inbox).some((e) => e.kind === "cash_floor" && t - e.createdAt < 48);
      if (!recent)
        ctx.escalate(
          {
            to: "human",
            kind: "cash_floor",
            title: `Cash is $${Math.round(s.cash).toLocaleString()} — below the $${p.cashFloor.toLocaleString()} floor. Inject a $5,000 founder bridge?`,
            detail: `Agents have paused overtime. Receivables outstanding: $${Math.round(
              Object.values(s.invoices).filter((i) => i.status === "open").reduce((a, i) => a + i.amount, 0),
            ).toLocaleString()}. Financing is a human decision.`,
            recommendation: s.cash < p.cashFloor * 0.6 ? "approve" : "reject",
            onExpiry: "reject",
            amount: 5000,
            slaHours: 12,
            labels: { approve: "Inject $5,000", reject: "Wait for receivables" },
          },
          "Only a human can commit new capital.",
        );
    } else if (!p.overtimeAllowed && s.cash > p.cashFloor * 1.3) {
      ctx.emit({
        type: "POLICY_CHANGED",
        summary: "Re-allowed overtime",
        reason: `Cash recovered to $${Math.round(s.cash)}.`,
        data: { changes: { overtimeAllowed: true } },
      });
    }

    // 6. Covering for Ops: keep beans coming (within Ops' own PO limit).
    if (ctx.isCovering("ops")) {
      const incoming = Object.values(s.purchaseOrders).filter((po) => po.status === "placed" || po.status === "pending_approval").reduce((a, po) => a + po.kg, 0);
      if (s.inventory.greenKg + incoming < p.reorderPointKg) {
        const kg = Math.floor(p.opsPOLimit / SUPPLIERS.primary.pricePerKg / 50) * 50;
        const id = ctx.nextId("PO");
        ctx.emit({
          type: "PO_PLACED",
          summary: `(covering Ops) Ordered ${kg} kg green beans from ${SUPPLIERS.primary.name}`,
          reason: "Ops agent is down; Finance keeps the roaster supplied (capped at Ops' PO limit).",
          ref: { type: "po", id },
          data: {
            po: { id, supplier: "primary", kg, cost: round2(kg * SUPPLIERS.primary.pricePerKg), requestedAt: t, requestedBy: "finance", status: "placed", etaAt: t + SUPPLIERS.primary.leadHours },
          },
        });
      }
    }
  },
};

function decide(ctx: AgentContext, esc: Escalation, margin: number) {
  const s = ctx.state;
  const p = s.policy;
  if (esc.kind === "discount_approval") {
    const lead = s.leads[esc.ref!.id];
    const ok = esc.amount! <= p.financeDiscountAuthority && margin >= p.targetMargin - 0.05;
    ctx.emit({
      type: "ESCALATION_RESOLVED",
      summary: `${ok ? "Approved" : "Rejected"} ${Math.round(esc.amount! * 100)}% discount for ${lead.name}`,
      reason: ok
        ? `Within Finance authority; margin ${(margin * 100).toFixed(1)}% can absorb it.`
        : `Margin ${(margin * 100).toFixed(1)}% too thin for this discount.`,
      ref: esc.ref,
      data: { escalationId: esc.id, decision: ok ? "approve" : "reject", note: ok ? undefined : "margin too thin" },
    });
    if (ok)
      ctx.emit({
        type: "DISCOUNT_APPROVED",
        summary: `Discount ${Math.round(esc.amount! * 100)}% cleared for ${lead.name}`,
        reason: "Finance approval",
        ref: esc.ref,
        data: { leadId: lead.id, discount: esc.amount },
      });
  } else if (esc.kind === "po_approval") {
    const po = s.purchaseOrders[esc.ref!.id];
    const afterCash = s.cash - po.cost;
    const ok = po.cost <= p.financePOLimit && afterCash >= p.cashFloor * 0.5;
    ctx.emit({
      type: "ESCALATION_RESOLVED",
      summary: `${ok ? "Approved" : "Rejected"} ${po.id} ($${Math.round(po.cost)})`,
      reason: ok ? `Cash after purchase $${Math.round(afterCash)} stays above safety line.` : `Would leave only $${Math.round(afterCash)} cash.`,
      ref: esc.ref,
      data: { escalationId: esc.id, decision: ok ? "approve" : "reject", note: ok ? undefined : "insufficient cash" },
    });
    if (ok)
      ctx.emit({
        type: "PO_APPROVED",
        summary: `Placed ${po.id}: ${po.kg} kg from ${SUPPLIERS[po.supplier].name}`,
        reason: "Finance approval within authority",
        ref: esc.ref,
        data: { po: { ...po, etaAt: ctx.now + SUPPLIERS[po.supplier].leadHours }, escalationId: esc.id, approvedBy: "finance" },
      });
  }
}
