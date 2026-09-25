import { SCENARIOS, fmtTick, getScenario } from "../../engine";
import type { SimHandle } from "../useSimulation";

const SPEEDS = [
  { v: 2, label: "2h/s" },
  { v: 6, label: "6h/s" },
  { v: 12, label: "12h/s" },
  { v: 30, label: "30h/s" },
];

export function Header({ h, onOpenSettings }: { h: SimHandle; onOpenSettings: () => void }) {
  const { sim, view } = h;
  const sc = getScenario(h.scenarioId);
  const progress = Math.min(1, sim.now / sim.endTick);
  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#0b0f17]/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-700 text-lg shadow-lg shadow-orange-900/40">☕</div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-bold text-white">Ember Roasting Co.</div>
            <div className="truncate text-[11px] text-slate-400">an autonomous company · 4 accountable agents · 1 shared record system</div>
          </div>
        </div>

        <select
          value={h.scenarioId}
          onChange={(e) => h.setScenario(e.target.value)}
          className="rounded-lg border border-white/10 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-amber-400/50"
          aria-label="Scenario"
        >
          {SCENARIOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1.5">
          {h.playing ? (
            <button className="btn btn-primary" onClick={h.pause}>
              ⏸ Pause
            </button>
          ) : (
            <button className="btn btn-primary" onClick={h.play} disabled={sim.done}>
              ▶ {sim.now === 0 ? "Run the week" : "Resume"}
            </button>
          )}
          <button className="btn" onClick={() => h.step(1)} disabled={h.playing || sim.done} title="Advance one simulated hour">
            +1h
          </button>
          <button className="btn" onClick={() => h.step(24 - (sim.now % 24))} disabled={h.playing || sim.done} title="Advance to end of day">
            +day
          </button>
          <button className="btn" onClick={h.reset} title="Restart the scenario from Monday 00:00">
            ↺
          </button>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
          {SPEEDS.map((s) => (
            <button
              key={s.v}
              onClick={() => h.setSpeed(s.v)}
              className={`rounded-md px-2 py-1 text-[11px] font-medium ${h.speed === s.v ? "bg-white/15 text-white" : "text-slate-400 hover:text-slate-200"}`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-300" title="Pause the clock whenever an agent escalates to you">
            <input type="checkbox" checked={h.pauseOnEscalation} onChange={(e) => h.setPauseOnEscalation(e.target.checked)} className="accent-rose-400" />
            Pause on escalation
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-300" title="OFF = naive baseline: agents ignore peer failures and outages aren't escalated (restarts the run)">
            <input type="checkbox" checked={h.compensation} onChange={(e) => h.setCompensation(e.target.checked)} className="accent-emerald-400" />
            Compensation
          </label>
          <button className="btn" onClick={onOpenSettings} title="Agent brain: rules or Claude">
            🧠 {h.llm.enabled && h.llm.apiKey ? `Claude (${h.llmCalls})` : "Rules"}
          </button>
          <div className="text-right leading-tight">
            <div className={`font-mono text-sm font-semibold ${view.isReplay ? "text-cyan-300" : "text-white"}`}>
              {view.isReplay ? `⏪ ${fmtTick(view.tick)}` : sim.done ? "Week complete" : fmtTick(sim.now)}
            </div>
            <div className="text-[10px] text-slate-500">
              {sc.tagline} · seed {sim.seed}
            </div>
          </div>
        </div>
      </div>
      <div className="h-0.5 w-full bg-white/5">
        <div className="h-full bg-gradient-to-r from-amber-500 to-rose-500 transition-all" style={{ width: `${progress * 100}%` }} />
      </div>
    </header>
  );
}
