# ☕ Ember Roasting Co. — The Autonomous Company Simulator

A small B2B coffee roaster that **runs as a loop of accountable AI agents** instead of a stack of disconnected SaaS tools.
Four agent roles — **Sales, Ops, Finance, Customer Success** — share **one event‑sourced record system**, act on it every simulated hour,
approve each other's requests within hard authority limits, and **escalate to a human inbox** only what a person should own.
Every number (cash, revenue, costs, margin, backlog, on‑time, churn, MRR) moves because an agent or the world wrote an event — and any moment can be **replayed exactly** from the log.

> Built for the *Autonomous Company Simulator* builder challenge. Everything in the brief maps to a place in this repo — see [Challenge checklist](#challenge-checklist).

🌐 **Live Demo:** [https://alijalil.github.io/autonomous-company-simulator/](https://alijalil.github.io/autonomous-company-simulator/)

---

## Quick start

```bash
npm install
npm run dev            # open http://localhost:5173  → press ▶ "Run the week"
```

Headless (no browser):

```bash
npm run sim                                              # a normal week
npm run sim -- --scenario demand-spike --verbose         # self-correction, key moments printed
npm run failure-test                                     # Ops outage: compensated vs naive (1 seed + 30 seeds)
npm run sim -- --list                                    # all scenarios
npm run sim -- --human recommend --log run.json          # simulated human + export event log
npm test                                                 # determinism, replay, guard, self-correction, failure tests
npm run build                                            # static site in dist/ (deploy anywhere)
```

Requirements: Node 18+ (tested on Node 22). No API keys needed. No backend.

## What you'll see (demo in 60 seconds)

1. Pick **“A normal week”**, press **▶ Run the week**. The live feed shows every action with *who* did it and *why*.
2. At Monday 08:00 the clock **pauses**: Customer Success wants to offer an at‑risk account a discount above policy → **your inbox**. Approve or reject. (Ignore it and the SLA applies the safe default.)
3. Watch Sales ask **Finance** (not you) for a 13 % discount, and Ops ask Finance to approve a bean purchase above its $2,500 limit — agent‑to‑agent approvals.
4. Switch to **“Demand spike”**: Ops starts overtime, raises the shared `salesThrottle` flag, Sales waitlists deals, Finance tightens the discount cap when margin dips — then everything releases on its own. **No human involved.**
5. Switch to **“Failure test: Ops agent crashes”** (or press 💥 *Kill agent* on any card). The watchdog detects missing heartbeats, assigns coverage, peers adapt, and you're asked whether to restart it.
6. Open **Failure test** tab → run 40 simulated weeks: compensated vs naive.
7. Use **⏪ Replay** at the bottom: click any day to replay it hour by hour, or **✓ Verify replay** to prove the rebuilt state hash equals the live one.

## Scenarios

| id | what happens | what it shows |
|---|---|---|
| `baseline` | a normal week | peer approvals, human inbox, KPIs moving |
| `demand-spike` | festival rush orders + lead surge | **self-correction**: overtime, sales throttle, discount tightening, automatic release |
| `supplier-delay` | primary bean co‑op slips 3 days | **self-correction**: Ops cancels late PO, switches to backup supplier, expedites |
| `ops-outage` | Ops agent crashes Tue 09:00 for ~48h | **failure test**: detection → coverage → escalation → recovery |
| `finance-outage` | Finance crashes Wed 08:00 for ~30h | money decisions route to the human; invoicing queues |
| `support-outage` | Support crashes Thu 08:00 for ~26h | Sales covers high‑severity tickets with half the credit authority |

## Repo map

```
src/engine/            the company (framework-free TypeScript, runs in browser and Node)
  types.ts             records + event types
  reducer.ts           the ONLY place state changes: applyEvent(state, event)
  guard.ts             ownership, authority limits, coverage rules  (GUARD_BLOCKED otherwise)
  simulation.ts        hourly loop: faults → world → SLAs → agents → watchdog → KPI snapshot
  agents/{sales,ops,finance,support}.ts   four independent agents, each with its own mandate
  watchdog.ts          control plane (not an AI): heartbeats, DOWN detection, coverage, restarts
  world.ts             customers, prospects, suppliers (seeded, order-independent randomness)
  brain.ts             RuleBrain (default) + optional Claude brain for judgement calls
  replay.ts            replay(log, tick) and verifyReplay()
  scenarios.ts         the six scenarios
src/ui/                React + Tailwind dashboard (live feed, inbox, records, charts, failure test, replay)
src/cli/run.ts         headless runner + failure-test comparisons
tests/                 vitest suite
docs/                  ARCHITECTURE.md · FAILURE_TEST.md · THESIS.md · NOTES.md · LOOM_SCRIPT.md
```

## Deploy the live demo (static — pick one)

- **Vercel**: import the repo → framework *Vite* → build `npm run build`, output `dist` (a `vercel.json` is included).
- **Netlify**: import the repo (a `netlify.toml` is included).
- **GitHub Pages**: push to `main`; the included workflow `.github/workflows/deploy.yml` builds and publishes. Enable *Settings → Pages → Source: GitHub Actions*.

## Optional: let Claude make the judgement calls

Click **🧠 Rules** in the header → enable Claude, paste an Anthropic API key (kept in memory only; the browser calls the API directly), choose a model.
The LLM is used only for *judgement calls* (how much discount to quote, how to respond to an at‑risk account, whether to put a late payer on credit hold). Its choice and rationale are logged on the event (`brain: "llm"`), it is capped per run, it falls back to rules on any error — and **the guard still enforces the role's authority**, so an LLM can't give a discount Sales isn't allowed to give. Replay never re‑calls the LLM; it folds the recorded decisions.

## Challenge checklist

| Brief | Where |
|---|---|
| ≥ 3 connected agent roles sharing state through a common record system | 4 roles in `src/engine/agents/*`, all reading/writing `CompanyState` via `commit()` → `reducer.ts` |
| “Run‑the‑week” loop, real actions on shared records, escalation to a human inbox | `simulation.ts` hourly loop; human inbox in UI; SLA + safe defaults |
| Numbers move (revenue, cost, backlog, churn) and you can replay a day | KPI strip + charts; ⏪ Replay bar (day replay, scrubber, verify) |
| Scenario where the company self‑corrects without human input | `demand-spike`, `supplier-delay` (+ test proving zero human events) |
| Architecture snapshot | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) + *Architecture* tab |
| Failure test | [`docs/FAILURE_TEST.md`](docs/FAILURE_TEST.md) + *Failure test* tab + `npm run failure-test` |
| Two‑year thesis (≤ 300 words) | [`docs/THESIS.md`](docs/THESIS.md) |
| 90‑second Loom with a human‑in‑the‑loop moment | script in [`docs/LOOM_SCRIPT.md`](docs/LOOM_SCRIPT.md) |
| Notes: AI tools used, key decisions, out of scope | [`docs/NOTES.md`](docs/NOTES.md) |
| Not “a single agent pretending to be three” | separate modules, separate mandates, ownership enforced by the guard, peers learn about each other only through shared records |
| Honest about which roles still need humans | *Architecture* tab → “Honest: what still needs a human”; `docs/NOTES.md` |

## License

MIT — Ember Roasting Co. and every customer name are fictional.
