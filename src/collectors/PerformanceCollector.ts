import SSignal, { batch, type ComputedSignal, computed } from 'ssignal';
import { appendHistory, validateMaxHistory } from '../core/retainHistory';
import type {
  IPerformanceCollector,
  LongAnimationFrameEntry,
  LongAnimationFrameInfo,
  LongAnimationFrameScript,
  LongTaskInfo,
  MemoryInfo,
  PerformanceCollectorConfig,
  PerformanceSnapshot,
} from '../core/types';

const MAX_LOAF_SCRIPTS = 5;
const MAX_LOAF_STRING = 500;

/** The fields read from a `PerformanceScriptTiming`, which TypeScript's DOM lib does not declare. */
interface ScriptTiming {
  invokerType?: unknown;
  invoker?: unknown;
  sourceURL?: unknown;
  sourceFunctionName?: unknown;
  duration: number;
  forcedStyleAndLayoutDuration?: unknown;
  pauseDuration?: unknown;
}

/** The fields read from a `PerformanceLongAnimationFrameTiming`. */
interface AnimationFrameTiming extends PerformanceEntry {
  blockingDuration?: unknown;
  renderStart?: unknown;
  styleAndLayoutStart?: unknown;
  firstUIEventTimestamp?: unknown;
  scripts?: readonly ScriptTiming[];
}

const emptyLongAnimationFrames = (): LongAnimationFrameInfo => ({
  count: 0,
  totalBlockingDuration: 0,
  maxBlockingDuration: null,
  entries: [],
});

function isHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function boundedString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value.slice(0, MAX_LOAF_STRING) : null;
}

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Copies only serializable fields; the browser's entries and their scripts are not retained. */
function summarizeFrame(frame: AnimationFrameTiming): LongAnimationFrameEntry {
  const scripts: LongAnimationFrameScript[] = [...(frame.scripts ?? [])]
    .sort((left, right) => right.duration - left.duration)
    .slice(0, MAX_LOAF_SCRIPTS)
    .map((script) => ({
      invokerType: boundedString(script.invokerType),
      invoker: boundedString(script.invoker),
      sourceURL: boundedString(script.sourceURL),
      sourceFunctionName: boundedString(script.sourceFunctionName),
      duration: finiteOrZero(script.duration),
      forcedStyleAndLayoutDuration: finiteOrZero(script.forcedStyleAndLayoutDuration),
      pauseDuration: finiteOrZero(script.pauseDuration),
    }));

  return {
    startTime: frame.startTime,
    duration: frame.duration,
    blockingDuration: finiteOrZero(frame.blockingDuration),
    renderStart: finiteOrZero(frame.renderStart),
    styleAndLayoutStart: finiteOrZero(frame.styleAndLayoutStart),
    firstUIEventTimestamp: finiteOrZero(frame.firstUIEventTimestamp),
    scripts,
    timestamp: Math.round(performance.timeOrigin + frame.startTime + frame.duration),
  };
}

declare global {
  interface Performance {
    memory?: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
  }
}

export class PerformanceCollector implements IPerformanceCollector {
  #destroyed = false;
  readonly fps: SSignal<number>;
  readonly fpsHistory: SSignal<number[]>;
  readonly memory: SSignal<MemoryInfo | null>;
  readonly memoryHistory: SSignal<number[]>;
  readonly longTasks: SSignal<LongTaskInfo>;
  readonly longAnimationFrames: SSignal<LongAnimationFrameInfo>;
  readonly cls: SSignal<number>;
  readonly snapshot: ComputedSignal<PerformanceSnapshot>;

  #rafId: number | null = null;
  #frameCount = 0;
  #lastFpsTime = 0;
  #longTaskObserver: PerformanceObserver | null = null;
  #clsObserver: PerformanceObserver | null = null;
  #loafObserver: PerformanceObserver | null = null;
  #loafStarted = false;
  /** `performance.now()` of the latest restart; buffered frames before it were already counted. */
  #loafAcceptFrom = 0;
  #memoryInterval: ReturnType<typeof setInterval> | null = null;
  #started = false;
  #generation = 0;
  #clsSessionValue = 0;
  #clsSessionStart = 0;
  #clsLastShift = 0;

  constructor(private readonly config: PerformanceCollectorConfig) {
    validateMaxHistory(config.maxHistory);
    this.fps = new SSignal(0);
    this.fpsHistory = new SSignal<number[]>([]);
    this.memory = new SSignal<MemoryInfo | null>(this.#readMemory());
    this.memoryHistory = new SSignal<number[]>([]);
    this.longTasks = new SSignal<LongTaskInfo>({ count: 0, lastDuration: null });
    this.longAnimationFrames = new SSignal(emptyLongAnimationFrames());
    this.cls = new SSignal(0);

    this.snapshot = computed(
      [
        this.fps,
        this.fpsHistory,
        this.memory,
        this.memoryHistory,
        this.longTasks,
        this.longAnimationFrames,
        this.cls,
      ],
      ([
        fps,
        fpsHistory,
        memory,
        memoryHistory,
        longTasks,
        longAnimationFrames,
        cls,
      ]): PerformanceSnapshot => ({
        fps,
        fpsHistory,
        memory,
        memoryHistory,
        longTasks,
        longAnimationFrames,
        cls,
      }),
    );
  }

  start(): void {
    if (this.#destroyed) {
      return;
    }

    if (typeof window === 'undefined' || this.#started) {
      return;
    }

    this.#started = true;

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.#onVisibilityChange);
    }

    this.#startFps();
    this.#startMemory();
    this.#startLongTasks();
    this.#startLongAnimationFrames();
    this.#startCls();
  }

  stop(): void {
    this.#started = false;

    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.#onVisibilityChange);
    }

    this.#generation += 1;
    this.#clsSessionValue = 0;
    this.#frameCount = 0;
    this.#lastFpsTime = 0;

    if (this.#rafId !== null) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = null;
    }

    this.#pauseMemory();

    this.#longTaskObserver?.disconnect();
    this.#clsObserver?.disconnect();
    this.#loafObserver?.disconnect();
    this.#longTaskObserver = null;
    this.#clsObserver = null;
    this.#loafObserver = null;
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }

    this.#destroyed = true;
    this.stop();
    this.snapshot.dispose();
  }

  clearHistory(): void {
    // One snapshot notification for all three histories.
    batch(() => {
      this.fpsHistory.value = [];
      this.memoryHistory.value = [];
      this.longAnimationFrames.value = (prev: LongAnimationFrameInfo) => ({
        ...prev,
        entries: [],
      });
    });
  }

  #startFps(): void {
    if (typeof requestAnimationFrame !== 'function' || typeof cancelAnimationFrame !== 'function') {
      return;
    }

    const generation = this.#generation;
    const loop = (time: number) => {
      if (!this.#started || generation !== this.#generation) {
        return;
      }

      if (isHidden()) {
        this.#lastFpsTime = 0;
        this.#frameCount = 0;
        this.#rafId = requestAnimationFrame(loop);

        return;
      }

      if (this.#lastFpsTime === 0) {
        this.#lastFpsTime = time;
        this.#frameCount = 0;
        this.#rafId = requestAnimationFrame(loop);

        return;
      }

      this.#frameCount++;
      const elapsed = time - this.#lastFpsTime;

      if (elapsed >= 1000) {
        const fps = Math.round((this.#frameCount * 1000) / elapsed);

        this.#lastFpsTime = time;
        this.#frameCount = 0;
        // Both are snapshot sources: batching notifies once, never with a stale history.
        batch(() => {
          this.fps.value = fps;
          this.fpsHistory.value = (prev: number[]) =>
            appendHistory(prev, [fps], this.config.maxHistory);
        });
      }

      if (this.#started && generation === this.#generation) {
        this.#rafId = requestAnimationFrame(loop);
      }
    };

    this.#rafId = requestAnimationFrame(loop);
  }

  #onVisibilityChange = (): void => {
    this.#lastFpsTime = 0;
    this.#frameCount = 0;

    if (isHidden()) {
      this.#pauseMemory();
    } else {
      this.#startMemory();
    }
  };

  /** Samples memory every two seconds while the page is visible; hidden time is not recorded. */
  #startMemory(): void {
    if (this.#memoryInterval !== null || isHidden()) {
      return;
    }

    const update = () => {
      if (!this.#started) {
        return;
      }

      const mem = this.#readMemory();

      batch(() => {
        this.memory.value = mem;

        if (mem !== null) {
          this.memoryHistory.value = (prev: number[]) =>
            appendHistory(prev, [mem.percent], this.config.maxHistory);
        }
      });
    };

    this.#memoryInterval = setInterval(update, 2000);
  }

  #pauseMemory(): void {
    if (this.#memoryInterval !== null) {
      clearInterval(this.#memoryInterval);
      this.#memoryInterval = null;
    }
  }

  #startLongTasks(): void {
    const generation = this.#generation;

    try {
      this.#longTaskObserver = new PerformanceObserver((list) => {
        if (!this.#started || generation !== this.#generation) {
          return;
        }

        for (const entry of list.getEntries()) {
          this.longTasks.value = (prev: LongTaskInfo) => ({
            count: prev.count + 1,
            lastDuration: entry.duration,
          });
        }
      });
      this.#longTaskObserver.observe({ type: 'longtask', buffered: false });
    } catch {
      // longtask not supported in this browser
    }
  }

  #startLongAnimationFrames(): void {
    const generation = this.#generation;

    // Buffered delivery includes frames from page load; after a restart those were already counted.
    this.#loafAcceptFrom = this.#loafStarted ? performance.now() : 0;
    this.#loafStarted = true;

    try {
      this.#loafObserver = new PerformanceObserver((list) => {
        if (!this.#started || generation !== this.#generation) {
          return;
        }

        this.#recordLongAnimationFrames(list.getEntries() as AnimationFrameTiming[]);
      });
      this.#loafObserver.observe({ type: 'long-animation-frame', buffered: true });
    } catch {
      // long-animation-frame not supported in this browser
      this.#loafObserver = null;
    }
  }

  /** Folds one observer batch into a single update. */
  #recordLongAnimationFrames(frames: AnimationFrameTiming[]): void {
    const added = frames
      .filter((frame) => frame.startTime + frame.duration >= this.#loafAcceptFrom)
      .map(summarizeFrame);

    if (added.length === 0) {
      return;
    }

    this.longAnimationFrames.value = (prev: LongAnimationFrameInfo) => {
      let { totalBlockingDuration, maxBlockingDuration } = prev;

      for (const frame of added) {
        totalBlockingDuration += frame.blockingDuration;
        maxBlockingDuration = Math.max(maxBlockingDuration ?? 0, frame.blockingDuration);
      }

      return {
        count: prev.count + added.length,
        totalBlockingDuration,
        maxBlockingDuration,
        entries: appendHistory(prev.entries, added, this.config.maxHistory),
      };
    };
  }

  #startCls(): void {
    const generation = this.#generation;

    try {
      this.#clsObserver = new PerformanceObserver((list) => {
        if (!this.#started || generation !== this.#generation) {
          return;
        }

        for (const entry of list.getEntries()) {
          const ls = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };

          if (!ls.hadRecentInput) {
            if (
              this.#clsSessionValue > 0 &&
              ls.startTime - this.#clsLastShift < 1000 &&
              ls.startTime - this.#clsSessionStart < 5000
            ) {
              this.#clsSessionValue += ls.value;
            } else {
              this.#clsSessionStart = ls.startTime;
              this.#clsSessionValue = ls.value;
            }

            this.#clsLastShift = ls.startTime;
            this.cls.value = Math.max(this.cls.value, this.#clsSessionValue);
          }
        }
      });
      this.#clsObserver.observe({ type: 'layout-shift', buffered: false });
    } catch {
      // layout-shift not supported
    }
  }

  #readMemory(): MemoryInfo | null {
    if (typeof performance === 'undefined' || !performance.memory) {
      return null;
    }

    const m = performance.memory;
    const used = m.usedJSHeapSize / 1_048_576;
    const total = m.jsHeapSizeLimit / 1_048_576;

    return {
      used: Math.round(used * 10) / 10,
      total: Math.round(total * 10) / 10,
      percent: Math.round((used / total) * 1000) / 10,
    };
  }
}
