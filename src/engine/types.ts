// ─────────────────────────────────────────────────────────────────────────────
// Domain model for Ember Roasting Co. — a small B2B coffee roaster that runs
// as a loop of accountable agents over ONE shared, event-sourced record system.
// ─────────────────────────────────────────────────────────────────────────────

export type Role = "sales" | "ops" | "finance" | "support";
export const ROLES: Role[] = ["sales", "ops", "finance", "support"];

/** Everyone who can write to the record system. Every event names its actor. */
export type Actor = Role | "world" | "human" | "watchdog" | "system";

export type Tick = number; // 1 tick = 1 simulated hour. Tick 0 = Monday 00:00.

// ── Records ─────────────────────────────────────────────────────────────────

export interface Policy {
  /** Discount Sales may give on its own. Finance tightens/loosens this to protect margin. */
  maxDiscount: number;
  /** Discount Finance may approve for Sales. Anything above → human. */
  financeDiscountAuthority: number;
  /** Set by Ops when backlog exceeds capacity: Sales parks new deals instead of closing. */
  salesThrottle: boolean;
  /** Set by Finance: Ops may run overtime shifts (costly) only when true. */
  overtimeAllowed: boolean;
  /** PO value Ops may place without approval. */
  opsPOLimit: number;
  /** PO value Finance may approve. Anything above → human. */
  financePOLimit: number;
  /** Per-ticket credit Support may issue without approval. */
  supportCreditLimit: number;
  /** Finance escalates if cash is projected below this. */
  cashFloor: number;
  /** Finance targets this trailing gross margin. */
  targetMargin: number;
  /** Payment terms (hours). */
  paymentTermsHours: number;
  /** Ops re-orders green beans below this level (kg, incl. incoming). */
  reorderPointKg: number;
  /** When Finance last changed pricing policy (cool-down for the margin guard). */
  pricingChangedAt?: Tick;
}

export type LeadStage =
  | "new"
  | "acknowledged"
  | "quoted"
  | "pending_approval"
  | "accepted"
  | "won"
  | "lost"
  | "parked"
  | "cold";

export interface Lead {
  id: string;
  name: string;
  weeklyKg: number;
  askDiscount: number;
  createdAt: Tick;
  stage: LeadStage;
  quotedDiscount?: number;
  quotedAt?: Tick;
  acknowledgedAt?: Tick;
  escalationId?: string;
  approvedDiscount?: number;
  lostReason?: string;
  customerId?: string;
}

export type CustomerStatus = "active" | "at_risk" | "churned";

export interface Customer {
  id: string;
  name: string;
  weeklyKg: number;
  pricePerKg: number;
  discount: number;
  orderDay: number; // 0..4 (Mon..Fri)
  since: Tick;
  status: CustomerStatus;
  health: number; // 0..100
  reliability: number; // 0..1 (how reliably they pay on time)
  creditHold: boolean;
  lateOrders: number;
  creditsIssued: number;
  retentionOfferAt?: Tick;
  churnedAt?: Tick;
}

export type OrderStatus = "open" | "shipped" | "cancelled";

export interface Order {
  id: string;
  customerId: string;
  kg: number;
  createdAt: Tick;
  dueAt: Tick;
  status: OrderStatus;
  shippedAt?: Tick;
  notifiedLate?: boolean;
  complained?: boolean;
  spike?: boolean;
}

export type InvoiceStatus = "open" | "paid" | "written_off";

export interface Invoice {
  id: string;
  customerId: string;
  orderId: string;
  amount: number;
  issuedAt: Tick;
  dueAt: Tick;
  status: InvoiceStatus;
  remindedAt?: Tick;
  reminders: number;
  paidAt?: Tick;
  writeOffEscalationId?: string;
}

export type TicketKind = "late_delivery" | "quality" | "billing";

export interface Ticket {
  id: string;
  customerId: string;
  kind: TicketKind;
  severity: "low" | "high";
  openedAt: Tick;
  status: "open" | "pending_approval" | "resolved";
  resolvedAt?: Tick;
  resolvedBy?: Actor;
  credit?: number;
  orderId?: string;
  escalationId?: string;
}

export type Supplier = "primary" | "backup";

export interface PurchaseOrder {
  id: string;
  supplier: Supplier;
  kg: number;
  cost: number;
  requestedAt: Tick;
  requestedBy: Actor;
  status: "pending_approval" | "placed" | "received" | "rejected" | "cancelled";
  placedAt?: Tick;
  etaAt?: Tick;
  receivedAt?: Tick;
  approvedBy?: Actor;
  escalationId?: string;
}

export type EscalationKind =
  | "discount_approval"
  | "po_approval"
  | "credit_approval"
  | "write_off"
  | "retention_offer"
  | "cash_floor"
  | "capacity_expansion"
  | "agent_down";

export interface Escalation {
  id: string;
  from: Actor;
  /** Who is expected to decide: a peer agent with authority, or the human. */
  to: "finance" | "human";
  kind: EscalationKind;
  title: string;
  detail: string;
  recommendation: "approve" | "reject";
  onExpiry: "approve" | "reject";
  ref?: { type: string; id: string };
  amount?: number;
  createdAt: Tick;
  slaAt: Tick;
  status: "open" | "approved" | "rejected" | "expired";
  /** Final outcome (for expired escalations this is the safe default `onExpiry`). */
  decision?: "approve" | "reject";
  resolvedAt?: Tick;
  resolvedBy?: Actor;
  note?: string;
  consumed?: boolean;
  /** Button labels for the human inbox. */
  labels?: { approve: string; reject: string };
}

export interface AgentStatus {
  role: Role;
  /** Ground truth: is the process actually running? (fault injection flips this) */
  online: boolean;
  /** What the rest of the company KNOWS (written by the watchdog from heartbeats). */
  detectedDown: boolean;
  lastHeartbeat: Tick;
  actionsTotal: number;
  lastAction?: string;
  lastActionAt?: Tick;
  /** Roles whose duties this agent is covering right now. */
  covering: Role[];
  downSince?: Tick;
  restartAttempts: number;
}

export interface Financials {
  revenue: number; // recognised on invoice
  cogs: number; // beans shipped
  overtime: number;
  opex: number; // fixed daily costs
  agentRuntime: number; // compute cost of the agents themselves
  credits: number;
  writeOffs: number;
  cashIn: number;
  cashOut: number;
  capitalInjected: number;
}

export interface CompanyState {
  tick: Tick;
  seq: number;
  seed: number;
  scenarioId: string;
  cash: number;
  policy: Policy;
  inventory: { greenKg: number; greenValue: number; roastedKg: number; roastedValue: number };
  capacity: { greenKgPerHour: number; overtime: boolean; overtimeSince?: Tick; extraDailyCost: number };
  leads: Record<string, Lead>;
  customers: Record<string, Customer>;
  orders: Record<string, Order>;
  invoices: Record<string, Invoice>;
  tickets: Record<string, Ticket>;
  purchaseOrders: Record<string, PurchaseOrder>;
  inbox: Record<string, Escalation>;
  agents: Record<Role, AgentStatus>;
  fin: Financials;
  /** Copy of `fin` at every day close — lets agents compute trailing (not just cumulative) numbers. */
  finCheckpoints: Financials[];
  counters: { shippedOnTime: number; shippedLate: number; leadsWon: number; leadsLost: number; leadsCold: number; guardBlocks: number };
}

// ── Events ──────────────────────────────────────────────────────────────────

export type EventType =
  // lifecycle / control plane
  | "SIM_STARTED"
  | "AGENT_FAILED"
  | "AGENT_RESTORED"
  | "HEARTBEAT"
  | "AGENT_DOWN_DETECTED"
  | "AGENT_RECOVERY_DETECTED"
  | "COVERAGE_ASSIGNED"
  | "COVERAGE_ENDED"
  | "RESTART_ATTEMPTED"
  | "GUARD_BLOCKED"
  // world (customers, suppliers, market)
  | "LEAD_ARRIVED"
  | "LEAD_RESPONDED"
  | "LEAD_WENT_COLD"
  | "ORDER_PLACED"
  | "PAYMENT_RECEIVED"
  | "SUPPLY_DELIVERED"
  | "TICKET_OPENED"
  | "CUSTOMER_CHURNED"
  | "DAY_CLOSED"
  // sales
  | "LEAD_ACKNOWLEDGED"
  | "LEAD_QUOTED"
  | "LEAD_PARKED"
  | "DEAL_WON"
  | "LEAD_LOST"
  // ops
  | "ROAST_BATCH"
  | "ORDER_SHIPPED"
  | "PO_REQUESTED"
  | "PO_PLACED"
  | "PO_CANCELLED"
  | "OVERTIME_SET"
  // finance
  | "INVOICE_ISSUED"
  | "PAYMENT_REMINDER"
  | "CREDIT_HOLD_SET"
  | "PO_APPROVED"
  | "PO_REJECTED"
  | "DISCOUNT_APPROVED"
  | "INVOICE_WRITTEN_OFF"
  // support
  | "TICKET_RESOLVED"
  | "CREDIT_ISSUED"
  | "CUSTOMER_CONTACTED"
  | "RETENTION_OFFER"
  // shared
  | "POLICY_CHANGED"
  | "ESCALATION_RAISED"
  | "ESCALATION_RESOLVED"
  | "ESCALATION_EXPIRED"
  | "CAPITAL_INJECTED"
  | "CAPACITY_EXPANDED";

export interface SimEvent {
  seq: number;
  tick: Tick;
  actor: Actor;
  type: EventType;
  /** One-line, human readable: what happened. */
  summary: string;
  /** Accountability: why the actor did it (policy, signal, judgement). */
  reason?: string;
  /** Which record the event is about. */
  ref?: { type: string; id: string };
  /** seq of the event that triggered this one (causal chain). */
  causedBy?: number;
  /** Whether a judgement call was made by rules or an LLM. */
  brain?: "rules" | "llm";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
}

export interface KpiSnapshot {
  tick: Tick;
  cash: number;
  revenue: number;
  costs: number;
  grossMargin: number;
  backlogOrders: number;
  backlogKg: number;
  lateOrders: number;
  onTimeRate: number;
  activeCustomers: number;
  atRisk: number;
  churned: number;
  churnRate: number;
  mrr: number;
  avgHealth: number;
  openTickets: number;
  openEscalations: number;
  greenKg: number;
  roastedKg: number;
  maxDiscount: number;
}

// ── Scenarios ───────────────────────────────────────────────────────────────

export interface Fault {
  role: Role;
  atTick: Tick;
  /** Auto-restart by the watchdog only succeeds after this tick (a human restart always works). */
  recoverableAfter: Tick;
}

export interface Scenario {
  id: string;
  name: string;
  tagline: string;
  description: string;
  seed: number;
  days: number;
  faults: Fault[];
  demandSpike?: { fromTick: Tick; toTick: Tick; extraOrders: number };
  supplierDelay?: { fromTick: Tick; toTick: Tick; extraHours: number };
  leadSurge?: { fromTick: Tick; toTick: Tick; perDay: number };
  /** Optional override of starting green-bean stock (kg). */
  startGreenKg?: number;
  /** What the viewer should watch for. */
  watchFor: string[];
}
