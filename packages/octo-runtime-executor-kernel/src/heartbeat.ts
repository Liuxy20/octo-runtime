import { performance } from "node:perf_hooks";

/** A paused supervisor cannot establish worker failure; require a fresh probe after a gap. */
export class WorkerHeartbeat {
  #wall: number;
  #mono: number;
  #sequence = 0;
  #pending?: { id: number; deadline: number };
  #answered = false;
  activeMs = 0;
  healthyMs = 0;
  constructor(
    private readonly wallNow = Date.now,
    private readonly monotonicNow = () => performance.now()
  ) {
    this.#wall = wallNow();
    this.#mono = monotonicNow();
  }
  #gap(wall: number, mono: number): boolean {
    return (
      wall < this.#wall ||
      mono < this.#mono ||
      wall - this.#wall >= 5000 ||
      mono - this.#mono >= 5000
    );
  }
  tick(): { type: "ping"; id: number } | { type: "waiting" | "expired" } {
    const wall = this.wallNow(),
      mono = this.monotonicNow();
    // Either clock can reveal suspend or a blocked supervisor; discard pre-gap liveness evidence.
    if (this.#gap(wall, mono)) {
      this.#pending = undefined;
      this.#answered = false;
      this.healthyMs = 0;
    } else {
      const elapsed = mono - this.#mono;
      this.activeMs += elapsed;
      if (this.#answered) this.healthyMs += elapsed;
    }
    this.#wall = wall;
    this.#mono = mono;
    this.#answered = false;
    // Ordinary timer ticks never renew an unanswered probe's fixed deadline.
    if (this.#pending) return { type: mono >= this.#pending.deadline ? "expired" : "waiting" };
    this.#pending = { id: ++this.#sequence, deadline: mono + 5000 };
    return { type: "ping", id: this.#sequence };
  }
  pong(id: unknown): void {
    const wall = this.wallNow(),
      mono = this.monotonicNow();
    // A queued or stale pong cannot establish post-resume health or extend the new deadline.
    if (
      this.#gap(wall, mono) ||
      !this.#pending ||
      id !== this.#pending.id ||
      mono >= this.#pending.deadline
    )
      return;
    this.#pending = undefined;
    this.#answered = true;
  }
}
