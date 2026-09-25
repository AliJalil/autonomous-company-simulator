/**
 * Headless runner.
 *   npm run sim                                   → baseline week
 *   npm run sim -- --scenario demand-spike
 *   npm run sim -- --scenario ops-outage --compare   (failure test: compensation ON vs OFF)
 *   npm run sim -- --scenario ops-outage --compare --seeds 30  (aggregate over 30 seeds)
 *   npm run sim -- --human recommend --log out.json
 */
import { writeFileSync } from "node:fs";
import { SCENARIOS, Simulation, getScenario, money, verifyReplay, type KpiSnapshot } from "../engine";

const args = process.argv.slice(2);
const arg = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const flag = (name: string) => args.includes(`--${name}`);

if (flag("list")) {
  for (const s of SCENARIOS) console.log(`${s.id.padEnd(16)} ${s.name}`);
  process.exit(0);
}

const scenario = getScenario(arg("scenario", "baseline")!);
const human = (arg("human", "none") as "none" | "recommend");

async function runOnce(compensation: boolean) {
  const sim = new Simulation({ scenario, compensation, humanPolicy: human });
  await sim.run();
  return sim;
}

function summary(k: KpiSnapshot) {
  return {
    cash: money(k.cash),
    revenue: money(k.revenue),
    costs: money(k.costs),
    margin: `${(k.grossMargin * 100).toFixed(1)}%`,
    onTime: `${(k.onTimeRate * 100).toFixed(1)}%`,
    backlogKg: k.backlogKg,
    lateOpen: k.lateOrders,
    customers: k.activeCustomers,
    atRisk: k.atRisk,
    churned: k.churned,
    avgHealth: k.avgHealth,
    mrr: money(k.mrr),
  };
}

async function aggregate(n: number) {
  const metrics = (sim: Simulation) => {
    const k = sim.history[sim.history.length - 1];
    return {
      "customers churned": k.churned,
      "complaint tickets": Object.keys(sim.state.tickets).length,
      "late shipments": sim.state.counters.shippedLate,
      "on-time %": k.onTimeRate * 100,
      "credits paid $": sim.state.fin.credits,
      "lowest avg health": Math.min(...sim.history.map((h) => h.avgHealth)),
      "end cash $": k.cash,
      "end MRR $": k.mrr,
    };
  };
  const sum = { on: {} as Record<string, number>, off: {} as Record<string, number> };
  let churnRunsOn = 0, churnRunsOff = 0;
  for (let seed = 1; seed <= n; seed++) {
    for (const comp of [true, false]) {
      const sim = new Simulation({ scenario, seed, compensation: comp, humanPolicy: human });
      await sim.run();
      const m = metrics(sim);
      const bucket = comp ? sum.on : sum.off;
      for (const [k, v] of Object.entries(m)) bucket[k] = (bucket[k] ?? 0) + v;
      if (m["customers churned"] > 0) comp ? churnRunsOn++ : churnRunsOff++;
    }
  }
  const rows: Record<string, { compensated: string; naive: string }> = {};
  for (const k of Object.keys(sum.on)) rows[`avg ${k}`] = { compensated: (sum.on[k] / n).toFixed(1), naive: (sum.off[k] / n).toFixed(1) };
  rows["runs with ≥1 churn"] = { compensated: `${churnRunsOn}/${n}`, naive: `${churnRunsOff}/${n}` };
  console.log(`\n🧪 FAILURE TEST over ${n} seeds — ${scenario.name}: compensation ON vs OFF`);
  console.table(rows);
}

const main = async () => {
  const seeds = arg("seeds");
  if (seeds) {
    await aggregate(Number(seeds));
    return;
  }
  console.log(`\n☕ Ember Roasting Co. — ${scenario.name}  (seed ${scenario.seed}, ${scenario.days} days, human=${human})\n`);
  const sim = await runOnce(true);
  const last = sim.history[sim.history.length - 1];
  const byActor: Record<string, number> = {};
  for (const e of sim.events) if (e.type !== "HEARTBEAT") byActor[e.actor] = (byActor[e.actor] ?? 0) + 1;
  const esc = Object.values(sim.state.inbox);
  console.table(summary(last));
  console.log("Events by actor:", byActor);
  console.log(
    `Escalations: ${esc.length} total · to human ${esc.filter((e) => e.to === "human").length} · peer (finance) ${esc.filter((e) => e.to === "finance").length} · expired ${esc.filter((e) => e.status === "expired").length}`,
  );
  console.log(`Guard blocks: ${sim.state.counters.guardBlocks}`);
  const v = verifyReplay(sim.events, sim.state);
  console.log(`Replay check: ${v.ok ? "✓" : "✗"} live=${v.live} rebuilt=${v.rebuilt} (${v.events} events)`);

  const interesting = ["OVERTIME_SET", "POLICY_CHANGED", "PO_CANCELLED", "AGENT_FAILED", "AGENT_DOWN_DETECTED", "COVERAGE_ASSIGNED", "RESTART_ATTEMPTED", "AGENT_RECOVERY_DETECTED", "ESCALATION_RAISED", "ESCALATION_EXPIRED", "GUARD_BLOCKED"];
  if (flag("verbose")) {
    console.log("\nKey moments:");
    for (const e of sim.events.filter((e) => interesting.includes(e.type)))
      console.log(`  t=${String(e.tick).padStart(3)} [${e.actor.padEnd(8)}] ${e.summary}${e.reason ? `  — ${e.reason}` : ""}`);
  }

  const log = arg("log");
  if (log) {
    writeFileSync(log, JSON.stringify({ scenario: scenario.id, seed: sim.seed, events: sim.events }, null, 1));
    console.log(`Event log written to ${log}`);
  }

  if (flag("compare")) {
    const naive = await runOnce(false);
    const a = summary(last);
    const b = summary(naive.history[naive.history.length - 1]);
    console.log(`\n🧪 FAILURE TEST — ${scenario.name}: compensation ON vs OFF`);
    const rows: Record<string, { compensated: unknown; naive: unknown }> = {};
    for (const k of Object.keys(a) as (keyof typeof a)[]) rows[k] = { compensated: a[k], naive: b[k] };
    rows["leads lost/cold"] = {
      compensated: sim.state.counters.leadsLost + sim.state.counters.leadsCold,
      naive: naive.state.counters.leadsLost + naive.state.counters.leadsCold,
    };
    rows["late shipments"] = { compensated: sim.state.counters.shippedLate, naive: naive.state.counters.shippedLate };
    rows["tickets opened"] = { compensated: Object.keys(sim.state.tickets).length, naive: Object.keys(naive.state.tickets).length };
    const worst = (h: KpiSnapshot[]) => ({
      minHealth: Math.min(...h.map((k) => k.avgHealth)),
      peakLate: Math.max(...h.map((k) => k.lateOrders)),
      peakTickets: Math.max(...h.map((k) => k.openTickets)),
    });
    const wa = worst(sim.history), wb = worst(naive.history);
    rows["lowest avg health"] = { compensated: wa.minHealth, naive: wb.minHealth };
    rows["peak late orders"] = { compensated: wa.peakLate, naive: wb.peakLate };
    rows["peak open tickets"] = { compensated: wa.peakTickets, naive: wb.peakTickets };
    rows["credits paid"] = { compensated: money(sim.state.fin.credits), naive: money(naive.state.fin.credits) };
    console.table(rows);
  }
};

main();
