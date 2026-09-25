import type { Scenario } from "./types";

const H = (day: number, hour: number) => (day - 1) * 24 + hour; // Day 1 = Monday

export const SCENARIOS: Scenario[] = [
  {
    id: "baseline",
    name: "A normal week",
    tagline: "The company runs itself",
    description: "Leads come in, orders get roasted and shipped, invoices go out, cash comes back. Watch the agents hand work to each other through the shared records — and the few decisions they push to you.",
    seed: 16,
    days: 7,
    faults: [],
    watchFor: [
      "Sales → Finance peer approvals for discounts above Sales' 12% authority",
      "Ops ordering beans on its own below $2,500, asking Finance above it",
      "Human inbox: credits and pricing exceptions only a person may grant",
    ],
  },
  {
    id: "demand-spike",
    name: "Demand spike",
    tagline: "Self-correction without a human",
    description: "A city coffee festival floods Ember with rush orders on Tue–Wed while a trade-show brings a wave of leads. Nobody tells the agents what to do.",
    seed: 7,
    days: 7,
    faults: [],
    demandSpike: { fromTick: H(2, 9), toTick: H(3, 19), extraOrders: 4 },
    leadSurge: { fromTick: H(2, 8), toTick: H(4, 19), perDay: 3 },
    watchFor: [
      "Ops starts an overtime shift when backlog > 1.1 days of roasting",
      "Ops flips the shared `salesThrottle` flag → Sales waitlists new deals",
      "Finance sees margin dip from overtime and tightens the discount cap",
      "Backlog recovers, Ops releases the throttle, Sales un-parks deals — all without you",
    ],
  },
  {
    id: "supplier-delay",
    name: "Supplier delay",
    tagline: "Self-correction on the supply side",
    description: "The primary green-bean co-op silently slips every delivery by 3 days. Stock is already low.",
    seed: 11,
    days: 7,
    faults: [],
    startGreenKg: 180,
    supplierDelay: { fromTick: 0, toTick: H(5, 0), extraHours: 72 },
    watchFor: [
      "Ops notices the PO is >6h past ETA, cancels it and re-orders from the backup supplier",
      "The backup costs more → Finance's margin guard reacts",
      "Roasting never fully stops",
    ],
  },
  {
    id: "ops-outage",
    name: "Failure test: Ops agent crashes",
    tagline: "One role goes off — the others compensate",
    description: "Tuesday 09:00 the Ops agent crashes and auto-restarts keep failing for ~2 days (unless you restart it). Nothing roasts or ships.",
    seed: 16,
    days: 7,
    faults: [{ role: "ops", atTick: H(2, 9), recoverableAfter: H(4, 9) }],
    watchFor: [
      "Watchdog marks Ops DOWN after 4 silent hours and assigns coverage",
      "Sales stops closing deals (can't confirm capacity) and waitlists them",
      "Support warns every customer with an order due in 24h (before they notice)",
      "Finance places bean re-orders within Ops' limit",
      "You get one escalation: restart manually, or stay degraded",
    ],
  },
  {
    id: "finance-outage",
    name: "Failure test: Finance agent crashes",
    tagline: "Money decisions route to the human",
    description: "Wednesday 08:00 the Finance agent crashes for ~30h. Nobody else may bill or approve spend.",
    seed: 16,
    days: 7,
    faults: [{ role: "finance", atTick: H(3, 8), recoverableAfter: H(4, 14) }],
    watchFor: [
      "Invoices queue up (revenue recognised late, cash lags) — honest limitation",
      "Ops' PO approvals and Sales' discount approvals route straight to your inbox",
      "Finance catches up on every un-invoiced shipment when it returns",
    ],
  },
  {
    id: "support-outage",
    name: "Failure test: Support agent crashes",
    tagline: "Sales covers critical tickets",
    description: "Thursday 08:00 Support crashes for a day. Tickets pile up.",
    seed: 16,
    days: 7,
    faults: [{ role: "support", atTick: H(4, 8), recoverableAfter: H(5, 10) }],
    watchFor: [
      "Sales (as account manager) resolves HIGH-severity tickets with half the credit authority",
      "Finance pauses dunning on customers with open tickets",
      "Low-severity tickets wait — and hurt health — until Support returns",
    ],
  },
];

export const getScenario = (id: string) => SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
