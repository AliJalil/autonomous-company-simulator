import { computeKpis } from "./kpis";
import { applyEvent } from "./reducer";
import { stateHash } from "./rng";
import type { CompanyState, KpiSnapshot, SimEvent, Tick } from "./types";

/**
 * Rebuild the company at the END of `uptoTick` purely from the event log.
 * No agent, world model or LLM is re-run — replay is a fold over recorded facts,
 * so it is exact even for runs that contained human or LLM decisions.
 */
export function replay(events: SimEvent[], uptoTick: Tick = Infinity): { state: CompanyState; history: KpiSnapshot[] } {
  let state: CompanyState | null = null;
  const history: KpiSnapshot[] = [];
  let current = 0;
  for (const e of events) {
    if (e.tick > uptoTick) break;
    while (state && e.tick > current) {
      history.push(computeKpis(state, current));
      current++;
    }
    state = applyEvent(state ?? ({} as CompanyState), e);
  }
  if (!state) throw new Error("empty event log");
  const last = Math.min(uptoTick, events[events.length - 1].tick);
  while (current <= last && history.length <= last) {
    history.push(computeKpis(state, current));
    current++;
  }
  return { state, history };
}

export function hashState(s: CompanyState) {
  return stateHash(s);
}

/** Proves the live state equals the state rebuilt from the log. */
export function verifyReplay(events: SimEvent[], live: CompanyState): { ok: boolean; live: string; rebuilt: string; events: number } {
  const { state } = replay(events);
  const a = hashState(live);
  const b = hashState(state);
  return { ok: a === b, live: a, rebuilt: b, events: events.length };
}
