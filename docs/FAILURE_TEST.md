# Failure test — one role goes off

**Question:** when an agent dies mid‑week, do the others compensate or escalate — or does the company silently degrade?

**Reproduce:**

```bash
npm run failure-test                                       # single seed + 30-seed aggregate
npm run sim -- --scenario ops-outage --verbose             # timeline of the outage
npm run sim -- --scenario ops-outage --seeds 30            # aggregate only
```

In the UI: pick **“Failure test: Ops agent crashes”**, or press **💥 Kill agent** on any role at any time, or open the **Failure test** tab and run N seeds.

## Setup

- Scenario `ops-outage`: the Ops agent process crashes **Tuesday 09:00**. Automatic restarts keep failing for ~48 h (a “dependency still failing” fault). A human can restart it at any time from the inbox.
- **Compensated** run = the system as designed.
- **Naive** run = the same crash and the same auto‑restarts, but peers ignore the outage and nothing is escalated (`compensation: false`). This isolates the value of compensation from the value of restarting.
- No human answers in either run (headless), so every escalation falls back to its safe default.

## What happens (compensated, seed 16) — straight from the event log

```
t=33  Tue 09:00  [system  ] 💥 Operations agent crashed
t=36  Tue 12:00  [watchdog] Ops agent missed heartbeats for 5h — marked DOWN
t=36  Tue 12:00  [watchdog] Finance now covers part of Ops's duties
                             ↳ Finance places bean re-orders so the roaster doesn't starve; nobody else may roast or ship.
t=36  Tue 12:00  [watchdog] Escalated to HUMAN: Ops agent is down (restart manually?)
t=39  Tue 15:00  [sales   ] Waitlisted Copper Library (10 kg/week)      ↳ Ops agent is down — can't confirm capacity
t=40  Tue 16:00  [support ] Warned Granite Library: O-4 will be late    ↳ pre-emptive notice before the customer notices
t=40  Tue 16:00  [support ] Warned Saffron Labs: O-5 will be late
t=41  Tue 17:00  [watchdog] Auto-restart of Ops agent failed (attempt 1)
t=44  Tue 20:00  [system  ] No decision within SLA → safe default: stay in degraded mode
t=56  Wed 08:00  [sales   ] Parked signed deal Northgate Library until capacity frees up
t=64  Wed 16:00  [support ] Warned Copper Books / Oakline Bistro / Willow Studios: orders will be late
t=83  Thu 11:00  [watchdog] Auto-restart of Ops agent succeeded (attempt 8)
t=84  Thu 12:00  [ops     ] Started evening overtime shift   ↳ Backlog is 2.5 days of roasting
t=84  Thu 12:00  [ops     ] Signalled Sales: pause new deals ↳ Backlog 2.5 days
t=84  Thu 12:00  [watchdog] Ops agent heartbeat is back — marked UP (down for 48h) → coverage ended
t=117 Fri 21:00  [ops     ] Signalled Sales: capacity available again
t=129 Sat 09:00  [ops     ] Stopped overtime shift
```

Note what is **not** there: no other agent roasts or ships. Physical fulfilment has no substitute — that gap is surfaced to the human instead of papered over.

## Result — single seed (16)

| metric | compensated | naive |
|---|---:|---:|
| complaint tickets opened | **6** | 14 |
| credits paid out | **$200** | $695 |
| late shipments | **8** | 11 |
| on‑time rate | **38.5 %** | 26.7 % |
| end‑of‑week cash | **$12,364** | $11,068 |
| end‑of‑week MRR | **$61,464** | $56,733 |
| revenue recognised this week | $9,203 | **$10,451** |

## Result — 30 seeds

| average over 30 seeds | compensated | naive |
|---|---:|---:|
| customers churned | **0.0** | 0.4 |
| runs with ≥ 1 churned customer | **0 / 30** | 11 / 30 |
| complaint tickets | **5.6** | 10.9 |
| credits paid out | **$149** | $476 |
| late shipments | 7.0 | 7.2 |
| on‑time % | 44.7 | 46.1 |
| end cash | **$14,208** | $13,445 |
| end MRR | **$54,139** | $52,905 |

## Honest reading

- Compensation **protects customers, not throughput.** Nobody else may roast, so late shipments are about the same. What changes is *how the lateness lands*: customers are warned before they notice, so they don't complain, don't need big credits and don't churn (0/30 vs 11/30 runs).
- Sales waitlisting deals during the outage **costs revenue in the week** (naive books more) but avoids promising coffee the company can't roast; most parked deals are closed once Ops is back.
- **Finance and Support outages barely move the numbers** in this model (see `--scenario finance-outage --seeds 30`): their work is not on the physical critical path — it queues and catches up. The real cost there is latency (cash arrives later, decisions wait for a human), which is exactly what the escalations expose.
- Detection takes ~3–5 h (heartbeat timeout). A human answering the restart escalation ends the outage immediately — the fastest recovery path is still a person.
