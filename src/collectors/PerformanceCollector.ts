import SSignal, { batch, type ComputedSignal, computed } from 'ssignal';
import { appendHistory, validateMaxHistory } from '../core/retainHistory';
import type {
  IPerformanceCollector,
  LongAnimationFrameEntry,
  LongAnimationFrameInfo,
  LongAnimationFrameScript,
  LongTaskInfo,
  MemoryContext,
  MemoryInfo,
  MemoryMeasurement,
  PerformanceCollectorConfig,
  PerformanceSnapshot,
} from '../core/types';

const MAX_LOAF_SCRIPTS = 5;
const MAX_LOAF_STRING = 500;
const DEFAULT_MEMORY_MEASUREMENT_INTERVAL_MS = 300_000;
const MAX_MEMORY_CONTEXTS = 20;
/** What the browser reports as the URL of a cross-origin frame. */
const CROSS_ORIGIN_URL = 'cross-origin-url';
const MAX_TIMEOUT_MS = 2_147_483_647;

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

function normalizeMeasurementInterval(value: number | false | undefined): number | false {
  if (value === undefined) {
    return DEFAULT_MEMORY_MEASUREMENT_INTERVAL_MS;
  }

  if (value !== false && !(Number.isFinite(value) && value > 0)) {
    throw new RangeError(
      'performance.memoryMeasurementInterval must be a positive finite number or false',
    );
  }

  return value;
}

/** The API exists only in cross-origin isolated pages; elsewhere it throws a SecurityError. */
function canMeasureMemory(): boolean {
  return (
    typeof performance !== 'undefined' &&
    typeof performance.measureUserAgentSpecificMemory === 'function' &&
    globalThis.crossOriginIsolated === true
  );
}

/** Exponentially distributed delay, so measurements do not align with periodic work. */
function randomMeasurementDelay(mean: number): number {
  return Math.min(-Math.log(1 - Math.random()) * mean, mean * 10, MAX_TIMEOUT_MS);
}

function toMegabytes(bytes: number): number {
  return Math.round((bytes / 1_048_576) * 10) / 10;
}

function summarizeContext(attribution: MemoryAttribution): Omit<MemoryContext, 'total'> {
  const container =
    typeof attribution.container === 'object' && attribution.container !== null
      ? {
          id: boundedString(attribution.container.id),
          src: boundedString(attribution.container.src),
        }
      : null;

  return {
    url: attribution.url === CROSS_ORIGIN_URL ? null : boundedString(attribution.url),
    scope: boundedString(attribution.scope),
    container,
  };
}

function summarizeMeasurement(result: UserAgentSpecificMemory): MemoryMeasurement {
  const bytesByType = new Map<string, number>();
  const contexts = new Map<string, { context: Omit<MemoryContext, 'total'>; bytes: number }>();

  for (const entry of Array.isArray(result.breakdown) ? result.breakdown : []) {
    if (!(entry.bytes > 0)) {
      continue;
    }

    const types = Array.isArray(entry.types)
      ? entry.types.filter((t) => typeof t === 'string')
      : [];
    const key = types.length > 0 ? types.join('+') : 'Other';

    bytesByType.set(key, (bytesByType.get(key) ?? 0) + entry.bytes);

    // Memory attributed to several contexts is shared and cannot be split between them.
    if (Array.isArray(entry.attribution) && entry.attribution.length === 1) {
      const context = summarizeContext(entry.attribution[0] as MemoryAttribution);
      const contextKey = JSON.stringify(context);
      const existing = contexts.get(contextKey);

      if (existing) {
        existing.bytes += entry.bytes;
      } else {
        contexts.set(contextKey, { context, bytes: entry.bytes });
      }
    }
  }

  const byType: Record<string, number> = {};

  for (const [type, bytes] of bytesByType) {
    byType[type] = toMegabytes(bytes);
  }

  const byContext = [...contexts.values()]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, MAX_MEMORY_CONTEXTS)
    .map(({ context, bytes }) => ({ total: toMegabytes(bytes), ...context }));

  return {
    total: toMegabytes(finiteOrZero(result.bytes)),
    byType,
    byContext,
    timestamp: Date.now(),
  };
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

interface MemoryAttribution {
  url?: string;
  scope?: string;
  container?: { id?: string; src?: string };
}

interface UserAgentSpecificMemory {
  bytes: number;
  breakdown: Array<{ bytes: number; types: string[]; attribution?: MemoryAttribution[] }>;
}

declare global {
  interface Performance {
    memory?: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
    measureUserAgentSpecificMemory?: () => Promise<UserAgentSpecificMemory>;
  }
}

export class PerformanceCollector implements IPerformanceCollector {
  #destroyed = false;
  readonly fps: SSignal<number>;
  readonly fpsHistory: SSignal<number[]>;
  readonly memory: SSignal<MemoryInfo | null>;
  readonly memoryHistory: SSignal<number[]>;
  readonly memoryMeasurement: SSignal<MemoryMeasurement | null>;
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
  #measurementInterval: number | false;
  #measurementTimeout: ReturnType<typeof setTimeout> | null = null;
  #measuring = false;
  #measurementFailed = false;
  #started = false;
  #generation = 0;
  #clsSessionValue = 0;
  #clsSessionStart = 0;
  #clsLastShift = 0;

  constructor(private readonly config: PerformanceCollectorConfig) {
    validateMaxHistory(config.maxHistory);
    this.#measurementInterval = normalizeMeasurementInterval(config.memoryMeasurementInterval);
    this.fps = new SSignal(0);
    this.fpsHistory = new SSignal<number[]>([]);
    this.memory = new SSignal<MemoryInfo | null>(this.#readMemory());
    this.memoryHistory = new SSignal<number[]>([]);
    this.memoryMeasurement = new SSignal<MemoryMeasurement | null>(null);
    this.longTasks = new SSignal<LongTaskInfo>({ count: 0, lastDuration: null });
    this.longAnimationFrames = new SSignal(emptyLongAnimationFrames());
    this.cls = new SSignal(0);

    this.snapshot = computed(
      [
        this.fps,
        this.fpsHistory,
        this.memory,
        this.memoryHistory,
        this.memoryMeasurement,
        this.longTasks,
        this.longAnimationFrames,
        this.cls,
      ],
      ([
        fps,
        fpsHistory,
        memory,
        memoryHistory,
        memoryMeasurement,
        longTasks,
        longAnimationFrames,
        cls,
      ]): PerformanceSnapshot => ({
        fps,
        fpsHistory,
        memory,
        memoryHistory,
        memoryMeasurement,
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
    this.#measurementFailed = false;

    this.#listenLifecycle('addEventListener');

    this.#startFps();
    this.#startMemory();
    this.#startLongTasks();
    this.#startLongAnimationFrames();
    this.#startCls();
  }

  stop(): void {
    this.#started = false;

    this.#listenLifecycle('removeEventListener');

    this.#generation += 1;
    // A measurement still in flight belongs to the old generation and is discarded.
    this.#measuring = false;
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

  /**
   * Browsers freeze only hidden or back/forward-cached pages, so `freeze` pauses sampling like
   * `hidden`. `resume` and `pageshow` re-read the visibility state, so sampling restarts even
   * when a back/forward cache restore does not fire `visibilitychange`.
   */
  #listenLifecycle(method: 'addEventListener' | 'removeEventListener'): void {
    if (typeof document !== 'undefined') {
      document[method]('visibilitychange', this.#onLifecycleChange);
      document[method]('freeze', this.#onFreeze);
      document[method]('resume', this.#onLifecycleChange);
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window[method]('pageshow', this.#onLifecycleChange);
    }
  }

  #onLifecycleChange = (): void => {
    this.#syncSampling(isHidden());
  };

  #onFreeze = (): void => {
    this.#syncSampling(true);
  };

  /** Restarts the FPS baseline so a pause is never measured as slow frames. */
  #syncSampling(paused: boolean): void {
    this.#lastFpsTime = 0;
    this.#frameCount = 0;

    if (paused) {
      this.#pauseMemory();
    } else {
      this.#startMemory();
    }
  }

  /** Samples memory every two seconds while the page is visible; hidden time is not recorded. */
  #startMemory(): void {
    if (isHidden()) {
      return;
    }

    this.#scheduleMeasurement();

    if (this.#memoryInterval !== null) {
      return;
    }

    // Created only while started, and stop() clears it through #pauseMemory().
    const update = () => {
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

    if (this.#measurementTimeout !== null) {
      clearTimeout(this.#measurementTimeout);
      this.#measurementTimeout = null;
    }
  }

  /** Measures right away the first time, then after randomized delays while visible. */
  #scheduleMeasurement(): void {
    const mean = this.#measurementInterval;

    if (
      mean === false ||
      !this.#started ||
      isHidden() ||
      this.#measuring ||
      this.#measurementFailed ||
      this.#measurementTimeout !== null ||
      !canMeasureMemory()
    ) {
      return;
    }

    const delay = this.memoryMeasurement.value === null ? 0 : randomMeasurementDelay(mean);

    this.#measurementTimeout = setTimeout(() => {
      this.#measurementTimeout = null;
      void this.#measure();
    }, delay);
  }

  /** The browser resolves at its next garbage collection, which can take tens of seconds. */
  async #measure(): Promise<void> {
    const generation = this.#generation;
    const measure =
      performance.measureUserAgentSpecificMemory as () => Promise<UserAgentSpecificMemory>;

    let measurement: UserAgentSpecificMemory | null = null;

    this.#measuring = true;

    try {
      measurement = await measure.call(performance);
    } catch {
      // Rejections are not transient (for example a lost cross-origin isolation); retry on the next start().
    }

    if (generation !== this.#generation) {
      return;
    }

    this.#measuring = false;

    if (measurement === null) {
      this.#measurementFailed = true;

      return;
    }

    this.memoryMeasurement.value = summarizeMeasurement(measurement);
    this.#scheduleMeasurement();
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
