import type { Policy, Tick } from "./types";

// ── Economics of Ember Roasting Co. ─────────────────────────────────────────
export const LIST_PRICE_PER_KG = 32; // roasted coffee, B2B
export const ROAST_YIELD = 0.85; // 1 kg green → 0.85 kg roasted
export const GREEN_KG_PER_HOUR = 8; // roaster throughput
export const OVERTIME_KG_PER_HOUR = 8;
export const OVERTIME_COST_PER_HOUR = 45;
export const DAILY_OPEX = 380; // rent, energy, one human founder's time
export const AGENT_COST_PER_ACTION = 0.04; // model + infra cost per agent action
export const STARTING_CASH = 15000;
export const ORDER_DUE_HOURS = 30; // next-day delivery promise

export const SUPPLIERS = {
  primary: { name: "Andes Green Co-op", pricePerKg: 8, leadHours: 40 },
  backup: { name: "PortSide Importers", pricePerKg: 11, leadHours: 14 },
} as const;

export const ROAST_HOURS = { start: 7, end: 17 }; // normal shift
export const OVERTIME_HOURS = { start: 17, end: 22 };
export const BUSINESS_HOURS = { start: 8, end: 19 };

export const DEFAULT_POLICY: Policy = {
  maxDiscount: 0.12,
  financeDiscountAuthority: 0.2,
  salesThrottle: false,
  overtimeAllowed: true,
  opsPOLimit: 2500,
  financePOLimit: 6000,
  supportCreditLimit: 100,
  cashFloor: 6000,
  targetMargin: 0.67,
  paymentTermsHours: 72,
  reorderPointKg: 220,
};

export const HEARTBEAT_EVERY = 3; // ticks
export const HEARTBEAT_TIMEOUT = 4; // ticks without heartbeat → watchdog declares agent down
export const ESCALATION_SLA_HOURS = 6;

// ── Time helpers ─────────────────────────────────────────────────────────────
export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const dayOf = (t: Tick) => Math.floor(t / 24);
export const hourOf = (t: Tick) => t % 24;
export const weekdayOf = (t: Tick) => dayOf(t) % 7;
export const isBusinessHour = (t: Tick) => hourOf(t) >= BUSINESS_HOURS.start && hourOf(t) < BUSINESS_HOURS.end;
export const fmtTick = (t: Tick) =>
  `Day ${dayOf(t) + 1} · ${DAY_NAMES[weekdayOf(t)]} ${String(hourOf(t)).padStart(2, "0")}:00`;

export const money = (n: number) =>
  (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString("en-US");

export const round2 = (n: number) => Math.round(n * 100) / 100;
