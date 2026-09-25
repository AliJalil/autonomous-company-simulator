import { useState, type ReactNode } from "react";
import { SUPPLIERS, fmtTick, money, type CompanyState } from "../../engine";
import { ACTOR_STYLE, pct } from "../theme";

const TABS = ["customers", "orders", "invoices", "leads", "tickets", "purchase orders", "policy"] as const;
type Tab = (typeof TABS)[number];

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="scroll-thin max-h-[440px] overflow-auto rounded-lg border border-white/[0.06]">
      <table className="w-full min-w-[560px] text-left text-[11.5px]">
        <thead className="sticky top-0 bg-slate-900/95 text-[10px] uppercase tracking-wider text-slate-400">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-2.5 py-1.5 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={head.length} className="px-2.5 py-6 text-center text-slate-500">
                No records yet
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-white/[0.04] hover:bg-white/[0.03]">
              {r.map((c, j) => (
                <td key={j} className="px-2.5 py-1.5 text-slate-200">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const Badge = ({ tone, children }: { tone: "good" | "warn" | "bad" | "info" | "mute"; children: ReactNode }) => {
  const c = { good: "bg-emerald-400/15 text-emerald-300", warn: "bg-amber-400/15 text-amber-200", bad: "bg-rose-400/15 text-rose-300", info: "bg-sky-400/15 text-sky-300", mute: "bg-white/5 text-slate-400" }[tone];
  return <span className={`chip ${c}`}>{children}</span>;
};

export function Records({ state, now }: { state: CompanyState; now: number }) {
  const [tab, setTab] = useState<Tab>("customers");
  const s = state;
  const byNewest = <T extends { id: string }>(o: Record<string, T>) => Object.values(o).reverse();

  let body: ReactNode = null;
  if (tab === "customers")
    body = (
      <Table
        head={["id", "customer", "kg/wk", "price", "health", "status", "late", "credits", "flags"]}
        rows={Object.values(s.customers)
          .sort((a, b) => a.health - b.health)
          .map((c) => [
            <span className="font-mono text-slate-500">{c.id}</span>,
            c.name,
            c.weeklyKg,
            `$${c.pricePerKg}${c.discount ? ` (−${pct(c.discount)})` : ""}`,
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-14 overflow-hidden rounded bg-white/10">
                <div className="h-full" style={{ width: `${c.health}%`, background: c.health < 45 ? "#fb7185" : c.health < 60 ? "#fbbf24" : "#34d399" }} />
              </div>
              {c.health}
            </div>,
            <Badge tone={c.status === "active" ? "good" : c.status === "at_risk" ? "warn" : "bad"}>{c.status.replace("_", " ")}</Badge>,
            c.lateOrders,
            c.creditsIssued ? money(c.creditsIssued) : "—",
            c.creditHold ? <Badge tone="bad">credit hold</Badge> : c.since >= 0 ? <Badge tone="info">new</Badge> : "",
          ])}
      />
    );
  if (tab === "orders")
    body = (
      <Table
        head={["id", "customer", "kg", "placed", "due", "status"]}
        rows={byNewest(s.orders).map((o) => {
          const late = o.status === "open" && now > o.dueAt;
          const shippedLate = o.status === "shipped" && (o.shippedAt ?? 0) > o.dueAt;
          return [
            <span className="font-mono text-slate-500">{o.id}</span>,
            s.customers[o.customerId]?.name,
            `${o.kg}${o.spike ? " ⚡" : ""}`,
            fmtTick(o.createdAt),
            fmtTick(o.dueAt),
            o.status === "open" ? (
              <Badge tone={late ? "bad" : "warn"}>{late ? `late ${now - o.dueAt}h` : "open"}{o.notifiedLate ? " · warned" : ""}</Badge>
            ) : o.status === "shipped" ? (
              <Badge tone={shippedLate ? "warn" : "good"}>{shippedLate ? "shipped late" : "shipped"}</Badge>
            ) : (
              <Badge tone="mute">cancelled</Badge>
            ),
          ];
        })}
      />
    );
  if (tab === "invoices")
    body = (
      <Table
        head={["id", "customer", "amount", "issued", "due", "reminders", "status"]}
        rows={byNewest(s.invoices).map((i) => [
          <span className="font-mono text-slate-500">{i.id}</span>,
          s.customers[i.customerId]?.name,
          money(i.amount),
          fmtTick(i.issuedAt),
          fmtTick(i.dueAt),
          i.reminders,
          i.status === "paid" ? <Badge tone="good">paid</Badge> : i.status === "written_off" ? <Badge tone="bad">written off</Badge> : <Badge tone={now > i.dueAt ? "bad" : "warn"}>{now > i.dueAt ? "overdue" : "open"}</Badge>,
        ])}
      />
    );
  if (tab === "leads")
    body = (
      <Table
        head={["id", "prospect", "kg/wk", "asked", "quoted", "stage", "arrived"]}
        rows={byNewest(s.leads).map((l) => [
          <span className="font-mono text-slate-500">{l.id}</span>,
          l.name,
          l.weeklyKg,
          l.askDiscount ? pct(l.askDiscount) : "—",
          l.quotedDiscount !== undefined ? pct(l.quotedDiscount) : "—",
          <Badge tone={l.stage === "won" ? "good" : l.stage === "lost" || l.stage === "cold" ? "bad" : l.stage === "parked" || l.stage === "pending_approval" ? "warn" : "info"}>{l.stage.replace("_", " ")}</Badge>,
          fmtTick(l.createdAt),
        ])}
      />
    );
  if (tab === "tickets")
    body = (
      <Table
        head={["id", "customer", "kind", "severity", "opened", "status", "resolved by", "credit"]}
        rows={byNewest(s.tickets).map((t) => [
          <span className="font-mono text-slate-500">{t.id}</span>,
          s.customers[t.customerId]?.name,
          t.kind.replace("_", " "),
          <Badge tone={t.severity === "high" ? "bad" : "mute"}>{t.severity}</Badge>,
          fmtTick(t.openedAt),
          <Badge tone={t.status === "resolved" ? "good" : t.status === "pending_approval" ? "warn" : "bad"}>{t.status.replace("_", " ")}</Badge>,
          t.resolvedBy ? <span className={ACTOR_STYLE[t.resolvedBy].text}>{ACTOR_STYLE[t.resolvedBy].label}</span> : "—",
          t.credit ? money(t.credit) : "—",
        ])}
      />
    );
  if (tab === "purchase orders")
    body = (
      <Table
        head={["id", "supplier", "kg", "cost", "requested by", "approved by", "ETA", "status"]}
        rows={byNewest(s.purchaseOrders).map((p) => [
          <span className="font-mono text-slate-500">{p.id}</span>,
          SUPPLIERS[p.supplier].name,
          p.kg,
          money(p.cost),
          <span className={ACTOR_STYLE[p.requestedBy].text}>{ACTOR_STYLE[p.requestedBy].label}</span>,
          p.approvedBy ? <span className={ACTOR_STYLE[p.approvedBy as keyof typeof ACTOR_STYLE]?.text}>{p.approvedBy}</span> : "—",
          p.etaAt !== undefined ? fmtTick(p.etaAt) : "—",
          <Badge tone={p.status === "received" ? "good" : p.status === "placed" ? "info" : p.status === "pending_approval" ? "warn" : "mute"}>{p.status.replace("_", " ")}</Badge>,
        ])}
      />
    );
  if (tab === "policy") {
    const p = s.policy;
    body = (
      <div className="grid gap-2 sm:grid-cols-2">
        {[
          ["Sales discount cap (alone)", pct(p.maxDiscount), "written by Finance (margin guard)"],
          ["Finance discount authority", pct(p.financeDiscountAuthority), "above → human"],
          ["Sales throttle", p.salesThrottle ? "ON — waitlisting" : "off", "written by Ops (capacity signal)"],
          ["Overtime allowed", p.overtimeAllowed ? "yes" : "NO", "written by Finance (cash guard)"],
          ["Ops PO limit", money(p.opsPOLimit), "above → Finance"],
          ["Finance PO limit", money(p.financePOLimit), "above → human"],
          ["Support credit limit", money(p.supportCreditLimit), "per ticket; above → human"],
          ["Cash floor", money(p.cashFloor), "below → overtime off + human"],
          ["Target margin", pct(p.targetMargin), "Finance steers discounts toward it"],
          ["Overtime shift", s.capacity.overtime ? "RUNNING" : "off", "Ops decides, Finance permits"],
          ["Green / roasted stock", `${Math.round(s.inventory.greenKg)} kg / ${Math.round(s.inventory.roastedKg)} kg`, "inventory record"],
          ["Guard blocks", String(s.counters.guardBlocks), "attempted actions outside authority"],
        ].map(([k, v, note]) => (
          <div key={k} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">{k}</div>
            <div className="font-mono text-sm text-white">{v}</div>
            <div className="text-[10px] text-slate-500">{note}</div>
          </div>
        ))}
      </div>
    );
  }

  const counts: Partial<Record<Tab, number>> = {
    customers: Object.keys(s.customers).length,
    orders: Object.keys(s.orders).length,
    invoices: Object.keys(s.invoices).length,
    leads: Object.keys(s.leads).length,
    tickets: Object.keys(s.tickets).length,
    "purchase orders": Object.keys(s.purchaseOrders).length,
  };
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`chip border !normal-case ${tab === t ? "border-white/30 bg-white/15 text-white" : "border-white/10 text-slate-400 hover:text-slate-200"}`}>
            {t}
            {counts[t] !== undefined && <span className="text-slate-500">{counts[t]}</span>}
          </button>
        ))}
      </div>
      {body}
      <div className="mt-2 text-[10px] text-slate-500">
        Every row above is a projection of the event log — agents never keep private copies. Replay any moment with the timeline below.
      </div>
    </div>
  );
}
