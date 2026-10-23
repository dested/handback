/**
 * When someone is talking, from the mic's level alone — what the frame rule
 * needs to give each spoken line its picture while the take is still running
 * (`LiveFrames.openLine` / `closeLine`). Dictation finals can't drive it: they
 * land seconds after the words, and only when recognition is working at all.
 *
 * Fed the RMS of a ~50 ms window every ~50 ms. Speech starts once the level has
 * stayed above the room for ONSET_MS and is over once it has stayed below it for
 * HANGOVER_MS; both edges are stamped where the run began, not where it was
 * confirmed. "The room" is a floor that follows the quietest level heard: it
 * drops fast (a pause between words is the room) and rises slowly, so a fan that
 * switches on is absorbed within seconds instead of reading as one endless line.
 *
 * Mirrors `src/lib/capture/voice.ts` (the web recorder's copy); change one and
 * change the other — `voice.test.ts` there runs the same cases over both.
 */

/** Above the room this long before it counts as speech — a cough or a desk knock is shorter. */
export const ONSET_MS = 200;
/** Below the room this long before the line is over — the gap between sentences is shorter. */
export const HANGOVER_MS = 700;
/** No line opens before the floor has had this long to find the room. */
export const WARMUP_MS = 1000;
/** Speech starts this far above the floor (~+9.5 dB)… */
const OPEN_RATIO = 3;
/** …and keeps going while it stays this far above it (hysteresis). */
const CLOSE_RATIO = 2;
/** Absolute minimums: a dead-silent room must not turn breathing into lines. Raw mic, no AGC. */
const MIN_OPEN_RMS = 0.005;
const MIN_CLOSE_RMS = 0.0035;
const FLOOR_MIN = 1e-4;
/** The floor follows a quieter level within about this long… */
const FLOOR_FALL_MS = 250;
/** …and a louder one this slowly, slower still while someone is talking. */
const FLOOR_RISE_MS = 4000;
const FLOOR_RISE_SPEAKING_MS = 20000;
/** A gap between readings longer than this (a throttled timer) counts as this long. */
const MAX_STEP_MS = 500;

export interface VoiceEdge {
  kind: 'open' | 'close';
  /** ms into the take where the speech started or stopped. */
  t: number;
}

export class VoiceGate {
  private startT: number | null = null;
  private prevT: number | null = null;
  private level = 0;
  private open = false;
  /** Where the current run above the room began, while one is going and not yet a line. */
  private runSince: number | null = null;
  /** Where the current quiet began, while a line is open. */
  private quietSince: number | null = null;

  /** Speech is in progress. */
  get speaking(): boolean {
    return this.open;
  }

  /** The room's level as the gate currently believes it. */
  get floor(): number {
    return this.level;
  }

  /** One reading: `rms` of the mic around `t` ms into the take. Returns an edge when speech starts or stops. */
  push(t: number, rms: number): VoiceEdge | null {
    if (this.startT === null) {
      this.startT = t;
      this.level = Math.max(FLOOR_MIN, rms);
    }
    const dt = this.prevT === null ? 0 : Math.min(MAX_STEP_MS, Math.max(0, t - this.prevT));
    this.prevT = t;

    const openAt = Math.max(MIN_OPEN_RMS, this.level * OPEN_RATIO);
    const closeAt = Math.max(MIN_CLOSE_RMS, this.level * CLOSE_RATIO);
    let edge: VoiceEdge | null = null;
    if (!this.open) {
      if (rms > (this.runSince === null ? openAt : closeAt)) {
        if (this.runSince === null) this.runSince = t;
        if (t - this.runSince >= ONSET_MS && t - this.startT >= WARMUP_MS) {
          this.open = true;
          this.quietSince = null;
          edge = { kind: 'open', t: this.runSince };
        }
      } else {
        this.runSince = null;
      }
    } else if (rms > closeAt) {
      this.quietSince = null;
    } else {
      if (this.quietSince === null) this.quietSince = t;
      if (t - this.quietSince >= HANGOVER_MS) {
        edge = this.shut(this.quietSince);
      }
    }

    const tc = rms < this.level ? FLOOR_FALL_MS : this.open ? FLOOR_RISE_SPEAKING_MS : FLOOR_RISE_MS;
    this.level = Math.max(FLOOR_MIN, this.level + (rms - this.level) * Math.min(1, dt / tc));
    return edge;
  }

  /** The take ended at `t`: close a line that is still open. */
  finish(t: number): VoiceEdge | null {
    if (!this.open) return null;
    return this.shut(this.quietSince ?? t);
  }

  private shut(t: number): VoiceEdge {
    this.open = false;
    this.runSince = null;
    this.quietSince = null;
    return { kind: 'close', t };
  }
}

/** Root mean square of one window of samples. */
export function rmsOf(buf: Float32Array): number {
  if (!buf.length) return 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}
