# Notes for reviewers

## What to look at first

1. **Live demo → “A normal week” → ▶ Run the week.** The clock pauses at Mon 08:00 for your first decision (a churn‑save discount above policy). Decide, then resume.
2. **“Demand spike”** — the self‑correction scenario. No human events at all; watch the *Live operations* feed with **key moments** ticked, and the *KPIs over time* tab (overtime / throttle markers on the backlog chart).
3. **“Failure test: Ops agent crashes”** + the **Failure test** tab (compensated vs naive over N seeds).
4. **⏪ Replay** bar: click a day, then **✓ Verify replay**.
5. Code: `src/engine/simulation.ts` (the loop, ~200 lines) → `guard.ts` (authority) → `agents/*.ts` → `reducer.ts`.

## AI tools used

- **Claude (Anthropic)** as a pair‑programmer for the engine, the UI and the first drafts of these docs; every rule, number and claim was run, tested (`npm test`) and checked against the CLI output before it went into the docs.
- **At runtime** the agents use a deterministic rule brain by default. An optional **Claude brain** (bring your own API key, browser → api.anthropic.com) makes the agents' judgement calls; it is capped per run, validated against the listed options, falls back to rules on any error, and is still bounded by the guard.

## Key decisions

- **Event sourcing as the “common record system.”** Agents never talk to each other directly; they read projections and append events. This makes shared state real (one reducer, one log), accountability automatic (every event has an actor and a reason) and replay exact (fold the log — never re‑run agents or LLMs).
- **Authority is enforced in code, not in prompts.** `guard.ts` checks ownership (who may write what), monetary/policy limits, and coverage rules. A blocked action becomes a `GUARD_BLOCKED` event instead of a state change.
- **Rules first, LLM optional.** A judge must be able to open the demo with no key and get the same week every time. LLM decisions plug into the same judgement‑call interface and are recorded, so replay stays exact.
- **Peers learn about failures only through the shared status record.** The watchdog (deliberately not an AI) turns missing heartbeats into `AGENT_DOWN_DETECTED` + `COVERAGE_ASSIGNED`; agents read that record. The gap between “crashed” and “detected” is visible in the UI.
- **Every escalation has an SLA and a safe default.** The company never blocks on a human; the default is chosen per decision type (e.g. approve bean purchases — a stock‑out is worse; reject big discounts — margin is the safer side).
- **A naive baseline for the failure test** (`compensation: false`) so the value of compensation is measured, not asserted.
- **Keyed randomness + per‑type ids** so two runs that differ only in agent behaviour see the same customers, the same leads and the same payment behaviour.
- **A physical business** (a coffee roaster) rather than pure SaaS, so there is a real critical path, inventory, suppliers and capacity — and a place where agents honestly can't substitute for each other.

## Honest about humans

Still human in this design: pricing exceptions above Finance's authority, credits above $100, bad‑debt write‑offs, new capital, capacity investments, fixing a crashed agent whose auto‑restart keeps failing, and **setting the policy numbers themselves** (agents tune inside the limits; people own the limits). Physical roasting is modelled as automated equipment — in a real roaster that is a person.

## Out of scope

- Real integrations (email, payments, accounting, shipping APIs). The world model stands in for customers, suppliers and banks.
- Multi‑week strategy (pricing experiments, hiring, marketing), taxes, payroll, inventory spoilage.
- Persistence / multi‑user: the demo runs in the browser; export the event log to keep a run. A backend would store the same log.
- Agent‑to‑agent negotiation in natural language — coordination is through records and policy flags, by design.
- Security hardening of the optional BYO‑key LLM mode (the key stays in memory in your own browser tab).

## Numbers at a glance (default seeds, no human)

| scenario | revenue | on‑time | human escalations | peer (Finance) approvals | replay check |
|---|---:|---:|---:|---:|:---:|
| baseline | ~$10.5k | 100 % | 3 | 2 | ✓ |
| demand‑spike | ~$15.3k | ~81 % | 5 | 1 | ✓ |
| supplier‑delay | ~$9.4k | 100 % | 2 | 4 | ✓ |
| ops‑outage | ~$9.2k | ~39 % | 6 | 1 | ✓ |

(Run `npm run sim -- --scenario <id>` to regenerate.)
