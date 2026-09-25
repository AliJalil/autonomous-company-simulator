import type { Role } from "./types";

/**
 * A "judgement call" an agent can delegate to its brain.
 * Agents always compute a rule-based default first; the brain may pick a
 * different option. Whatever it picks still passes through the guard, so an
 * LLM can never exceed the authority of the role it plays.
 */
export interface Judgement {
  role: Role;
  question: string;
  context: Record<string, unknown>;
  options: { id: string; label: string }[];
  defaultChoice: string;
  defaultRationale: string;
}

export interface Verdict {
  choice: string;
  rationale: string;
  source: "rules" | "llm";
}

export interface Brain {
  kind: "rules" | "llm";
  judge(j: Judgement): Promise<Verdict>;
}

/** Deterministic policy brain — the default. Runs anywhere, no keys, fully replayable. */
export const RuleBrain: Brain = {
  kind: "rules",
  async judge(j) {
    return { choice: j.defaultChoice, rationale: j.defaultRationale, source: "rules" };
  },
};

const ROLE_PERSONA: Record<Role, string> = {
  sales: "You are the Sales agent of Ember Roasting Co., a small B2B coffee roaster. You grow revenue but must protect margin and never promise capacity Ops cannot deliver.",
  ops: "You are the Operations agent of Ember Roasting Co. You roast, ship and buy green beans. You protect on-time delivery and cost.",
  finance: "You are the Finance agent of Ember Roasting Co. You protect cash, margin and collections while keeping good customers happy.",
  support: "You are the Customer Success agent of Ember Roasting Co. You keep customers healthy and prevent churn within your credit authority.",
};

/**
 * Optional LLM brain (Anthropic Messages API, called directly from the browser
 * with the user's own key). Used only for judgement calls, capped per run, and
 * always falls back to the rule default on error / invalid output.
 */
export function createClaudeBrain(opts: { apiKey: string; model: string; maxCalls?: number; onCall?: (n: number) => void }): Brain {
  let calls = 0;
  const maxCalls = opts.maxCalls ?? 60;
  return {
    kind: "llm",
    async judge(j) {
      if (calls >= maxCalls) return { choice: j.defaultChoice, rationale: `${j.defaultRationale} (LLM budget exhausted → rules)`, source: "rules" };
      calls++;
      opts.onCall?.(calls);
      const prompt = [
        ROLE_PERSONA[j.role],
        "",
        `Decision: ${j.question}`,
        `Shared-record context (JSON): ${JSON.stringify(j.context)}`,
        `Options: ${j.options.map((o) => `"${o.id}" = ${o.label}`).join("; ")}`,
        `The rule-based default is "${j.defaultChoice}" because: ${j.defaultRationale}`,
        "",
        'Reply with ONLY compact JSON: {"choice":"<option id>","rationale":"<max 20 words>"}',
      ].join("\n");
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": opts.apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({ model: opts.model, max_tokens: 150, messages: [{ role: "user", content: prompt }] }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        const text: string = body?.content?.[0]?.text ?? "";
        const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
        if (!j.options.some((o) => o.id === parsed.choice)) throw new Error("invalid choice");
        return { choice: parsed.choice, rationale: String(parsed.rationale ?? "").slice(0, 160), source: "llm" };
      } catch (err) {
        return { choice: j.defaultChoice, rationale: `${j.defaultRationale} (LLM unavailable: ${(err as Error).message} → rules)`, source: "rules" };
      }
    },
  };
}
