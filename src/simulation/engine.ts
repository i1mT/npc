import { getStatus, setStatus } from "@/db/sim";
import { runAgenticDay } from "@/mastra";
import { SimFatalError } from "@/mastra/workflows/agentic-day";
import type { DayState } from "@/lib/types";
import { emitStatus } from "@/simulation/event-bus";

class SimClock {
  private runningPromise: Promise<void> | null = null;
  private stopRequested = false;
  private runningDay: number | null = null;
  private fatalError = false;

  getStatus() {
    const status = getStatus();
    if (status.status === "running" && this.runningDay == null) {
      if (this.runningPromise) {
        this.runningDay = status.day + 1;
      } else {
        setStatus("idle");
        return {
          ...status,
          status: "idle" as const,
          runningDay: null,
        };
      }
    }
    return {
      ...status,
      day: this.runningDay ?? status.day,
      runningDay: this.runningDay,
    };
  }

  async start(targetDays?: number) {
    if (this.runningPromise) return this.runningPromise;
    this.stopRequested = false;
    this.fatalError = false;
    this.runningDay = getStatus().day + 1;
    setStatus("running");
    this.runningPromise = this.loop(targetDays).finally(() => {
      this.runningPromise = null;
      this.runningDay = null;
      if (!this.fatalError) {
        setStatus(this.stopRequested ? "paused" : "idle");
        this.emitStatus(this.stopRequested ? "paused" : "idle");
      }
      this.fatalError = false;
    });
    return this.runningPromise;
  }

  stop() {
    this.stopRequested = true;
    if (!this.runningPromise) {
      setStatus("paused");
      this.emitStatus("paused");
    }
  }

  async advanceOneDay(): Promise<DayState> {
    if (this.runningPromise) {
      throw new Error("Simulation is already running.");
    }
    const status = getStatus();
    const nextDay = status.day + 1;
    this.runningDay = nextDay;
    this.fatalError = false;
    setStatus("running");
    this.emitStatus("day-start");
    try {
      const result = await runAgenticDay(nextDay);
      this.runningDay = null;
      setStatus("idle");
      this.emitStatus("idle");
      return result;
    } catch (err) {
      this.runningDay = null;
      this.fatalError = true;
      setStatus("error");
      this.emitStatus("error");
      this.fatalError = false;
      throw err;
    }
  }

  private async loop(targetDays?: number) {
    let completed = 0;
    while (!this.stopRequested) {
      const status = getStatus();
      if (targetDays && completed >= targetDays) break;
      this.runningDay = this.runningDay ?? status.day + 1;
      this.emitStatus("day-start");
      try {
        await runAgenticDay(this.runningDay);
      } catch (err) {
        if (err instanceof SimFatalError) {
          this.fatalError = true;
          setStatus("error");
          this.emitStatus("error");
          return; // stop loop, don't continue to next day
        }
        throw err;
      }
      completed += 1;
      await new Promise((resolve) => setTimeout(resolve, 250));
      this.runningDay = getStatus().day + 1;
    }
  }

  private emitStatus(reason: string) {
    const status = getStatus();
    emitStatus({
      ...status,
      day: this.runningDay ?? status.day,
      runningDay: this.runningDay,
      reason,
    });
  }
}

const globalForClock = globalThis as unknown as { simClock?: SimClock };

export const simClock = globalForClock.simClock ?? new SimClock();
globalForClock.simClock = simClock;
