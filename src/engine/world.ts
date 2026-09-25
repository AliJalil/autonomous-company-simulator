import {
  DAILY_OPEX,
  DEFAULT_POLICY,
  GREEN_KG_PER_HOUR,
  LIST_PRICE_PER_KG,
  ORDER_DUE_HOURS,
  STARTING_CASH,
  SUPPLIERS,
  AGENT_COST_PER_ACTION,
  dayOf,
  hourOf,
  isBusinessHour,
  round2,
  weekdayOf,
} from "./constants";
import type { EngineApi } from "./context";
import { chance, pick, rand, randInt } from "./rng";
import type { AgentStatus, CompanyState, Customer, Lead, Role, Scenario } from "./types";
import { ROLES } from "./types";

// ── Names ────────────────────────────────────────────────────────────────────
const A = ["Harbor", "Pinecrest", "Brightwell", "Copper", "Northgate", "Juniper", "Lantern", "Maple", "Summit", "Riverbend", "Oakline", "Bluebird", "Granite", "Willow", "Foundry", "Meridian", "Saffron", "Cobalt"];
const B = ["Café", "Coworking", "Dental", "Architects", "Law Group", "Bakery", "Studios", "Hotel", "Gym", "Bistro", "Labs", "Library", "Clinic", "Books", "Agency", "Kitchen"];

export function leadName(seed: number, key: string) {
  return `${pick(seed, key + ":a", A)} ${pick(seed, key + ":b", B)}`;
}

// ── Initial state ────────────────────────────────────────────────────────────
export function createInitialState(seed: number, scenario: Scenario): CompanyState {
  const customers: Record<string, Customer> = {};
  const sizes = [18, 25, 12, 40, 22, 15, 30, 10, 45, 20, 16, 28];
  sizes.forEach((kg, i) => {
    const id = `C-${String(i + 1).padStart(2, "0")}`;
    const discount = kg >= 40 ? 0.1 : kg >= 25 ? 0.05 : 0;
    customers[id] = {
      id,
      name: leadName(seed, `cust${i}`),
      weeklyKg: kg,
      pricePerKg: round2(LIST_PRICE_PER_KG * (1 - discount)),
      discount,
      orderDay: i % 5,
      since: -24 * randInt(seed, `since${i}`, 20, 400),
      status: i === 6 || i === 11 ? "at_risk" : "active",
      // Two accounts start the week unhappy (last month's late deliveries) — Support has to act.
      health: i === 6 ? 42 : i === 11 ? 28 : randInt(seed, `health${i}`, 62, 86),
      reliability: round2(0.6 + rand(seed, `rel${i}`) * 0.38),
      creditHold: false,
      lateOrders: 0,
      creditsIssued: 0,
    };
  });
  const agents = {} as Record<Role, AgentStatus>;
  for (const r of ROLES)
    agents[r] = { role: r, online: true, detectedDown: false, lastHeartbeat: 0, actionsTotal: 0, covering: [], restartAttempts: 0 };

  const greenKg = scenario.startGreenKg ?? 320;
  return {
    tick: 0,
    seq: 0,
    seed,
    scenarioId: scenario.id,
    cash: STARTING_CASH,
    policy: { ...DEFAULT_POLICY },
    inventory: { greenKg, greenValue: greenKg * SUPPLIERS.primary.pricePerKg, roastedKg: 70, roastedValue: round2((70 / 0.85) * SUPPLIERS.primary.pricePerKg) },
    capacity: { greenKgPerHour: GREEN_KG_PER_HOUR, overtime: false, extraDailyCost: 0 },
    leads: {},
    customers,
    orders: {},
    invoices: {},
    tickets: {},
    purchaseOrders: {},
    inbox: {},
    agents,
    fin: { revenue: 0, cogs: 0, overtime: 0, opex: 0, agentRuntime: 0, credits: 0, writeOffs: 0, cashIn: 0, cashOut: 0, capitalInjected: 0 },
    finCheckpoints: [],
    counters: { shippedOnTime: 0, shippedLate: 0, leadsWon: 0, leadsLost: 0, leadsCold: 0, guardBlocks: 0 },
  };
}

// ── The world: customers, prospects, suppliers. Not an agent — the environment. ──
export function runWorld(api: EngineApi) {
  const { state, seed, scenario } = api;
  const t = api.now;
  const h = hourOf(t);
  const wd = weekdayOf(t);

  // 1. Recurring orders from existing customers (weekday mornings).
  if (h === 9 && wd < 5) {
    for (const c of Object.values(state.customers)) {
      if (c.status === "churned" || c.orderDay !== wd) continue;
      const kg = Math.max(4, Math.round(c.weeklyKg * (0.85 + rand(seed, `ord:${c.id}:${dayOf(t)}`) * 0.3)));
      const id = api.nextId("O");
      api.commit("world", {
        type: "ORDER_PLACED",
        summary: `${c.name} ordered ${kg} kg`,
        ref: { type: "order", id },
        data: { order: { id, customerId: c.id, kg, createdAt: t, dueAt: t + ORDER_DUE_HOURS, status: "open" } },
      });
    }
  }

  // 1b. Demand spike: extra one-off orders (e.g. a local festival).
  const spike = scenario.demandSpike;
  if (spike && t >= spike.fromTick && t < spike.toTick && isBusinessHour(t)) {
    const perHour = spike.extraOrders / 11;
    if (chance(seed, `spike:${t}`, perHour)) {
      const pool = Object.values(state.customers).filter((c) => c.status !== "churned");
      const c = pick(seed, `spikec:${t}`, pool);
      const kg = randInt(seed, `spikekg:${t}`, 15, 35);
      const id = api.nextId("O");
      api.commit("world", {
        type: "ORDER_PLACED",
        summary: `${c.name} placed a rush order: ${kg} kg (festival demand)`,
        ref: { type: "order", id },
        data: { order: { id, customerId: c.id, kg, createdAt: t, dueAt: t + ORDER_DUE_HOURS, status: "open", spike: true } },
      });
    }
  }

  // 2. Inbound leads.
  if (isBusinessHour(t)) {
    let perDay = 1.2;
    const surge = scenario.leadSurge;
    if (surge && t >= surge.fromTick && t < surge.toTick) perDay += surge.perDay;
    if (chance(seed, `lead:${t}`, perDay / 11)) {
      const id = api.nextId("L");
      const big = chance(seed, `leadbig:${t}`, 0.3);
      const weeklyKg = big ? randInt(seed, `leadkg:${t}`, 35, 70) : randInt(seed, `leadkg:${t}`, 8, 30);
      const asks = chance(seed, `leadask:${t}`, 0.6);
      const askDiscount = asks ? round2((big ? 0.1 : 0.04) + rand(seed, `leadaskd:${t}`) * (big ? 0.2 : 0.12)) : 0;
      const lead: Lead = { id, name: leadName(seed, `lead:${t}`), weeklyKg, askDiscount, createdAt: t, stage: "new" };
      api.commit("world", {
        type: "LEAD_ARRIVED",
        summary: `New lead: ${lead.name} wants ${weeklyKg} kg/week${askDiscount ? `, asks ${(askDiscount * 100).toFixed(0)}% off` : ""}`,
        ref: { type: "lead", id },
        data: { lead },
      });
    }
  }

  // 3. Prospects respond to quotes; unattended leads go cold.
  for (const l of Object.values(state.leads)) {
    if (l.stage === "quoted" && l.quotedAt !== undefined) {
      const respondAt = l.quotedAt + randInt(seed, `resp:${l.id}`, 8, 26);
      if (t >= respondAt) {
        const q = l.quotedDiscount ?? 0;
        const p = l.askDiscount === 0 ? 0.72 : 0.28 + 0.52 * Math.min(1, q / l.askDiscount);
        const accepted = rand(seed, `accept:${l.id}`) < p;
        api.commit("world", {
          type: "LEAD_RESPONDED",
          summary: `${l.name} ${accepted ? "accepted" : "declined"} the quote (${(q * 100).toFixed(0)}% off)`,
          ref: { type: "lead", id: l.id },
          data: { leadId: l.id, accepted, reason: accepted ? undefined : q < l.askDiscount ? "price" : "timing" },
        });
      }
    }
    const age = t - l.createdAt;
    const coldAfter = l.stage === "new" ? 30 : l.stage === "acknowledged" ? 96 : l.stage === "parked" ? 110 : Infinity;
    if (age > coldAfter) {
      api.commit("world", {
        type: "LEAD_WENT_COLD",
        summary: `${l.name} went cold (${l.stage === "new" ? "no response in 30h" : "waited too long"})`,
        ref: { type: "lead", id: l.id },
        data: { leadId: l.id },
      });
    }
  }

  // 4. Customers pay invoices (reminders speed up late payers).
  for (const inv of Object.values(state.invoices)) {
    if (inv.status !== "open") continue;
    const c = state.customers[inv.customerId];
    const terms = state.policy.paymentTermsHours;
    let payAt = inv.issuedAt + Math.round(terms * (0.35 + rand(seed, `pay:${inv.id}`) * 0.75));
    if (rand(seed, `late:${inv.id}`) > c.reliability) payAt += 120;
    if (inv.remindedAt !== undefined && rand(seed, `remind:${inv.id}:${inv.reminders}`) < 0.7)
      payAt = Math.min(payAt, inv.remindedAt + randInt(seed, `rdelay:${inv.id}:${inv.reminders}`, 4, 30));
    if (c.status === "churned" && rand(seed, `churnpay:${inv.id}`) < 0.5) continue; // churned customers often stall
    if (t >= payAt) {
      api.commit("world", {
        type: "PAYMENT_RECEIVED",
        summary: `${c.name} paid ${inv.id} ($${Math.round(inv.amount)})`,
        ref: { type: "invoice", id: inv.id },
        data: { invoiceId: inv.id, amount: inv.amount },
      });
    }
  }

  // 5. Suppliers deliver (possibly late).
  for (const po of Object.values(state.purchaseOrders)) {
    if (po.status !== "placed" || po.etaAt === undefined) continue;
    let arrive = po.etaAt;
    const delay = scenario.supplierDelay;
    if (delay && po.supplier === "primary" && (po.placedAt ?? 0) >= delay.fromTick && (po.placedAt ?? 0) < delay.toTick) arrive += delay.extraHours;
    if (t >= arrive) {
      api.commit("world", {
        type: "SUPPLY_DELIVERED",
        summary: `${SUPPLIERS[po.supplier].name} delivered ${po.kg} kg green beans (${po.id})`,
        ref: { type: "po", id: po.id },
        data: { poId: po.id },
      });
    }
  }

  // 6. Customers complain.
  for (const o of Object.values(state.orders)) {
    if (o.status !== "open" || o.complained) continue;
    const c = state.customers[o.customerId];
    const patience = o.notifiedLate ? 30 : 3;
    if (t > o.dueAt + patience) {
      const id = api.nextId("T");
      api.commit("world", {
        type: "TICKET_OPENED",
        summary: `${c.name}: "Where is my coffee?" (${o.id} is ${t - o.dueAt}h late)`,
        ref: { type: "ticket", id },
        data: {
          ticket: { id, customerId: c.id, kind: "late_delivery", severity: c.weeklyKg >= 30 ? "high" : "low", openedAt: t, status: "open", orderId: o.id },
          healthHit: o.notifiedLate ? 3 : 7,
        },
      });
    }
  }
  if (isBusinessHour(t) && chance(seed, `quality:${t}`, 0.05)) {
    const pool = Object.values(state.customers).filter((c) => c.status !== "churned");
    const c = pick(seed, `qualityc:${t}`, pool);
    const id = api.nextId("T");
    const billing = chance(seed, `billing:${t}`, 0.3);
    api.commit("world", {
      type: "TICKET_OPENED",
      summary: billing ? `${c.name}: question about an invoice` : `${c.name}: "last batch tasted flat"`,
      ref: { type: "ticket", id },
      data: {
        ticket: { id, customerId: c.id, kind: billing ? "billing" : "quality", severity: chance(seed, `sev:${t}`, 0.3) ? "high" : "low", openedAt: t, status: "open" },
        healthHit: 4,
      },
    });
  }

  // 7. End of day: fixed costs, health drift, churn.
  if (h === 23) {
    const healthDeltas: Record<string, number> = {};
    for (const c of Object.values(state.customers)) {
      if (c.status === "churned") continue;
      const openTickets = Object.values(state.tickets).filter((tk) => tk.customerId === c.id && tk.status !== "resolved" && t - tk.openedAt > 20).length;
      const late = Object.values(state.orders).filter((o) => o.customerId === c.id && o.status === "open" && t > o.dueAt).length;
      const delta = -4 * openTickets - 5 * late + (openTickets + late === 0 && c.health < 74 ? 2 : 0);
      if (delta !== 0) healthDeltas[c.id] = delta;
    }
    const actions = api.actionsToday();
    const opex = DAILY_OPEX + state.capacity.extraDailyCost;
    api.commit("world", {
      type: "DAY_CLOSED",
      summary: `Day ${dayOf(t) + 1} closed · fixed costs $${opex} · agent runtime $${(actions * AGENT_COST_PER_ACTION).toFixed(2)} (${actions} actions)`,
      data: { opex, agentRuntime: round2(actions * AGENT_COST_PER_ACTION), healthDeltas },
    });
    for (const c of Object.values(state.customers)) {
      if (c.status === "churned") continue;
      const p = c.health < 40 ? Math.min(0.9, (40 - c.health) * 0.045) : 0; // 36 → 18%, 30 → 45%, 20 → 90%
      if (p > 0 && chance(seed, `churn:${c.id}:${dayOf(t)}`, p)) {
        api.commit("world", {
          type: "CUSTOMER_CHURNED",
          summary: `${c.name} cancelled their subscription (health ${c.health})`,
          ref: { type: "customer", id: c.id },
          data: { customerId: c.id },
        });
      }
    }
  }
}
