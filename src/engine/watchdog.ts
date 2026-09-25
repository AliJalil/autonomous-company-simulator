import { HEARTBEAT_TIMEOUT, fmtTick } from "./constants";
import type { EngineApi } from "./context";
import { COVERABLE } from "./guard";
import type { Fault, Role } from "./types";
import { ROLES } from "./types";

const TITLES: Record<Role, string> = { sales: "Sales", ops: "Ops", finance: "Finance", support: "Support" };

/**
 * Control plane — deliberately NOT an AI. It only reads heartbeats from the
 * shared record system and writes status/coverage records back into it.
 * Agents learn about each other's failures exclusively from those records.
 */
export function runWatchdog(api: EngineApi, faults: Fault[]) {
  const s = api.state;
  const t = api.now;
  for (const role of ROLES) {
    const a = s.agents[role];
    const silentFor = t - a.lastHeartbeat;

    if (!a.detectedDown && silentFor > HEARTBEAT_TIMEOUT) {
      api.commit("watchdog", {
        type: "AGENT_DOWN_DETECTED",
        summary: `${TITLES[role]} agent missed heartbeats for ${silentFor}h — marked DOWN`,
        reason: `No heartbeat since ${fmtTick(a.lastHeartbeat)}`,
        data: { role },
      });
      if (api.compensation) {
        const cov = COVERABLE[role];
        api.commit("watchdog", {
          type: "COVERAGE_ASSIGNED",
          summary: `${TITLES[cov.by]} now covers part of ${TITLES[role]}'s duties`,
          reason: cov.note,
          data: { role, by: cov.by },
        });
        const id = api.nextId("E");
        api.commit("watchdog", {
          type: "ESCALATION_RAISED",
          summary: `Escalated to HUMAN: ${TITLES[role]} agent is down`,
          reason: "Agent outages always reach a human; auto-restarts continue meanwhile.",
          data: {
            escalation: {
              id,
              from: "watchdog",
              to: "human",
              kind: "agent_down",
              title: `${TITLES[role]} agent is unresponsive — restart it manually?`,
              detail: `Degraded mode active: ${cov.note} Watchdog retries a restart every 6h.`,
              recommendation: "approve",
              onExpiry: "reject",
              ref: { type: "agent", id: role },
              createdAt: t,
              slaAt: t + 8,
              status: "open",
              labels: { approve: "Restart agent", reject: "Stay in degraded mode" },
            },
          },
        });
      }
      continue;
    }

    if (a.detectedDown && a.online && silentFor <= 1) {
      api.commit("watchdog", {
        type: "AGENT_RECOVERY_DETECTED",
        summary: `${TITLES[role]} agent heartbeat is back — marked UP`,
        reason: `Down for ${t - (a.downSince ?? t)}h`,
        data: { role },
      });
      if (s.agents[COVERABLE[role].by].covering.includes(role))
        api.commit("watchdog", {
          type: "COVERAGE_ENDED",
          summary: `${TITLES[COVERABLE[role].by]} hands ${TITLES[role]}'s duties back`,
          data: { role },
        });
      continue;
    }

    // Auto-restart attempts every 6h while down.
    if (a.detectedDown && !a.online && a.downSince !== undefined && (t - a.downSince) % 6 === 5) {
      const fault = faults.find((f) => f.role === role && f.atTick <= t);
      const success = fault ? t >= fault.recoverableAfter : false;
      api.commit("watchdog", {
        type: "RESTART_ATTEMPTED",
        summary: `Auto-restart of ${TITLES[role]} agent ${success ? "succeeded" : "failed"} (attempt ${a.restartAttempts + 1})`,
        reason: success ? "Underlying fault cleared" : "Process crashes on start (dependency still failing)",
        data: { role, success },
      });
    }
  }
}
