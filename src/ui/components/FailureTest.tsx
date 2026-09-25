import { useState } from "react";
import { SCENARIOS, Simulation, getScenario, money } from "../../engine";

interface Result {
  metric: string;
  on: number;
  off: number;
  better: "lower" | "higher";
  fmt: (n: number) => string;
}

const FAILURE_SCENARIOS = SCENARIOS.filter((s) => s.faults.length > 0);

export function FailureTest({ defaultScenario }: { defaultScenario: string }) {
  const [scenarioId, setScenarioId] = useState(FAILURE_SCENARIOS.some((s) => s.id === defaultScenario) ? defaultScenario : "ops-outage");
  const [seeds, setSeeds] = useState(20);
  const [progress, setProgress] = useState<number | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [churnRuns, setChurnRuns] = useState<{ on: number; off: number } | null>(null);

  const run = async () => {
    const scenario = getScenario(scenarioId);
    const acc = { on: [0, 0, 0, 0, 0, 0, 0], off: [0, 0, 0, 0, 0, 0, 0] };
    const churn = { on: 0, off: 0 };
    setResults(null);
    for (let seed = 1; seed <= seeds; seed++) {
      for (const comp of [true, false]) {
        const sim = new Simulation({ scenario, seed, compensation: comp });
        await sim.run();
        const k = sim.history[sim.history.length - 1];
        const m = [k.churned, Object.keys(sim.state.tickets).length, sim.state.counters.shippedLate, sim.state.fin.credits, Math.min(...sim.history.map((h) => h.avgHealth)), k.cash, k.mrr];
        const b = comp ? acc.on : acc.off;
        m.forEach((v, i) => (b[i] += v));
        if (k.churned > 0) churn[comp ? "on" : "off"]++;
      }
      setProgress(seed / seeds);
      await new Promise((r) => setTimeout(r, 0));
    }
    const avg = (arr: number[], i: number) => arr[i] / seeds;
    const names: [string, Result["better"], (n: number) => string][] = [
      ["Customers churned", "lower", (n) => n.toFixed(2)],
      ["Complaint tickets", "lower", (n) => n.toFixed(1)],
      ["Late shipments", "lower", (n) => n.toFixed(1)],
      ["Credits paid out", "lower", money],
      ["Lowest avg health", "higher", (n) => n.toFixed(1)],
      ["End-of-week cash", "higher", money],
      ["End-of-week MRR", "higher", money],
    ];
    setResults(names.map(([metric, better, fmt], i) => ({ metric, better, fmt, on: avg(acc.on, i), off: avg(acc.off, i) })));
    setChurnRuns(churn);
    setProgress(null);
  };

  return (
    <div className="space-y-3">
      <div className="panel p-3">
        <div className="panel-title mb-1">Failure test: one role goes off</div>
        <p className="text-[12px] leading-relaxed text-slate-400">
          Runs the same week twice per seed: <b className="text-emerald-300">compensated</b> (watchdog detects the outage from missing heartbeats, assigns coverage, peers adapt, the human is asked)
          vs <b className="text-orange-300">naive</b> (the crash still happens and auto-restarts still run, but nobody adapts or escalates). No human answers in either — defaults apply.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)} className="rounded-lg border border-white/10 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100">
            {FAILURE_SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <label className="text-[11px] text-slate-400">
            seeds{" "}
            <input type="number" min={1} max={100} value={seeds} onChange={(e) => setSeeds(Math.max(1, Math.min(100, Number(e.target.value))))} className="w-16 rounded-md border border-white/10 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100" />
          </label>
          <button className="btn btn-primary" onClick={run} disabled={progress !== null}>
            {progress !== null ? `Running… ${Math.round(progress * 100)}%` : `▶ Run ${seeds * 2} simulated weeks`}
          </button>
        </div>
      </div>

      {results && (
        <div className="panel p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-white">Average over {seeds} seeds</div>
            {churnRuns && (
              <div className="text-[11px] text-slate-400">
                runs with ≥1 churned customer: <b className="text-emerald-300">{churnRuns.on}</b> compensated vs <b className="text-orange-300">{churnRuns.off}</b> naive
              </div>
            )}
          </div>
          <div className="space-y-2.5">
            {results.map((r) => {
              const max = Math.max(Math.abs(r.on), Math.abs(r.off), 1e-9);
              const onWins = r.better === "lower" ? r.on < r.off - 1e-9 : r.on > r.off + 1e-9;
              const tie = Math.abs(r.on - r.off) < 1e-9;
              return (
                <div key={r.metric}>
                  <div className="mb-0.5 flex justify-between text-[11px]">
                    <span className="text-slate-300">
                      {r.metric} <span className="text-slate-500">({r.better} is better)</span>
                    </span>
                    <span className={tie ? "text-slate-500" : onWins ? "text-emerald-300" : "text-orange-300"}>{tie ? "no difference" : onWins ? "compensation wins" : "naive wins"}</span>
                  </div>
                  {(["on", "off"] as const).map((k) => (
                    <div key={k} className="flex items-center gap-2">
                      <span className="w-20 text-[10px] text-slate-500">{k === "on" ? "compensated" : "naive"}</span>
                      <div className="h-3 flex-1 overflow-hidden rounded bg-white/5">
                        <div className={`h-full rounded ${k === "on" ? "bg-emerald-400/70" : "bg-orange-400/70"}`} style={{ width: `${(Math.abs(r[k]) / max) * 100}%` }} />
                      </div>
                      <span className="w-20 text-right font-mono text-[11px] text-slate-200">{r.fmt(r[k])}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
            Honest reading: an Ops outage is on the critical path (nothing roasts or ships), so compensation mainly protects customers — fewer complaints, fewer credits, no churn — rather than
            on-time rate. Finance and Support outages are largely absorbed by time in this model: their work queues and catches up.
          </p>
        </div>
      )}
    </div>
  );
}
