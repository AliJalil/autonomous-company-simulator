import type { Actor, CompanyState, EventType, Role, SimEvent } from "./types";
import { ROLES } from "./types";

/**
 * Accountability layer.
 *  1. Ownership: which actor may write which kind of record change.
 *  2. Authority: monetary / policy limits each role may act within.
 *  3. Coverage: a peer may perform a *subset* of a failed role's duties,
 *     but only while the watchdog has assigned it that coverage.
 * Anything outside these rules is rejected and logged as GUARD_BLOCKED —
 * it never reaches the shared record system.
 */

const W: Actor[] = ["world"];
export const OWNERSHIP: Record<EventType, Actor[]> = {
  SIM_STARTED: ["system"],
  AGENT_FAILED: ["system", "human"],
  AGENT_RESTORED: ["human"],
  HEARTBEAT: ROLES,
  AGENT_DOWN_DETECTED: ["watchdog"],
  AGENT_RECOVERY_DETECTED: ["watchdog"],
  COVERAGE_ASSIGNED: ["watchdog"],
  COVERAGE_ENDED: ["watchdog"],
  RESTART_ATTEMPTED: ["watchdog"],
  GUARD_BLOCKED: ["system"],

  LEAD_ARRIVED: W,
  LEAD_RESPONDED: W,
  LEAD_WENT_COLD: W,
  ORDER_PLACED: W,
  PAYMENT_RECEIVED: W,
  SUPPLY_DELIVERED: W,
  TICKET_OPENED: W,
  CUSTOMER_CHURNED: W,
  DAY_CLOSED: W,

  LEAD_ACKNOWLEDGED: ["sales"],
  LEAD_QUOTED: ["sales"],
  LEAD_PARKED: ["sales"],
  DEAL_WON: ["sales"],
  LEAD_LOST: ["sales"],

  ROAST_BATCH: ["ops"],
  ORDER_SHIPPED: ["ops"],
  PO_REQUESTED: ["ops"],
  PO_PLACED: ["ops"],
  PO_CANCELLED: ["ops"],
  OVERTIME_SET: ["ops"],

  INVOICE_ISSUED: ["finance"],
  PAYMENT_REMINDER: ["finance"],
  CREDIT_HOLD_SET: ["finance"],
  PO_APPROVED: ["finance"],
  PO_REJECTED: ["finance", "ops"],
  DISCOUNT_APPROVED: ["finance"],
  INVOICE_WRITTEN_OFF: ["finance"],

  TICKET_RESOLVED: ["support"],
  CREDIT_ISSUED: ["support"],
  CUSTOMER_CONTACTED: ["support"],
  RETENTION_OFFER: ["support"],

  POLICY_CHANGED: ["ops", "finance", "human"],
  ESCALATION_RAISED: [...ROLES, "watchdog"],
  ESCALATION_RESOLVED: ["human", "finance"],
  ESCALATION_EXPIRED: ["system"],
  CAPITAL_INJECTED: ["human"],
  CAPACITY_EXPANDED: ["human"],
};

/** Duties a peer may take over while covering for a failed role (degraded mode). */
export const COVERABLE: Record<Role, { by: Role; events: EventType[]; note: string }> = {
  sales: { by: "support", events: ["LEAD_ACKNOWLEDGED"], note: "Support keeps inbound leads warm (acknowledges) but cannot quote or discount." },
  ops: { by: "finance", events: ["PO_PLACED"], note: "Finance places bean re-orders so the roaster doesn't starve; nobody else may roast or ship." },
  finance: { by: "ops", events: [], note: "No one else may invoice or approve money — approvals route straight to the human inbox." },
  support: { by: "sales", events: ["TICKET_RESOLVED", "CREDIT_ISSUED", "CUSTOMER_CONTACTED"], note: "Sales (as account manager) handles high-severity tickets with half the credit limit." },
};

/** Which policy keys each actor may change. */
const POLICY_KEYS: Partial<Record<Actor, string[]>> = {
  ops: ["salesThrottle"],
  finance: ["maxDiscount", "overtimeAllowed", "pricingChangedAt"],
  human: ["*"],
};

function escalationApproved(state: CompanyState, id: string | undefined, minAmount = 0): boolean {
  if (!id) return false;
  const esc = state.inbox[id];
  return !!esc && esc.decision === "approve" && (esc.amount ?? Infinity) >= minAmount - 1e-9;
}

export type Draft = Omit<SimEvent, "seq" | "tick">;

/** Returns null when allowed, otherwise the reason it was blocked. */
export function check(state: CompanyState, ev: Draft): string | null {
  const owners = OWNERSHIP[ev.type];
  const d = ev.data;
  let viaCoverage = false;

  if (!owners.includes(ev.actor)) {
    // Is the actor covering a failed role that owns this event?
    const actor = ev.actor as Role;
    const coveringOk =
      (ROLES as string[]).includes(ev.actor) &&
      state.agents[actor].covering.some((r) => COVERABLE[r].by === actor && COVERABLE[r].events.includes(ev.type) && owners.includes(r));
    if (!coveringOk) return `${ev.actor} does not own ${ev.type}`;
    viaCoverage = true;
  }

  // An agent that is down cannot write anything (defence in depth).
  if ((ROLES as string[]).includes(ev.actor) && !state.agents[ev.actor as Role].online)
    return `${ev.actor} is offline`;

  const p = state.policy;
  switch (ev.type) {
    case "LEAD_QUOTED": {
      const lead = state.leads[d.leadId];
      if (d.discount <= p.maxDiscount + 1e-9) return null;
      if (lead?.approvedDiscount !== undefined && d.discount <= lead.approvedDiscount + 1e-9) return null;
      if (escalationApproved(state, d.escalationId, d.discount)) return null;
      return `discount ${(d.discount * 100).toFixed(0)}% exceeds Sales authority ${(p.maxDiscount * 100).toFixed(0)}%`;
    }
    case "DISCOUNT_APPROVED":
      if (d.discount > p.financeDiscountAuthority + 1e-9) return `discount above Finance authority`;
      return null;
    case "PO_PLACED": {
      if (viaCoverage && d.po.cost > p.opsPOLimit) return `covering role limited to ${p.opsPOLimit}`;
      if (d.po.cost <= p.opsPOLimit) return null;
      if (escalationApproved(state, d.escalationId)) return null;
      return `PO ${Math.round(d.po.cost)} exceeds Ops limit ${p.opsPOLimit}`;
    }
    case "PO_APPROVED":
      if (d.po.cost <= p.financePOLimit || escalationApproved(state, d.escalationId)) return null;
      return `PO above Finance authority`;
    case "CREDIT_ISSUED": {
      const limit = viaCoverage ? p.supportCreditLimit / 2 : p.supportCreditLimit;
      if (d.amount <= limit + 1e-9 || escalationApproved(state, d.escalationId)) return null;
      return `credit ${d.amount} exceeds limit ${limit}`;
    }
    case "RETENTION_OFFER":
      if (d.discount <= p.maxDiscount + 1e-9 || escalationApproved(state, d.escalationId)) return null;
      return `retention discount needs approval`;
    case "INVOICE_WRITTEN_OFF":
      return escalationApproved(state, d.escalationId) ? null : "write-offs always need a human";
    case "POLICY_CHANGED": {
      const allowed = POLICY_KEYS[ev.actor] ?? [];
      if (allowed.includes("*")) return null;
      const bad = Object.keys(d.changes).filter((k) => !allowed.includes(k));
      return bad.length ? `${ev.actor} may not change ${bad.join(", ")}` : null;
    }
    case "ESCALATION_RESOLVED": {
      const esc = state.inbox[d.escalationId];
      if (!esc || esc.status !== "open") return "escalation is not open";
      if (esc.to === "human" && ev.actor !== "human") return "only a human can resolve this";
      return null;
    }
  }
  return null;
}
