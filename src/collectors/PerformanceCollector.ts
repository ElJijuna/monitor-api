import SSignal, { computed } from 'ssignal';
import { appendHistory } from '../core/retainHistory';
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
  readonly fps: SSignal<number>;
  readonly fpsHistory: SSignal<number[]>;
  readonly memory: SSignal<MemoryInfo | null>;
  readonly memoryHistory: SSignal<number[]>;
  readonly longTasks: SSignal<LongTaskInfo>;
  readonly cls: SSignal<number>;
  readonly snapshot: SSignal<PerformanceSnapshot>;

  #rafId: number | null = null;
  #frameCount = 0;
  #lastFpsTime = 0;
  #longTaskObserver: PerformanceObserver | null = null;
  #clsObserver: PerformanceObserver | null = null;
  #memoryInterval: ReturnType<typeof setInterval> | null = null;
  #started = false;

  constructor(private readonly config: PerformanceCollectorConfig) {
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
    if (typeof window === 'undefined' || this.#started) {
      return;
    }

    this.#started = true;
    this.#startFps();
    this.#startMemory();
    this.#startLongTasks();
    this.#startCls();
  }

  stop(): void {
    this.#started = false;
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
    this.stop();
  }

  clearHistory(): void {
    this.fpsHistory.value = [];
    this.memoryHistory.value = [];
  }

  #startFps(): void {
    const loop = (time: number) => {
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

      this.#rafId = requestAnimationFrame(loop);
    };

    this.#rafId = requestAnimationFrame(loop);
  }

  #startMemory(): void {
    const update = () => {
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
    try {
      this.#longTaskObserver = new PerformanceObserver((list) => {
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
    try {
      this.#clsObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const ls = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };

          if (!ls.hadRecentInput) {
            this.cls.value = (prev: number) => prev + ls.value;
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
