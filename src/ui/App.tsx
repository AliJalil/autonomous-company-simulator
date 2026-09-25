import { useState } from "react";
import { getScenario } from "../engine";
import { AgentsPanel } from "./components/AgentsPanel";
import { Architecture } from "./components/Architecture";
import { ChartsPanel } from "./components/Charts";
import { FailureTest } from "./components/FailureTest";
import { Feed } from "./components/Feed";
import { Header } from "./components/Header";
import { Inbox } from "./components/Inbox";
import { KpiStrip } from "./components/KpiStrip";
import { LlmModal } from "./components/LlmModal";
import { Records } from "./components/Records";
import { Timeline } from "./components/Timeline";
import { useSimulation } from "./useSimulation";

const TABS = [
  { id: "feed", label: "Live operations" },
  { id: "charts", label: "KPIs over time" },
  { id: "records", label: "Shared records" },
  { id: "failure", label: "Failure test" },
  { id: "architecture", label: "Architecture" },
] as const;

export default function App() {
  const h = useSimulation();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("feed");
  const [settings, setSettings] = useState(false);
  const [showBrief, setShowBrief] = useState(true);
  const { view, sim } = h;
  const sc = getScenario(h.scenarioId);

  return (
    <div className="min-h-full">
      <Header h={h} onOpenSettings={() => setSettings(true)} />

      <main className="mx-auto max-w-[1680px] space-y-3 px-4 py-3">
        {showBrief && (
          <div className="panel relative flex flex-col gap-2 p-3 md:flex-row md:items-start md:gap-6">
            <div className="md:w-[45%]">
              <div className="flex items-center gap-2">
                <span className="chip bg-amber-400/15 text-amber-200">{sc.tagline}</span>
                <span className="text-sm font-semibold text-white">{sc.name}</span>
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-slate-400">{sc.description}</p>
            </div>
            <div className="flex-1">
              <div className="panel-title mb-1">What to watch for</div>
              <ul className="grid gap-x-4 gap-y-0.5 text-[11.5px] text-slate-300 lg:grid-cols-2">
                {sc.watchFor.map((w) => (
                  <li key={w}>› {w}</li>
                ))}
              </ul>
            </div>
            <button className="absolute right-2 top-2 text-slate-500 hover:text-slate-300" onClick={() => setShowBrief(false)} aria-label="Hide scenario brief">
              ✕
            </button>
          </div>
        )}

        {!h.compensation && (
          <div className="rounded-lg border border-orange-400/30 bg-orange-400/10 px-3 py-1.5 text-[12px] text-orange-200">
            Naive baseline: compensation is OFF — agents ignore peer failures and outages are not escalated. Use it to compare against the compensated run.
          </div>
        )}

        <KpiStrip history={view.history} />

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[300px_minmax(0,1fr)_330px]">
          <aside className="order-2 min-w-0 lg:order-1">
            <AgentsPanel state={view.state} now={view.isReplay ? view.tick + 1 : sim.now} readOnly={view.isReplay} onToggle={h.toggleAgent} />
          </aside>

          <section className="panel order-1 flex min-w-0 min-h-[560px] flex-col p-3 lg:order-2 lg:h-[calc(100vh-270px)] lg:min-h-[620px]">
            <div className="mb-3 flex flex-wrap gap-1 border-b border-white/[0.06] pb-2">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${tab === t.id ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200"}`}
                >
                  {t.label}
                </button>
              ))}
              {view.isReplay && <span className="chip ml-auto self-center bg-cyan-400/15 text-cyan-200">replay view · read-only</span>}
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
              {tab === "feed" && <Feed events={view.events} />}
              {tab === "charts" && <ChartsPanel history={view.history} events={view.events} totalTicks={sim.endTick} />}
              {tab === "records" && <Records state={view.state} now={view.isReplay ? view.tick : sim.now} />}
              {tab === "failure" && <FailureTest defaultScenario={h.scenarioId} />}
              {tab === "architecture" && <Architecture policy={view.state.policy} />}
            </div>
          </section>

          <aside className="order-3 min-w-0 lg:h-[calc(100vh-270px)] lg:min-h-[620px]">
            <Inbox state={view.state} now={view.isReplay ? view.tick : sim.now} readOnly={view.isReplay} flashKey={h.flashInbox} onResolve={h.resolve} />
          </aside>
        </div>

        <Timeline h={h} />

        <footer className="pb-6 pt-2 text-center text-[11px] text-slate-500">
          Ember Roasting Co. is fictional. Four agents · one event-sourced record system · guarded authority · human inbox · deterministic replay.
        </footer>
      </main>

      {settings && <LlmModal value={h.llm} onSave={h.applyLlm} onClose={() => setSettings(false)} />}
    </div>
  );
}
