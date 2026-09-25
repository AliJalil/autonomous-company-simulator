import { fmtTick, type CompanyState, type Escalation } from "../../engine";
import { ACTOR_STYLE } from "../theme";

const KIND_LABEL: Record<Escalation["kind"], string> = {
  discount_approval: "Pricing exception",
  po_approval: "Purchase approval",
  credit_approval: "Customer credit",
  write_off: "Bad debt",
  retention_offer: "Churn save",
  cash_floor: "Financing",
  capacity_expansion: "Capacity investment",
  agent_down: "Agent outage",
};

export function Inbox({
  state,
  now,
  readOnly,
  flashKey,
  onResolve,
}: {
  state: CompanyState;
  now: number;
  readOnly: boolean;
  flashKey: number;
  onResolve: (id: string, d: "approve" | "reject") => void;
}) {
  const all = Object.values(state.inbox).sort((a, b) => b.createdAt - a.createdAt);
  const open = all.filter((e) => e.status === "open" && e.to === "human");
  const peer = all.filter((e) => e.to === "finance");
  const decided = all.filter((e) => e.to === "human" && e.status !== "open");

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div key={flashKey} className={`panel p-3 ${open.length ? "flash border-rose-400/40" : ""}`}>
        <div className="mb-2 flex items-center justify-between">
          <div className="panel-title !text-rose-300">🧑 Human inbox</div>
          <span className={`chip ${open.length ? "bg-rose-500/25 text-rose-200" : "bg-white/5 text-slate-400"}`}>{open.length} waiting</span>
        </div>
        {open.length === 0 && (
          <div className="rounded-lg border border-dashed border-white/10 p-3 text-center text-[11px] text-slate-500">
            Nothing needs you. Agents escalate only what's outside their authority — and if you don't answer before the SLA, the safe default is applied.
          </div>
        )}
        <div className="space-y-2">
          {open.map((e) => {
            const from = ACTOR_STYLE[e.from];
            const left = e.slaAt - now;
            return (
              <div key={e.id} className="slidein rounded-lg border border-rose-400/30 bg-rose-400/[0.06] p-2.5">
                <div className="mb-1 flex items-center gap-1.5">
                  <span className={`chip ${from.bg} ${from.text}`}>
                    {from.icon} {from.label}
                  </span>
                  <span className="chip bg-white/5 text-slate-300">{KIND_LABEL[e.kind]}</span>
                  <span className={`ml-auto font-mono text-[10px] ${left <= 2 ? "text-rose-300" : "text-slate-400"}`}>SLA {Math.max(0, left)}h</span>
                </div>
                <div className="text-[12.5px] font-semibold leading-snug text-white">{e.title}</div>
                <div className="mt-1 text-[11px] leading-snug text-slate-300">{e.detail}</div>
                <div className="mt-1.5 text-[10px] text-slate-400">
                  Agent recommends <b className={e.recommendation === "approve" ? "text-emerald-300" : "text-amber-300"}>{e.labels?.[e.recommendation] ?? e.recommendation}</b> · if no answer:{" "}
                  <b className="text-slate-300">{e.labels?.[e.onExpiry] ?? e.onExpiry}</b>
                </div>
                {!readOnly && (
                  <div className="mt-2 flex gap-1.5">
                    <button className="btn flex-1 justify-center !border-emerald-400/40 !bg-emerald-400/15 !text-emerald-200 hover:!bg-emerald-400/25" onClick={() => onResolve(e.id, "approve")}>
                      ✓ {e.labels?.approve ?? "Approve"}
                    </button>
                    <button className="btn flex-1 justify-center" onClick={() => onResolve(e.id, "reject")}>
                      ✕ {e.labels?.reject ?? "Reject"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel scroll-thin min-h-0 flex-1 overflow-y-auto p-3">
        <div className="panel-title mb-2">Agent → agent approvals</div>
        {peer.length === 0 && <div className="text-[11px] text-slate-500">None yet. Sales & Ops ask Finance before they ask you.</div>}
        <div className="space-y-1">
          {peer.slice(0, 12).map((e) => (
            <div key={e.id} className="flex items-start gap-1.5 text-[11px]">
              <span className={ACTOR_STYLE[e.from].text}>{ACTOR_STYLE[e.from].icon}</span>
              <span className="text-slate-500">→ 💰</span>
              <span className="min-w-0 flex-1 truncate text-slate-300" title={e.title}>
                {e.title}
              </span>
              <StatusChip e={e} />
            </div>
          ))}
        </div>
        <div className="panel-title mb-2 mt-4">Decided by / for the human</div>
        {decided.length === 0 && <div className="text-[11px] text-slate-500">—</div>}
        <div className="space-y-1">
          {decided.slice(0, 20).map((e) => (
            <div key={e.id} className="text-[11px]">
              <div className="flex items-start gap-1.5">
                <StatusChip e={e} />
                <span className="min-w-0 flex-1 truncate text-slate-300" title={e.title}>
                  {e.title}
                </span>
              </div>
              <div className="pl-1 text-[10px] text-slate-500">
                {e.resolvedBy === "system" ? `SLA expired → ${e.decision}` : `${e.resolvedBy} · ${e.decision}`} · {e.resolvedAt !== undefined ? fmtTick(e.resolvedAt) : ""}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatusChip({ e }: { e: Escalation }) {
  const map = {
    open: "bg-amber-400/15 text-amber-200",
    approved: "bg-emerald-400/15 text-emerald-300",
    rejected: "bg-slate-400/15 text-slate-300",
    expired: "bg-orange-400/15 text-orange-300",
  } as const;
  return <span className={`chip shrink-0 ${map[e.status]}`}>{e.status === "expired" ? `timeout→${e.decision}` : e.status}</span>;
}
