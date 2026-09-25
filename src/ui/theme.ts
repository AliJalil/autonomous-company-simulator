import type { Actor, Role } from "../engine";

export const ACTOR_STYLE: Record<Actor, { label: string; icon: string; text: string; bg: string; ring: string; hex: string }> = {
  sales: { label: "Sales", icon: "🤝", text: "text-sky-300", bg: "bg-sky-400/15", ring: "ring-sky-400/40", hex: "#38bdf8" },
  ops: { label: "Ops", icon: "🔥", text: "text-amber-300", bg: "bg-amber-400/15", ring: "ring-amber-400/40", hex: "#fbbf24" },
  finance: { label: "Finance", icon: "💰", text: "text-emerald-300", bg: "bg-emerald-400/15", ring: "ring-emerald-400/40", hex: "#34d399" },
  support: { label: "Support", icon: "💬", text: "text-violet-300", bg: "bg-violet-400/15", ring: "ring-violet-400/40", hex: "#a78bfa" },
  world: { label: "World", icon: "🌍", text: "text-slate-300", bg: "bg-slate-400/10", ring: "ring-slate-400/30", hex: "#94a3b8" },
  human: { label: "Human", icon: "🧑", text: "text-rose-300", bg: "bg-rose-400/15", ring: "ring-rose-400/40", hex: "#fb7185" },
  watchdog: { label: "Watchdog", icon: "🛡️", text: "text-orange-300", bg: "bg-orange-400/15", ring: "ring-orange-400/40", hex: "#fb923c" },
  system: { label: "System", icon: "⚙️", text: "text-zinc-300", bg: "bg-zinc-400/10", ring: "ring-zinc-400/30", hex: "#a1a1aa" },
};

export const ROLE_AUTHORITY = (role: Role, p: { maxDiscount: number; opsPOLimit: number; supportCreditLimit: number; financePOLimit: number; financeDiscountAuthority: number }) =>
  ({
    sales: `Discount ≤ ${Math.round(p.maxDiscount * 100)}% alone`,
    ops: `POs ≤ $${p.opsPOLimit.toLocaleString()} alone`,
    finance: `Approves POs ≤ $${p.financePOLimit.toLocaleString()}, discounts ≤ ${Math.round(p.financeDiscountAuthority * 100)}%`,
    support: `Credits ≤ $${p.supportCreditLimit} per ticket`,
  })[role];

export const pct = (n: number, d = 0) => `${(n * 100).toFixed(d)}%`;
