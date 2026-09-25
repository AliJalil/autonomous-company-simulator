import { AGENTS, AGENT_ORDER, COVERABLE, fmtTick, type CompanyState, type Role } from "../../engine";
import { ACTOR_STYLE, ROLE_AUTHORITY } from "../theme";

export function AgentsPanel({
  state,
  now,
  readOnly,
  onToggle,
}: {
  state: CompanyState;
  now: number;
  readOnly: boolean;
  onToggle: (role: Role, online: boolean) => void;
}) {
  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="panel-title">Agent roles</div>
        <div className="text-[10px] text-slate-500">kill one to run a failure test</div>
      </div>
      <div className="space-y-2">
        {AGENT_ORDER.map((role) => {
          const a = state.agents[role];
          const def = AGENTS[role];
          const st = ACTOR_STYLE[role];
          const status = !a.online && !a.detectedDown ? "crashed" : a.detectedDown ? "down" : a.covering.length ? "covering" : "online";
          const pill = {
            online: "bg-emerald-400/15 text-emerald-300",
            covering: "bg-cyan-400/15 text-cyan-300",
            crashed: "bg-rose-500/20 text-rose-300 animate-pulse",
            down: "bg-rose-500/20 text-rose-300",
          }[status];
          const pillText = {
            online: "online",
            covering: `covering ${a.covering.join(", ")}`,
            crashed: "crashed · undetected",
            down: `down ${a.downSince !== undefined ? `${now - a.downSince}h` : ""}`,
          }[status];
          return (
            <div key={role} className={`rounded-lg border p-2.5 transition ${a.online ? "border-white/[0.06] bg-white/[0.02]" : "border-rose-500/30 bg-rose-500/[0.06]"}`}>
              <div className="flex items-center gap-2">
                <div className={`grid h-7 w-7 place-items-center rounded-md text-sm ring-1 ${st.bg} ${st.ring}`}>{st.icon}</div>
                <div className="min-w-0 flex-1">
                  <div className={`text-[13px] font-semibold ${st.text}`}>{def.title} agent</div>
                  <div className="truncate text-[10px] text-slate-500">{def.mandate}</div>
                </div>
                <span className={`chip ${pill}`}>{pillText}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-2 text-[10px] text-slate-400">
                <div>
                  Authority: <span className="text-slate-300">{ROLE_AUTHORITY(role, state.policy)}</span>
                </div>
                <div className="text-right">
                  {a.actionsTotal} actions · ♥ {a.lastHeartbeat >= 0 ? `${Math.max(0, now - 1 - a.lastHeartbeat)}h ago` : "—"}
                </div>
              </div>
              <div className="mt-1 truncate text-[11px] text-slate-300" title={a.lastAction}>
                {a.lastAction ? (
                  <>
                    <span className="text-slate-500">{a.lastActionAt !== undefined ? fmtTick(a.lastActionAt).replace(/Day \d+ · /, "") : ""} ›</span> {a.lastAction}
                  </>
                ) : (
                  <span className="text-slate-600">waiting for work…</span>
                )}
              </div>
              {a.detectedDown && (
                <div className="mt-1.5 rounded bg-cyan-400/10 px-2 py-1 text-[10px] text-cyan-200">
                  Degraded mode: {COVERABLE[role].note}
                </div>
              )}
              {!readOnly && (
                <div className="mt-2 flex justify-end">
                  {a.online ? (
                    <button className="btn !py-0.5 !text-[10px] hover:!border-rose-400/40 hover:!text-rose-300" onClick={() => onToggle(role, false)}>
                      💥 Kill agent
                    </button>
                  ) : (
                    <button className="btn !py-0.5 !text-[10px] !text-emerald-300" onClick={() => onToggle(role, true)}>
                      ⟳ Restart (human)
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <div className="rounded-lg border border-dashed border-orange-400/20 p-2.5">
          <div className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-md bg-orange-400/15 text-sm ring-1 ring-orange-400/40">🛡️</div>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-orange-300">Watchdog (control plane)</div>
              <div className="text-[10px] text-slate-500">Not an AI. Reads heartbeats, writes status & coverage to the shared records, auto-restarts every 6h.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
