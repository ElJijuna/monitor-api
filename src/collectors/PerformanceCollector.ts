import SSignal, { type ComputedSignal, computed } from 'ssignal';
import { appendHistory, validateMaxHistory } from '../core/retainHistory';
import type {
  IPerformanceCollector,
  LongTaskInfo,
  MemoryInfo,
  PerformanceCollectorConfig,
  PerformanceSnapshot,
} from '../core/types';

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
  readonly cls: SSignal<number>;
  readonly snapshot: ComputedSignal<PerformanceSnapshot>;

  #rafId: number | null = null;
  #frameCount = 0;
  #lastFpsTime = 0;
  #longTaskObserver: PerformanceObserver | null = null;
  #clsObserver: PerformanceObserver | null = null;
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
    this.cls = new SSignal(0);

    this.snapshot = computed(
      [this.fps, this.fpsHistory, this.memory, this.memoryHistory, this.longTasks, this.cls],
      ([fps, fpsHistory, memory, memoryHistory, longTasks, cls]): PerformanceSnapshot => ({
        fps,
        fpsHistory,
        memory,
        memoryHistory,
        longTasks,
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

    if (this.#memoryInterval !== null) {
      clearInterval(this.#memoryInterval);
      this.#memoryInterval = null;
    }

    this.#longTaskObserver?.disconnect();
    this.#clsObserver?.disconnect();
    this.#longTaskObserver = null;
    this.#clsObserver = null;
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
    this.fpsHistory.value = [];
    this.memoryHistory.value = [];
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

      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
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
        this.fps.value = fps;
        this.fpsHistory.value = (prev: number[]) =>
          appendHistory(prev, [fps], this.config.maxHistory);
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
  };

  #startMemory(): void {
    const update = () => {
      if (!this.#started) {
        return;
      }

      const mem = this.#readMemory();

      this.memory.value = mem;
      if (mem !== null) {
        this.memoryHistory.value = (prev: number[]) =>
          appendHistory(prev, [mem.percent], this.config.maxHistory);
      }
    };

    this.#memoryInterval = setInterval(update, 2000);
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
