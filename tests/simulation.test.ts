import { describe, expect, it } from "vitest";
import { ROLES, Simulation, getScenario, replay, verifyReplay } from "../src/engine";
import { check } from "../src/engine/guard";

const run = async (id: string, opts: Partial<ConstructorParameters<typeof Simulation>[0]> = {}) => {
  const sim = new Simulation({ scenario: getScenario(id), ...opts });
  await sim.run();
  return sim;
};

describe("shared state & replay", () => {
  it("is deterministic for the same seed", async () => {
    const a = await run("baseline");
    const b = await run("baseline");
    expect(a.events.length).toBe(b.events.length);
    expect(verifyReplay(a.events, b.state).ok).toBe(true);
  });

  it("rebuilds the exact live state from the event log alone", async () => {
    for (const id of ["baseline", "demand-spike", "ops-outage"]) {
      const sim = await run(id);
      expect(verifyReplay(sim.events, sim.state).ok).toBe(true);
    }
  });

  it("replays any single day (history matches live KPIs tick by tick)", async () => {
    const sim = await run("demand-spike");
    const endOfDay3 = 3 * 24 - 1;
    const { history } = replay(sim.events, endOfDay3);
    expect(history.length).toBe(endOfDay3 + 1);
    expect(history[endOfDay3]).toEqual(sim.history[endOfDay3]);
  });

  it("human decisions are part of the log and survive replay", async () => {
    const sim = new Simulation({ scenario: getScenario("baseline"), humanPolicy: "recommend" });
    await sim.run();
    expect(sim.events.some((e) => e.actor === "human")).toBe(true);
    expect(verifyReplay(sim.events, sim.state).ok).toBe(true);
  });
});

describe("real multi-agent loop", () => {
  it("has four distinct roles all writing to the same record system", async () => {
    const sim = await run("baseline");
    for (const r of ROLES) expect(sim.events.filter((e) => e.actor === r && e.type !== "HEARTBEAT").length).toBeGreaterThan(0);
  });

  it("guard blocks actions outside a role's ownership or authority", async () => {
    const sim = new Simulation({ scenario: getScenario("baseline") });
    await sim.run(12);
    expect(check(sim.state, { actor: "sales", type: "ORDER_SHIPPED", summary: "", data: { orderId: "x" } })).toMatch(/does not own/);
    expect(check(sim.state, { actor: "support", type: "CREDIT_ISSUED", summary: "", data: { customerId: "C-01", amount: 5000 } })).toMatch(/exceeds limit/);
    expect(check(sim.state, { actor: "sales", type: "POLICY_CHANGED", summary: "", data: { changes: { maxDiscount: 0.5 } } })).toMatch(/does not own/);
    expect(check(sim.state, { actor: "ops", type: "POLICY_CHANGED", summary: "", data: { changes: { maxDiscount: 0.5 } } })).toMatch(/may not change/);
  });
});

describe("self-correction without a human", () => {
  it("demand spike: overtime + sales throttle switch on AND back off with zero human events", async () => {
    const sim = await run("demand-spike");
    const types = sim.events.map((e) => `${e.type}:${JSON.stringify(e.data.on ?? e.data.changes?.salesThrottle)}`);
    expect(types).toContain("OVERTIME_SET:true");
    expect(types).toContain("OVERTIME_SET:false");
    expect(types).toContain("POLICY_CHANGED:true");
    expect(types).toContain("POLICY_CHANGED:false");
    expect(sim.events.some((e) => e.actor === "human")).toBe(false);
  });

  it("supplier delay: ops cancels the late PO and switches to the backup supplier", async () => {
    const sim = await run("supplier-delay");
    expect(sim.events.some((e) => e.type === "PO_CANCELLED")).toBe(true);
    expect(Object.values(sim.state.purchaseOrders).some((p) => p.supplier === "backup")).toBe(true);
  });
});

describe("failure test", () => {
  it("ops outage is detected, covered, escalated and recovered", async () => {
    const sim = await run("ops-outage");
    const t = sim.events.map((e) => e.type);
    expect(t).toContain("AGENT_FAILED");
    expect(t).toContain("AGENT_DOWN_DETECTED");
    expect(t).toContain("COVERAGE_ASSIGNED");
    expect(sim.events.some((e) => e.type === "ESCALATION_RAISED" && e.data.escalation.kind === "agent_down")).toBe(true);
    expect(t).toContain("AGENT_RECOVERY_DETECTED");
  });

  it("compensation beats the naive baseline on customer impact", async () => {
    const on = await run("ops-outage");
    const off = await run("ops-outage", { compensation: false });
    expect(Object.keys(on.state.tickets).length).toBeLessThan(Object.keys(off.state.tickets).length);
    expect(on.state.fin.credits).toBeLessThan(off.state.fin.credits);
  });

  it("a human restart ends the outage early", async () => {
    const sim = new Simulation({ scenario: getScenario("ops-outage") });
    while (!Object.values(sim.state.inbox).some((e) => e.kind === "agent_down")) await sim.step();
    const esc = Object.values(sim.state.inbox).find((e) => e.kind === "agent_down")!;
    sim.resolveEscalation(esc.id, "approve");
    expect(sim.state.agents.ops.online).toBe(true);
    await sim.run(3);
    expect(sim.state.agents.ops.detectedDown).toBe(false);
  });
});
