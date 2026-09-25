import { OVERTIME_COST_PER_HOUR, round2 } from "./constants";
import type { CompanyState, Customer, Role, SimEvent } from "./types";
import { ROLES } from "./types";

/**
 * The ONLY place state changes. `state = fold(applyEvent, events)`.
 * Because every change is an event and this function is pure w.r.t. the log,
 * any moment of any run can be replayed exactly from the event log alone.
 */
export function applyEvent(state: CompanyState, e: SimEvent): CompanyState {
  if (e.type === "SIM_STARTED") {
    const fresh = structuredClone(e.data.initial) as CompanyState;
    fresh.tick = e.tick;
    fresh.seq = e.seq;
    return fresh;
  }

  const d = e.data;
  state.tick = e.tick;
  state.seq = e.seq;

  switch (e.type) {
    // ── control plane ──────────────────────────────────────────────────────
    case "AGENT_FAILED":
      state.agents[d.role as Role].online = false;
      break;
    case "AGENT_RESTORED":
      state.agents[d.role as Role].online = true;
      state.agents[d.role as Role].restartAttempts = 0;
      state.agents[d.role as Role].lastHeartbeat = e.tick;
      break;
    case "AGENT_DOWN_DETECTED": {
      const a = state.agents[d.role as Role];
      a.detectedDown = true;
      a.downSince = e.tick;
      break;
    }
    case "AGENT_RECOVERY_DETECTED": {
      const a = state.agents[d.role as Role];
      a.detectedDown = false;
      a.downSince = undefined;
      break;
    }
    case "COVERAGE_ASSIGNED": {
      const a = state.agents[d.by as Role];
      if (!a.covering.includes(d.role)) a.covering.push(d.role);
      break;
    }
    case "COVERAGE_ENDED":
      for (const r of ROLES) state.agents[r].covering = state.agents[r].covering.filter((x) => x !== d.role);
      break;
    case "RESTART_ATTEMPTED": {
      const a = state.agents[d.role as Role];
      a.restartAttempts += 1;
      if (d.success) {
        a.online = true;
        a.lastHeartbeat = e.tick;
      }
      break;
    }
    case "GUARD_BLOCKED":
      state.counters.guardBlocks += 1;
      break;

    // ── world ──────────────────────────────────────────────────────────────
    case "LEAD_ARRIVED":
      state.leads[d.lead.id] = { ...d.lead };
      break;
    case "LEAD_RESPONDED": {
      const l = state.leads[d.leadId];
      l.stage = d.accepted ? "accepted" : "lost";
      if (!d.accepted) {
        l.lostReason = d.reason;
        state.counters.leadsLost += 1;
      }
      break;
    }
    case "LEAD_WENT_COLD":
      state.leads[d.leadId].stage = "cold";
      state.counters.leadsCold += 1;
      break;
    case "ORDER_PLACED":
      state.orders[d.order.id] = { ...d.order };
      break;
    case "PAYMENT_RECEIVED": {
      const inv = state.invoices[d.invoiceId];
      inv.status = "paid";
      inv.paidAt = e.tick;
      state.cash += inv.amount;
      state.fin.cashIn += inv.amount;
      break;
    }
    case "SUPPLY_DELIVERED": {
      const po = state.purchaseOrders[d.poId];
      po.status = "received";
      po.receivedAt = e.tick;
      state.inventory.greenKg += po.kg;
      state.inventory.greenValue += po.cost;
      break;
    }
    case "TICKET_OPENED":
      state.tickets[d.ticket.id] = { ...d.ticket };
      if (d.ticket.orderId && state.orders[d.ticket.orderId]) state.orders[d.ticket.orderId].complained = true;
      touchHealth(state.customers[d.ticket.customerId], -(d.healthHit ?? 5));
      break;
    case "CUSTOMER_CHURNED": {
      const c = state.customers[d.customerId];
      c.status = "churned";
      c.churnedAt = e.tick;
      for (const o of Object.values(state.orders))
        if (o.customerId === c.id && o.status === "open") o.status = "cancelled";
      break;
    }
    case "DAY_CLOSED": {
      state.cash -= d.opex + d.agentRuntime;
      state.fin.opex += d.opex;
      state.fin.agentRuntime += d.agentRuntime;
      state.fin.cashOut += d.opex + d.agentRuntime;
      for (const [cid, delta] of Object.entries(d.healthDeltas as Record<string, number>))
        touchHealth(state.customers[cid], delta);
      state.finCheckpoints.push({ ...state.fin });
      break;
    }

    // ── sales ──────────────────────────────────────────────────────────────
    case "LEAD_ACKNOWLEDGED":
      state.leads[d.leadId].stage = "acknowledged";
      state.leads[d.leadId].acknowledgedAt = e.tick;
      break;
    case "LEAD_QUOTED": {
      const l = state.leads[d.leadId];
      l.stage = "quoted";
      l.quotedDiscount = d.discount;
      l.quotedAt = e.tick;
      break;
    }
    case "LEAD_PARKED":
      state.leads[d.leadId].stage = "parked";
      break;
    case "DEAL_WON": {
      const l = state.leads[d.leadId];
      l.stage = "won";
      l.customerId = d.customer.id;
      state.customers[d.customer.id] = { ...d.customer };
      state.counters.leadsWon += 1;
      break;
    }
    case "LEAD_LOST":
      state.leads[d.leadId].stage = "lost";
      state.leads[d.leadId].lostReason = d.reason;
      state.counters.leadsLost += 1;
      break;

    // ── ops ────────────────────────────────────────────────────────────────
    case "ROAST_BATCH": {
      const inv = state.inventory;
      const avg = inv.greenKg > 0 ? inv.greenValue / inv.greenKg : 0;
      inv.greenKg = round2(inv.greenKg - d.greenKg);
      inv.greenValue = round2(inv.greenValue - d.greenKg * avg);
      inv.roastedKg = round2(inv.roastedKg + d.roastedKg);
      inv.roastedValue = round2(inv.roastedValue + d.greenKg * avg);
      if (d.overtime) {
        state.cash -= OVERTIME_COST_PER_HOUR;
        state.fin.overtime += OVERTIME_COST_PER_HOUR;
        state.fin.cashOut += OVERTIME_COST_PER_HOUR;
      }
      break;
    }
    case "ORDER_SHIPPED": {
      const o = state.orders[d.orderId];
      const inv = state.inventory;
      const avg = inv.roastedKg > 0 ? inv.roastedValue / inv.roastedKg : 0;
      o.status = "shipped";
      o.shippedAt = e.tick;
      inv.roastedKg = round2(inv.roastedKg - o.kg);
      inv.roastedValue = round2(inv.roastedValue - o.kg * avg);
      state.fin.cogs += round2(o.kg * avg);
      const c = state.customers[o.customerId];
      if (e.tick > o.dueAt) {
        state.counters.shippedLate += 1;
        c.lateOrders += 1;
        touchHealth(c, o.notifiedLate ? -3 : -10);
      } else {
        state.counters.shippedOnTime += 1;
        touchHealth(c, 1);
      }
      break;
    }
    case "PO_REQUESTED":
      state.purchaseOrders[d.po.id] = { ...d.po };
      break;
    case "PO_PLACED":
    case "PO_APPROVED": {
      const existing = state.purchaseOrders[d.po.id];
      const po = existing ?? (state.purchaseOrders[d.po.id] = { ...d.po });
      po.status = "placed";
      po.placedAt = e.tick;
      po.etaAt = d.po.etaAt;
      po.approvedBy = d.approvedBy ?? e.actor;
      state.cash -= po.cost;
      state.fin.cashOut += po.cost;
      break;
    }
    case "PO_REJECTED":
      state.purchaseOrders[d.poId].status = "rejected";
      break;
    case "PO_CANCELLED": {
      const po = state.purchaseOrders[d.poId];
      if (po.status === "placed") {
        state.cash += po.cost; // supplier refunds the prepayment
        state.fin.cashOut -= po.cost;
      }
      po.status = "cancelled";
      break;
    }
    case "OVERTIME_SET":
      state.capacity.overtime = d.on;
      state.capacity.overtimeSince = d.on ? e.tick : undefined;
      break;

    // ── finance ────────────────────────────────────────────────────────────
    case "INVOICE_ISSUED":
      state.invoices[d.invoice.id] = { ...d.invoice };
      state.fin.revenue += d.invoice.amount;
      break;
    case "PAYMENT_REMINDER": {
      const inv = state.invoices[d.invoiceId];
      inv.remindedAt = e.tick;
      inv.reminders += 1;
      break;
    }
    case "CREDIT_HOLD_SET":
      state.customers[d.customerId].creditHold = d.on;
      break;
    case "DISCOUNT_APPROVED":
      state.leads[d.leadId].approvedDiscount = d.discount;
      break;
    case "INVOICE_WRITTEN_OFF": {
      const inv = state.invoices[d.invoiceId];
      inv.status = "written_off";
      state.fin.writeOffs += inv.amount;
      break;
    }

    // ── support ────────────────────────────────────────────────────────────
    case "TICKET_RESOLVED": {
      const t = state.tickets[d.ticketId];
      t.status = "resolved";
      t.resolvedAt = e.tick;
      t.resolvedBy = e.actor;
      t.credit = d.credit ?? 0;
      touchHealth(state.customers[t.customerId], 4);
      break;
    }
    case "CREDIT_ISSUED": {
      const c = state.customers[d.customerId];
      state.cash -= d.amount;
      state.fin.credits += d.amount;
      state.fin.cashOut += d.amount;
      c.creditsIssued += d.amount;
      touchHealth(c, 6);
      break;
    }
    case "CUSTOMER_CONTACTED": {
      const c = state.customers[d.customerId];
      touchHealth(c, d.healthGain ?? 3);
      if (d.retention) c.retentionOfferAt = e.tick;
      for (const oid of (d.orderIds as string[] | undefined) ?? []) state.orders[oid].notifiedLate = true;
      break;
    }
    case "RETENTION_OFFER": {
      const c = state.customers[d.customerId];
      c.discount = d.discount;
      c.pricePerKg = d.pricePerKg;
      c.retentionOfferAt = e.tick;
      touchHealth(c, 18);
      break;
    }

    // ── shared ─────────────────────────────────────────────────────────────
    case "POLICY_CHANGED":
      Object.assign(state.policy, d.changes);
      break;
    case "ESCALATION_RAISED": {
      const esc = d.escalation;
      state.inbox[esc.id] = { ...esc };
      if (esc.ref?.type === "lead") {
        state.leads[esc.ref.id].stage = "pending_approval";
        state.leads[esc.ref.id].escalationId = esc.id;
      }
      if (esc.ref?.type === "ticket") {
        state.tickets[esc.ref.id].status = "pending_approval";
        state.tickets[esc.ref.id].escalationId = esc.id;
      }
      if (esc.ref?.type === "po") state.purchaseOrders[esc.ref.id].escalationId = esc.id;
      if (esc.ref?.type === "invoice") state.invoices[esc.ref.id].writeOffEscalationId = esc.id;
      break;
    }
    case "ESCALATION_RESOLVED": {
      const esc = state.inbox[d.escalationId];
      esc.status = d.decision === "approve" ? "approved" : "rejected";
      esc.decision = d.decision;
      esc.resolvedAt = e.tick;
      esc.resolvedBy = e.actor;
      esc.note = d.note;
      break;
    }
    case "CAPACITY_EXPANDED":
      state.capacity.greenKgPerHour += d.extraGreenKgPerHour;
      state.capacity.extraDailyCost += d.extraDailyCost;
      break;
    case "CAPITAL_INJECTED":
      state.cash += d.amount;
      state.fin.capitalInjected += d.amount;
      break;
    case "ESCALATION_EXPIRED": {
      const esc = state.inbox[d.escalationId];
      esc.status = "expired";
      esc.decision = esc.onExpiry;
      esc.resolvedAt = e.tick;
      esc.resolvedBy = "system";
      break;
    }
  }

  // An agent acting on a decided escalation "consumes" it (so it is acted on once).
  if (d.escalationId && e.type !== "ESCALATION_RESOLVED" && e.type !== "ESCALATION_EXPIRED" && e.type !== "ESCALATION_RAISED") {
    const esc = state.inbox[d.escalationId];
    if (esc && esc.status !== "open") esc.consumed = true;
  }

  // Liveness bookkeeping: any event written by an agent is also a heartbeat.
  if ((ROLES as string[]).includes(e.actor)) {
    const a = state.agents[e.actor as Role];
    a.lastHeartbeat = e.tick;
    if (e.type !== "HEARTBEAT") {
      a.actionsTotal += 1;
      a.lastAction = e.summary;
      a.lastActionAt = e.tick;
    }
  }
  state.cash = round2(state.cash);
  return state;
}

export function touchHealth(c: Customer | undefined, delta: number) {
  if (!c || c.status === "churned") return;
  c.health = Math.max(0, Math.min(100, Math.round(c.health + delta)));
  if (c.health < 45) c.status = "at_risk";
  else if (c.health >= 55) c.status = "active";
}
