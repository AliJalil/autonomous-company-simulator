import { useState } from "react";
import type { LlmSettings } from "../useSimulation";

export function LlmModal({ value, onSave, onClose }: { value: LlmSettings; onSave: (v: LlmSettings) => void; onClose: () => void }) {
  const [v, setV] = useState(value);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="panel w-full max-w-lg !bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="text-base font-bold text-white">🧠 Agent brain</div>
        <p className="mt-1 text-[12px] leading-relaxed text-slate-400">
          By default every agent runs a deterministic policy brain (reproducible, free, no keys). Switch on Claude to let the agents make their <b>judgement calls</b> with an LLM — quote
          discounts, churn saves, credit holds. Every LLM decision is still validated by the guard against the role's authority, logged with its rationale, and replayable from the log.
        </p>
        <label className="mt-4 flex items-center gap-2 text-sm text-slate-200">
          <input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} className="accent-fuchsia-400" />
          Use Claude for judgement calls
        </label>
        <div className="mt-3 grid gap-3">
          <label className="text-[11px] text-slate-400">
            Anthropic API key (kept in memory only, sent directly from your browser to api.anthropic.com)
            <input
              type="password"
              value={v.apiKey}
              onChange={(e) => setV({ ...v, apiKey: e.target.value })}
              placeholder="sk-ant-…"
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-slate-100 outline-none focus:border-fuchsia-400/50"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[11px] text-slate-400">
              Model
              <input value={v.model} onChange={(e) => setV({ ...v, model: e.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-slate-100 outline-none" />
            </label>
            <label className="text-[11px] text-slate-400">
              Max LLM calls per run
              <input
                type="number"
                min={1}
                max={500}
                value={v.maxCalls}
                onChange={(e) => setV({ ...v, maxCalls: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-slate-100 outline-none"
              />
            </label>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              onSave(v);
              onClose();
            }}
          >
            Apply & restart run
          </button>
        </div>
      </div>
    </div>
  );
}
