import { useEffect, useRef, useState } from "react";
import { DAY_NAMES, fmtTick, money, verifyReplay } from "../../engine";
import type { SimHandle } from "../useSimulation";

export function Timeline({ h }: { h: SimHandle }) {
  const { sim, view } = h;
  const last = Math.max(0, sim.now - 1);
  const days = sim.scenario.days;
  const [animDay, setAnimDay] = useState<number | null>(null);
  const [verify, setVerify] = useState<ReturnType<typeof verifyReplay> | null>(null);
  const timer = useRef<number | null>(null);
  const tick = view.isReplay ? view.tick : last;

  useEffect(() => {
    if (animDay === null) return;
    let t = animDay * 24;
    h.setReplayTick(t);
    timer.current = window.setInterval(() => {
      t += 1;
      const end = Math.min(animDay * 24 + 23, last);
      if (t > end) {
        window.clearInterval(timer.current!);
        setAnimDay(null);
        return;
      }
      h.setReplayTick(t);
    }, 120);
    return () => window.clearInterval(timer.current!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animDay]);

  const dayStats = Array.from({ length: days }, (_, d) => {
    const end = sim.history[Math.min(d * 24 + 23, sim.history.length - 1)];
    const start = d === 0 ? undefined : sim.history[d * 24 - 1];
    const done = sim.history.length > d * 24;
    const revenue = end && done ? end.revenue - (start?.revenue ?? 0) : 0;
    const incidents = sim.events.filter((e) => Math.floor(e.tick / 24) === d && (e.type === "AGENT_FAILED" || (e.type === "ESCALATION_RAISED" && e.data.escalation?.to === "human"))).length;
    return { d, done, revenue, incidents };
  });

  const exportLog = () => {
    const blob = new Blob([JSON.stringify({ scenario: sim.scenario.id, seed: sim.seed, compensation: sim.compensation, events: sim.events }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ember-${sim.scenario.id}-seed${sim.seed}-t${sim.now}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="panel p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="panel-title">⏪ Replay</div>
        <span className="text-[11px] text-slate-400">
          {view.isReplay ? (
            <>
              Viewing <b className="text-cyan-300">{fmtTick(view.tick)}</b> — rebuilt from {view.events.length} logged events, no agent re-run.
            </>
          ) : (
            "Scrub or pick a day. Replay folds the event log; it never re-runs agents or LLMs."
          )}
        </span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {view.isReplay && (
            <button className="btn !border-cyan-400/40 !text-cyan-200" onClick={() => h.setReplayTick(null)}>
              ● Back to live
            </button>
          )}
          <button className="btn" onClick={() => setVerify(verifyReplay(sim.events, sim.state))} disabled={sim.now === 0} title="Rebuild the whole company from the log and compare hashes with the live state">
            ✓ Verify replay
          </button>
          <button className="btn" onClick={exportLog} disabled={sim.now === 0}>
            ⤓ Export event log
          </button>
        </div>
      </div>
      {verify && (
        <div className={`mb-2 rounded-lg px-3 py-1.5 font-mono text-[11px] ${verify.ok ? "bg-emerald-400/10 text-emerald-300" : "bg-rose-400/10 text-rose-300"}`}>
          {verify.ok ? "✓ identical" : "✗ mismatch"} · live state hash {verify.live} · rebuilt from {verify.events} events {verify.rebuilt}
        </div>
      )}
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))` }}>
        {dayStats.map((s) => {
          const inDay = Math.floor(tick / 24) === s.d;
          return (
            <button
              key={s.d}
              disabled={!s.done}
              onClick={() => setAnimDay(s.d)}
              className={`rounded-md border px-1.5 py-1 text-left transition disabled:opacity-30 ${inDay ? "border-cyan-400/50 bg-cyan-400/10" : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.06]"}`}
              title={`Replay day ${s.d + 1}`}
            >
              <div className="flex items-center justify-between text-[10px] font-semibold text-slate-300">
                <span>
                  D{s.d + 1} {DAY_NAMES[s.d % 7]}
                </span>
                {s.incidents > 0 && <span className="text-rose-300">● {s.incidents}</span>}
              </div>
              <div className="font-mono text-[10px] text-slate-500">{s.done ? `+${money(s.revenue)}` : "—"}</div>
            </button>
          );
        })}
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(1, days * 24 - 1)}
        value={tick}
        onChange={(e) => {
          const t = Math.min(Number(e.target.value), last);
          h.setReplayTick(t >= last ? null : t);
        }}
        disabled={sim.now < 2}
        className="mt-2 w-full accent-cyan-400"
        aria-label="Replay position"
      />
    </div>
  );
}
