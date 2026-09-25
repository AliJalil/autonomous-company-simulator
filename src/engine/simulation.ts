import { FinanceAgent } from "./agents/finance";
import { OpsAgent } from "./agents/ops";
import { SalesAgent } from "./agents/sales";
import { SupportAgent } from "./agents/support";
import { RuleBrain, type Brain } from "./brain";
import { HEARTBEAT_EVERY, dayOf } from "./constants";
import { AgentContext, type Agent, type EngineApi } from "./context";
import { check, type Draft } from "./guard";
import { computeKpis } from "./kpis";
import { applyEvent } from "./reducer";
import type { Actor, CompanyState, Fault, KpiSnapshot, Role, Scenario, SimEvent, Tick } from "./types";
import { ROLES } from "./types";
import { runWatchdog } from "./watchdog";
import { createInitialState, runWorld } from "./world";

export const AGENTS: Record<Role, Agent> = {
  sales: SalesAgent,
  ops: OpsAgent,
  finance: FinanceAgent,
  support: SupportAgent,
};
/** Fixed, documented execution order inside a tick (makes runs reproducible). */
export const AGENT_ORDER: Role[] = ["ops", "sales", "support", "finance"];

export interface SimOptions {
  scenario: Scenario;
  seed?: number;
  brain?: Brain;
  /** false = failure-test baseline: nobody compensates, nobody escalates outages. */
  compensation?: boolean;
  /** "recommend" = a simulated human accepts every recommendation after 2h (for headless runs). */
  humanPolicy?: "none" | "recommend";
}

export class Simulation implements EngineApi {
  state!: CompanyState;
  events: SimEvent[] = [];
  history: KpiSnapshot[] = [];
  now: Tick = 0;
  readonly seed: number;
  readonly scenario: Scenario;
  brain: Brain;
  readonly compensation: boolean;
  humanPolicy: "none" | "recommend";
  faults: Fault[];
  private listeners = new Set<() => void>();
  private busy = false;

  constructor(opts: SimOptions) {
    this.scenario = opts.scenario;
    this.seed = opts.seed ?? opts.scenario.seed;
    this.brain = opts.brain ?? RuleBrain;
    this.compensation = opts.compensation ?? true;
    this.humanPolicy = opts.humanPolicy ?? "none";
    this.faults = opts.scenario.faults.map((f) => ({ ...f }));
    const initial = createInitialState(this.seed, this.scenario);
    this.state = initial;
    this.commit("system", {
      type: "SIM_STARTED",
      summary: `Simulation started: ${this.scenario.name} (seed ${this.seed})`,
      data: { initial: structuredClone(initial), scenarioId: this.scenario.id, seed: this.seed, compensation: this.compensation },
    });
  }

  get endTick() {
    return this.scenario.days * 24;
  }
  get done() {
    return this.now >= this.endTick;
  }

  // ── Writing to the shared record system ────────────────────────────────────
  commit(actor: Actor, draft: Omit<Draft, "actor">): SimEvent | null {
    const full: Draft = { ...draft, actor };
    const blocked = draft.type === "SIM_STARTED" ? null : check(this.state, full);
    if (blocked) {
      const ev: SimEvent = {
        seq: this.state.seq + 1,
        tick: this.now,
        actor: "system",
        type: "GUARD_BLOCKED",
        summary: `Blocked ${actor}: ${draft.summary}`,
        reason: blocked,
        ref: draft.ref,
        data: { attemptedBy: actor, attempted: draft.type },
      };
      this.append(ev);
      return null;
    }
    const ev: SimEvent = { seq: this.state.seq + 1, tick: this.now, ...full };
    this.append(ev);
    return ev;
  }

  private append(ev: SimEvent) {
    this.events.push(ev);
    this.state = applyEvent(this.state, ev);
  }

  private idCounters = new Map<string, number>([["C", 12]]);
  /** Per-type counters (L-1, O-7, INV-3 …) so ids don't shift when unrelated events are added. */
  nextId(prefix: string) {
    const n = (this.idCounters.get(prefix) ?? 0) + 1;
    this.idCounters.set(prefix, n);
    return `${prefix}-${n}`;
  }

  actionsToday() {
    const day = dayOf(this.now);
    let n = 0;
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      if (dayOf(e.tick) !== day) break;
      if ((ROLES as string[]).includes(e.actor) && e.type !== "HEARTBEAT") n++;
    }
    return n;
  }

  // ── One simulated hour ─────────────────────────────────────────────────────
  async step(): Promise<void> {
    if (this.done || this.busy) return;
    this.busy = true;
    try {
      const t = this.now;

      // a) injected faults (chaos)
      for (const f of this.faults)
        if (f.atTick === t && this.state.agents[f.role].online)
          this.commit("system", { type: "AGENT_FAILED", summary: `💥 ${AGENTS[f.role].title} agent crashed`, reason: "Fault injection (scenario)", data: { role: f.role } });

      // b) the world moves
      runWorld(this);

      // c) human-in-the-loop SLAs
      if (this.humanPolicy === "recommend") {
        for (const esc of Object.values(this.state.inbox))
          if (esc.status === "open" && esc.to === "human" && t - esc.createdAt >= 2) this.resolveEscalation(esc.id, esc.recommendation, "simulated human (follows recommendation)");
      }
      for (const esc of Object.values(this.state.inbox))
        if (esc.status === "open" && t >= esc.slaAt)
          this.commit("system", {
            type: "ESCALATION_EXPIRED",
            summary: `No decision on "${esc.title}" within SLA → safe default: ${esc.onExpiry}`,
            reason: `SLA ${esc.slaAt - esc.createdAt}h elapsed`,
            ref: esc.ref,
            data: { escalationId: esc.id },
          });

      // d) agents act on the shared state, in a fixed order
      for (const role of AGENT_ORDER) {
        if (!this.state.agents[role].online) continue;
        const ctx = new AgentContext(this, role);
        await AGENTS[role].act(ctx);
        if (t - this.state.agents[role].lastHeartbeat >= HEARTBEAT_EVERY)
          this.commit(role, { type: "HEARTBEAT", summary: `${AGENTS[role].title} heartbeat`, data: {} });
      }

      // e) control plane
      runWatchdog(this, this.faults);

      this.history.push(computeKpis(this.state, t));
      this.now = t + 1;
    } finally {
      this.busy = false;
    }
    this.emitChange();
  }

  async run(ticks = Infinity) {
    for (let i = 0; i < ticks && !this.done; i++) await this.step();
  }

  // ── Human actions (all go through the same guarded record system) ─────────
  resolveEscalation(id: string, decision: "approve" | "reject", note?: string) {
    const esc = this.state.inbox[id];
    if (!esc || esc.status !== "open") return;
    const ok = this.commit("human", {
      type: "ESCALATION_RESOLVED",
      summary: `Human ${decision === "approve" ? "approved" : "rejected"}: ${esc.title}`,
      reason: note,
      ref: esc.ref,
      data: { escalationId: id, decision, note },
    });
    if (ok && decision === "approve") {
      if (esc.kind === "agent_down" && esc.ref) {
        const role = esc.ref.id as Role;
        if (!this.state.agents[role].online)
          this.commit("human", { type: "AGENT_RESTORED", summary: `Human restarted the ${AGENTS[role].title} agent`, data: { role, escalationId: id } });
      }
      if (esc.kind === "capacity_expansion")
        this.commit("human", {
          type: "CAPACITY_EXPANDED",
          summary: "Human approved a second roaster shift (+3 kg/h, +$110/day)",
          data: { extraGreenKgPerHour: 3, extraDailyCost: 110, escalationId: id },
        });
      if (esc.kind === "cash_floor")
        this.commit("human", { type: "CAPITAL_INJECTED", summary: `Founder injected $${esc.amount?.toLocaleString()}`, data: { amount: esc.amount, escalationId: id } });
    }
    this.emitChange();
  }

  /** Chaos / kill switch from the UI. */
  setAgentOnline(role: Role, online: boolean) {
    if (online === this.state.agents[role].online) return;
    if (!online) {
      this.faults.push({ role, atTick: this.now, recoverableAfter: Number.POSITIVE_INFINITY });
      this.commit("human", { type: "AGENT_FAILED", summary: `💥 ${AGENTS[role].title} agent killed from control panel`, reason: "Manual failure test", data: { role } });
    } else {
      this.commit("human", { type: "AGENT_RESTORED", summary: `Human restarted the ${AGENTS[role].title} agent`, data: { role } });
    }
    this.emitChange();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emitChange() {
    for (const fn of this.listeners) fn();
  }
}
