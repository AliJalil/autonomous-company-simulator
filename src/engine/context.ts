import type { Brain } from "./brain";
import type { Draft } from "./guard";
import type { Actor, CompanyState, Escalation, EscalationKind, Role, Scenario, SimEvent, Tick } from "./types";

/** What the engine exposes to the world model, the agents and the watchdog. */
export interface EngineApi {
  readonly state: CompanyState;
  readonly now: Tick;
  readonly seed: number;
  readonly scenario: Scenario;
  readonly brain: Brain;
  /** When false, agents ignore peer failures (used by the failure-test baseline). */
  readonly compensation: boolean;
  /** Validate against the guard, append to the log, apply to shared state. */
  commit(actor: Actor, draft: Omit<Draft, "actor">): SimEvent | null;
  nextId(prefix: string): string;
  actionsToday(): number;
}

/** Per-agent view: the shared record system + a scoped way to write to it. */
export class AgentContext {
  constructor(
    private api: EngineApi,
    public readonly role: Role,
  ) {}

  get state() {
    return this.api.state;
  }
  get now() {
    return this.api.now;
  }
  get brain() {
    return this.api.brain;
  }
  get seed() {
    return this.api.seed;
  }
  get compensation() {
    return this.api.compensation;
  }

  emit(draft: Omit<Draft, "actor">) {
    return this.api.commit(this.role, draft);
  }
  nextId(prefix: string) {
    return this.api.nextId(prefix);
  }

  /** Peers learn about failures ONLY through the shared status record the watchdog writes. */
  peerDown(role: Role): boolean {
    return this.api.compensation && this.state.agents[role].detectedDown;
  }
  isCovering(role: Role): boolean {
    return this.state.agents[this.role].covering.includes(role);
  }

  /** Decided escalations raised by me that I haven't acted on yet. */
  decided(kind: EscalationKind): Escalation[] {
    return Object.values(this.state.inbox).filter((e) => e.from === this.role && e.kind === kind && e.status !== "open" && !e.consumed);
  }

  escalate(e: Omit<Escalation, "id" | "from" | "createdAt" | "status" | "slaAt"> & { slaHours?: number }, reason: string) {
    const id = this.nextId("E");
    const esc: Escalation = {
      ...e,
      id,
      from: this.role,
      createdAt: this.now,
      slaAt: this.now + (e.slaHours ?? 6),
      status: "open",
    };
    delete (esc as { slaHours?: number }).slaHours;
    return this.emit({
      type: "ESCALATION_RAISED",
      summary: `Escalated to ${e.to === "human" ? "HUMAN" : e.to}: ${e.title}`,
      reason,
      ref: e.ref,
      data: { escalation: esc },
    });
  }
}

export interface Agent {
  role: Role;
  title: string;
  mandate: string;
  owns: string[];
  act(ctx: AgentContext): Promise<void>;
}
