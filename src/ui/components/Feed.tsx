import { useMemo, useState } from "react";
import { DAY_NAMES, dayOf, hourOf, weekdayOf, type Actor, type SimEvent } from "../../engine";
import { ACTOR_STYLE } from "../theme";

const FILTERS: (Actor | "all")[] = ["all", "sales", "ops", "finance", "support", "human", "watchdog", "world"];
const HIGHLIGHT = new Set(["ESCALATION_RAISED", "ESCALATION_RESOLVED", "ESCALATION_EXPIRED", "AGENT_FAILED", "AGENT_DOWN_DETECTED", "COVERAGE_ASSIGNED", "AGENT_RECOVERY_DETECTED", "POLICY_CHANGED", "OVERTIME_SET", "PO_CANCELLED", "GUARD_BLOCKED", "CUSTOMER_CHURNED", "DEAL_WON"]);

export function Feed({ events }: { events: SimEvent[] }) {
  const [filter, setFilter] = useState<Actor | "all">("all");
  const [showRoutine, setShowRoutine] = useState(false);
  const [onlyKey, setOnlyKey] = useState(false);

  const shown = useMemo(() => {
    const out: SimEvent[] = [];
    for (let i = events.length - 1; i >= 0 && out.length < 250; i--) {
      const e = events[i];
      if (e.type === "HEARTBEAT" && !showRoutine) continue;
      if (!showRoutine && (e.type === "ROAST_BATCH" || e.type === "DAY_CLOSED")) continue;
      if (filter !== "all" && e.actor !== filter) continue;
      if (onlyKey && !HIGHLIGHT.has(e.type)) continue;
      out.push(e);
    }
    return out;
    // events is an append-only array mutated in place → length is part of the key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, events.length, filter, showRoutine, onlyKey]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex flex-wrap items-center gap-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`chip border ${filter === f ? "border-white/30 bg-white/15 text-white" : "border-white/10 text-slate-400 hover:text-slate-200"}`}
          >
            {f === "all" ? "all" : `${ACTOR_STYLE[f].icon} ${ACTOR_STYLE[f].label}`}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1 text-[10px] text-slate-400">
          <input type="checkbox" checked={onlyKey} onChange={(e) => setOnlyKey(e.target.checked)} /> key moments
        </label>
        <label className="flex items-center gap-1 text-[10px] text-slate-400">
          <input type="checkbox" checked={showRoutine} onChange={(e) => setShowRoutine(e.target.checked)} /> routine
        </label>
      </div>
      <div className="scroll-thin min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {shown.length === 0 && <div className="py-10 text-center text-xs text-slate-500">Nothing yet — start the clock.</div>}
        {shown.map((e) => {
          const st = ACTOR_STYLE[e.actor];
          const key = HIGHLIGHT.has(e.type);
          const human = e.type === "ESCALATION_RAISED" && e.data.escalation?.to === "human";
          return (
            <div
              key={e.seq}
              className={`slidein rounded-lg border px-2.5 py-1.5 ${
                human ? "border-rose-400/40 bg-rose-400/[0.07]" : e.type === "GUARD_BLOCKED" ? "border-red-500/40 bg-red-500/10" : key ? "border-white/10 bg-white/[0.04]" : "border-transparent"
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="w-[62px] shrink-0 pt-0.5 font-mono text-[10px] text-slate-500">
                  D{dayOf(e.tick) + 1} {DAY_NAMES[weekdayOf(e.tick)].slice(0, 2)} {String(hourOf(e.tick)).padStart(2, "0")}h
                </span>
                <span className={`chip shrink-0 ${st.bg} ${st.text}`}>
                  {st.icon} {st.label}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] leading-snug text-slate-100">
                    {e.summary}
                    {e.brain === "llm" && <span className="chip ml-1.5 bg-fuchsia-400/20 text-fuchsia-200">LLM judgement</span>}
                  </div>
                  {e.reason && <div className="text-[11px] leading-snug text-slate-400">↳ {e.reason}</div>}
                </div>
                <span className="hidden shrink-0 font-mono text-[9px] text-slate-600 sm:block">
                  #{e.seq} {e.type}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
