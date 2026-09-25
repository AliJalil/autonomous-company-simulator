import { AGENTS, AGENT_ORDER, COVERABLE, money, type Policy } from "../../engine";
import { ACTOR_STYLE, pct } from "../theme";

function Box({ x, y, w, h, title, sub, color, dashed }: { x: number; y: number; w: number; h: number; title: string; sub?: string; color: string; dashed?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={10} fill={`${color}14`} stroke={color} strokeOpacity={0.6} strokeDasharray={dashed ? "5 4" : undefined} />
      <text x={x + w / 2} y={y + (sub ? h / 2 - 3 : h / 2 + 4)} textAnchor="middle" fontSize="12.5" fontWeight={700} fill="#f1f5f9">
        {title}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + h / 2 + 12} textAnchor="middle" fontSize="9.5" fill="#94a3b8">
          {sub}
        </text>
      )}
    </g>
  );
}

function Arrow({ d, label, lx, ly, color = "#64748b" }: { d: string; label?: string; lx?: number; ly?: number; color?: string }) {
  return (
    <g>
      <path d={d} fill="none" stroke={color} strokeWidth={1.4} markerEnd="url(#arrow)" />
      {label && (
        <text x={lx} y={ly} fontSize="9.5" fill="#94a3b8" textAnchor="middle">
          {label}
        </text>
      )}
    </g>
  );
}

export function Architecture({ policy }: { policy: Policy }) {
  const agentX = [205, 330, 455, 580];
  return (
    <div className="space-y-4">
      <div className="panel overflow-x-auto p-3">
        <div className="panel-title mb-2">Architecture snapshot</div>
        <svg viewBox="0 0 900 450" className="w-full min-w-[640px]" role="img" aria-label="Architecture diagram">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#64748b" />
            </marker>
          </defs>
          <Box x={315} y={8} w={270} h={44} title="🌍 World model" sub="customers · prospects · suppliers (seeded, keyed RNG)" color="#94a3b8" />
          <Arrow d="M450 52 L450 88" label="orders · leads · payments · deliveries · complaints" lx={560} ly={74} />

          <rect x={190} y={90} width={520} height={150} rx={12} fill="#f59e0b0d" stroke="#f59e0b" strokeOpacity={0.55} />
          <text x={450} y={110} textAnchor="middle" fontSize="13" fontWeight={800} fill="#fde68a">
            🗄️ Shared record system (event-sourced)
          </text>
          <rect x={210} y={122} width={480} height={30} rx={6} fill="#0b0f17" stroke="#f59e0b" strokeOpacity={0.3} />
          {Array.from({ length: 16 }, (_, i) => (
            <rect key={i} x={216 + i * 29} y={128} width={24} height={18} rx={3} fill={["#38bdf8", "#fbbf24", "#34d399", "#a78bfa", "#94a3b8", "#fb7185"][i % 6]} opacity={0.35 + (i / 16) * 0.5} />
          ))}
          <text x={450} y={166} textAnchor="middle" fontSize="9.5" fill="#94a3b8">
            append-only event log (actor · reason · causedBy)  →  pure reducer  →  projections
          </text>
          {["customers", "orders", "invoices", "leads", "tickets", "POs", "policy", "agent status", "inbox"].map((p, i) => (
            <g key={p}>
              <rect x={208 + i * 54} y={178} width={50} height={22} rx={5} fill="#ffffff0d" stroke="#ffffff22" />
              <text x={233 + i * 54} y={193} textAnchor="middle" fontSize="8.5" fill="#e2e8f0">
                {p}
              </text>
            </g>
          ))}
          <text x={450} y={226} textAnchor="middle" fontSize="9.5" fill="#fbbf24">
            replay(log, t) rebuilds any moment exactly · state hash proves live = rebuilt
          </text>

          <rect x={190} y={252} width={520} height={28} rx={6} fill="#ef44441a" stroke="#ef4444" strokeOpacity={0.5} />
          <text x={450} y={270} textAnchor="middle" fontSize="10.5" fontWeight={700} fill="#fecaca">
            🔒 Guard: ownership · authority limits · coverage rules → else GUARD_BLOCKED
          </text>

          {AGENT_ORDER.map((r, i) => (
            <Box key={r} x={agentX[i]} y={318} w={115} h={52} title={`${ACTOR_STYLE[r].icon} ${ACTOR_STYLE[r].label}`} sub={AGENTS[r].owns.slice(0, 2).join(" · ")} color={ACTOR_STYLE[r].hex} />
          ))}
          <Arrow d="M300 316 L300 283" label="commands" lx={270} ly={302} />
          <Arrow d="M600 238 L600 316" label="read shared state" lx={645} ly={302} />
          <Box x={255} y={392} w={390} h={40} title="🧠 Brain per agent: rules (default) or Claude (judgement calls only)" sub="LLM output is still checked by the guard — it can't exceed the role's authority" color="#e879f9" dashed />

          <Box x={12} y={110} w={160} h={100} title="🛡️ Watchdog" sub="heartbeats → DOWN / coverage" color="#fb923c" />
          <Arrow d="M172 140 L188 140" />
          <Arrow d="M188 180 L174 180" />
          <text x={92} y={228} textAnchor="middle" fontSize="9" fill="#94a3b8">
            not an AI · auto-restart every 6h
          </text>

          <Box x={728} y={110} w={160} h={100} title="🧑 Human inbox" sub="approve / reject · SLA → safe default" color="#fb7185" />
          <Arrow d="M712 140 L726 140" label="" />
          <Arrow d="M726 185 C 740 300, 720 266, 712 266" label="decisions (as events)" lx={806} ly={262} />
        </svg>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <div className="panel p-3">
          <div className="panel-title mb-2">Roles & authority (live policy)</div>
          <table className="w-full text-left text-[11.5px]">
            <tbody>
              {[
                ["🤝 Sales", "leads, quotes, new customers", `discount ≤ ${pct(policy.maxDiscount)}`, `≤ ${pct(policy.financeDiscountAuthority)} → Finance, above → human`],
                ["🔥 Ops", "roasting, shipping, inventory, POs, throttle signal", `POs ≤ ${money(policy.opsPOLimit)}`, `≤ ${money(policy.financePOLimit)} → Finance, above → human`],
                ["💰 Finance", "invoices, collections, credit holds, pricing & overtime policy", `approves POs ≤ ${money(policy.financePOLimit)}`, "write-offs & new capital → human"],
                ["💬 Support", "tickets, credits, health, retention", `credit ≤ ${money(policy.supportCreditLimit)}/ticket`, "bigger credits & pricing exceptions → human"],
              ].map((r) => (
                <tr key={r[0]} className="border-t border-white/5 align-top">
                  <td className="py-1.5 pr-2 font-semibold text-slate-100">{r[0]}</td>
                  <td className="py-1.5 pr-2 text-slate-400">{r[1]}</td>
                  <td className="py-1.5 pr-2 font-mono text-emerald-300">{r[2]}</td>
                  <td className="py-1.5 text-slate-300">{r[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel p-3">
          <div className="panel-title mb-2">When a role fails (coverage matrix)</div>
          <ul className="space-y-1.5 text-[11.5px] text-slate-300">
            {AGENT_ORDER.map((r) => (
              <li key={r}>
                <b className={ACTOR_STYLE[r].text}>{AGENTS[r].title} down</b> → {COVERABLE[r].note}
              </li>
            ))}
            <li className="text-slate-400">+ Sales stops closing deals while Ops is down · Support warns every customer with an order due in 24h · Finance pauses dunning on customers with open tickets while Support is down.</li>
          </ul>
        </div>

        <div className="panel p-3">
          <div className="panel-title mb-2">Self-correcting loops (no human)</div>
          <ul className="list-disc space-y-1 pl-4 text-[11.5px] text-slate-300">
            <li>Backlog &gt; 1.1 days → Ops runs overtime; &gt; 1.6 days → Ops sets <code>salesThrottle</code> → Sales waitlists deals; both release automatically.</li>
            <li>Primary supplier &gt; 6h late → Ops cancels and re-orders from the backup supplier; stock-out &lt; 1 day → expedite.</li>
            <li>Trailing 2-day margin below target → Finance tightens the Sales discount cap (restores it when margin recovers).</li>
            <li>Cash below floor → Finance disallows overtime; late payers → reminders → credit hold → Ops stops shipping to them.</li>
          </ul>
        </div>

        <div className="panel p-3">
          <div className="panel-title mb-2">Honest: what still needs a human</div>
          <ul className="list-disc space-y-1 pl-4 text-[11.5px] text-slate-300">
            <li>Pricing exceptions above Finance's authority and churn-save discounts above policy.</li>
            <li>Customer credits above the per-ticket limit; bad-debt write-offs.</li>
            <li>New capital (founder bridge) when cash breaks the floor; capacity investments (a second roaster shift).</li>
            <li>Fixing a crashed agent whose auto-restart keeps failing.</li>
            <li>Setting the policy numbers themselves (limits, targets) — agents tune within them, humans own them.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
