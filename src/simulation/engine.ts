import { getStatus, setStatus } from "@/db/sim";
import { runAgenticDay } from "@/mastra";
import type { DayState } from "@/lib/types";

class SimClock {
  private runningPromise: Promise<void> | null = null;
  private stopRequested = false;

  getStatus() {
    return getStatus();
  }

  async start(targetDays?: number) {
    if (this.runningPromise) return this.runningPromise;
    this.stopRequested = false;
    setStatus("running");
    this.runningPromise = this.loop(targetDays).finally(() => {
      this.runningPromise = null;
      setStatus(this.stopRequested ? "paused" : "idle");
    });
    return this.runningPromise;
  }

  stop() {
    this.stopRequested = true;
    if (!this.runningPromise) setStatus("paused");
  }

  async advanceOneDay(): Promise<DayState> {
    if (this.runningPromise) {
      throw new Error("Simulation is already running.");
    }
    const status = getStatus();
    setStatus("running");
    try {
      return await runAgenticDay(status.day + 1);
    } finally {
      setStatus("idle");
    }
  }

  private async loop(targetDays?: number) {
    let completed = 0;
    while (!this.stopRequested) {
      const status = getStatus();
      if (targetDays && completed >= targetDays) break;
      await runAgenticDay(status.day + 1);
      completed += 1;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

const globalForClock = globalThis as unknown as { simClock?: SimClock };

export const simClock = globalForClock.simClock ?? new SimClock();
globalForClock.simClock = simClock;
