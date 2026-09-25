# 90‑second Loom — “a simulated day at Ember Roasting Co.”

Setup before recording: open the live demo, scenario **“Failure test: Ops agent crashes”**, speed **6h/s**, *Pause on escalation* ✓, close nothing. Screen at 1440×900 or larger.

| time | on screen | say (≈ 200 words total) |
|---|---|---|
| 0:00–0:10 | whole dashboard | “This is Ember Roasting Co., a small coffee roaster run by four AI agents — Sales, Ops, Finance and Customer Success. They don't message each other; they all read and write one shared, event‑sourced record system.” |
| 0:10–0:22 | press ▶. Clock pauses Mon 08:00 on the inbox | “Monday 8 a.m.: Customer Success wants to give an unhappy account a discount above its authority, so it lands in my inbox with a recommendation and a deadline.” → click **Offer 13 %** (the human‑in‑the‑loop moment). Resume. |
| 0:22–0:35 | feed (tick *key moments*): Sales → Finance approval | “Smaller calls never reach me. Sales asks Finance for a 13 % discount; Finance approves because margin allows. Every line says who acted and why.” |
| 0:35–0:55 | Tuesday 09:00 crash → Ops card turns red → watchdog DOWN → Finance ‘covering’ → Support warnings | “Tuesday 9 a.m. the Ops agent crashes. Nothing roasts or ships. The watchdog notices missing heartbeats, marks it down and assigns coverage: Finance keeps ordering beans, Sales stops promising capacity, Support warns every customer with an order due — before they complain.” |
| 0:55–1:05 | inbox: “restart it manually?” → click **Restart agent** | “And I get one question: restart it? I say yes.” Ops comes back, heartbeats resume, coverage ends and it works through the backlog. |
| 1:05–1:18 | Failure test tab → run 40 weeks | “Is compensation worth it? Same crash, 20 seeds, with and without it: half the complaints, a third of the credits, zero churned customers versus churn in roughly one naive run in four (4 of 20 seeds).” |
| 1:18–1:30 | ⏪ click D2 → replay → ✓ Verify replay | “And any day can be replayed from the log alone — the rebuilt company hashes identical to the live one. A company, not a script.” |

Tip: if you prefer the self‑correction story instead, record **“Demand spike”** at 12h/s with *Pause on escalation* off and narrate the overtime → throttle → discount‑tightening → release sequence from the *KPIs over time* tab.
