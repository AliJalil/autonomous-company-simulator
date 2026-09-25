import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RuleBrain, Simulation, createClaudeBrain, getScenario, replay, type Brain, type CompanyState, type KpiSnapshot, type SimEvent } from "../engine";

export interface LlmSettings {
  enabled: boolean;
  apiKey: string;
  model: string;
  maxCalls: number;
}

export interface View {
  state: CompanyState;
  history: KpiSnapshot[];
  events: SimEvent[];
  tick: number;
  isReplay: boolean;
}

export function useSimulation() {
  const [scenarioId, setScenarioId] = useState("baseline");
  const [compensation, setCompensation] = useState(true);
  const [llm, setLlm] = useState<LlmSettings>({ enabled: false, apiKey: "", model: "claude-sonnet-4-5", maxCalls: 40 });
  const [llmCalls, setLlmCalls] = useState(0);
  const simRef = useRef<Simulation | null>(null);
  const [, setVersion] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(6); // sim-hours per second
  const [pauseOnEscalation, setPauseOnEscalation] = useState(true);
  const [replayTick, setReplayTick] = useState<number | null>(null);
  const [flashInbox, setFlashInbox] = useState(0);
  const playingRef = useRef(false);

  const makeBrain = (cfg: LlmSettings): Brain =>
    cfg.enabled && cfg.apiKey ? createClaudeBrain({ apiKey: cfg.apiKey, model: cfg.model, maxCalls: cfg.maxCalls, onCall: setLlmCalls }) : RuleBrain;

  const reset = useCallback(
    (id = scenarioId, comp = compensation, cfg = llm) => {
      playingRef.current = false;
      setPlaying(false);
      setReplayTick(null);
      setLlmCalls(0);
      const sim = new Simulation({ scenario: getScenario(id), compensation: comp, brain: makeBrain(cfg) });
      sim.subscribe(() => setVersion((v) => v + 1));
      simRef.current = sim;
      setVersion((v) => v + 1);
    },
    [scenarioId, compensation, llm],
  );

  if (!simRef.current) {
    const sim = new Simulation({ scenario: getScenario(scenarioId), compensation, brain: RuleBrain });
    sim.subscribe(() => setVersion((v) => v + 1));
    simRef.current = sim;
  }
  const sim = simRef.current;

  const openHuman = () => Object.values(sim.state.inbox).filter((e) => e.status === "open" && e.to === "human").length;

  const step = useCallback(async (n = 1) => {
    const s = simRef.current!;
    setReplayTick(null);
    for (let i = 0; i < n && !s.done; i++) {
      const before = Object.values(s.state.inbox).filter((e) => e.status === "open" && e.to === "human").length;
      await s.step();
      const after = Object.values(s.state.inbox).filter((e) => e.status === "open" && e.to === "human").length;
      if (after > before) {
        setFlashInbox((f) => f + 1);
        if (pauseOnEscalationRef.current && playingRef.current) {
          playingRef.current = false;
          setPlaying(false);
          return;
        }
      }
    }
  }, []);

  const pauseOnEscalationRef = useRef(pauseOnEscalation);
  pauseOnEscalationRef.current = pauseOnEscalation;
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const play = useCallback(async () => {
    if (playingRef.current) return;
    setReplayTick(null);
    playingRef.current = true;
    setPlaying(true);
    const s = simRef.current!;
    while (playingRef.current && !s.done && simRef.current === s) {
      const t0 = performance.now();
      await step(1);
      const wait = Math.max(0, 1000 / speedRef.current - (performance.now() - t0));
      await new Promise((r) => setTimeout(r, wait));
    }
    playingRef.current = false;
    setPlaying(false);
  }, [step]);

  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
  }, []);

  useEffect(() => () => void (playingRef.current = false), []);

  // Replay view: rebuild state purely from the log up to the chosen tick.
  const lastTick = Math.max(0, sim.now - 1);
  const view: View = useMemo(() => {
    if (replayTick === null || replayTick >= lastTick) {
      return { state: sim.state, history: sim.history, events: sim.events, tick: sim.now, isReplay: false };
    }
    const r = replay(sim.events, replayTick);
    return { state: r.state, history: sim.history.slice(0, replayTick + 1), events: sim.events.filter((e) => e.tick <= replayTick), tick: replayTick, isReplay: true };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayTick, sim, sim.events.length, lastTick]);

  return {
    sim,
    view,
    scenarioId,
    setScenario: (id: string) => {
      setScenarioId(id);
      reset(id, compensation);
    },
    compensation,
    setCompensation: (c: boolean) => {
      setCompensation(c);
      reset(scenarioId, c);
    },
    llm,
    applyLlm: (cfg: LlmSettings) => {
      setLlm(cfg);
      reset(scenarioId, compensation, cfg);
    },
    llmCalls,
    playing,
    play,
    pause,
    step,
    reset: () => reset(),
    speed,
    setSpeed,
    pauseOnEscalation,
    setPauseOnEscalation,
    replayTick,
    setReplayTick: (t: number | null) => {
      pause();
      setReplayTick(t);
    },
    flashInbox,
    openHuman,
    resolve: (id: string, d: "approve" | "reject") => sim.resolveEscalation(id, d, "decided in the human inbox"),
    toggleAgent: (role: Parameters<Simulation["setAgentOnline"]>[0], online: boolean) => sim.setAgentOnline(role, online),
  };
}

export type SimHandle = ReturnType<typeof useSimulation>;
