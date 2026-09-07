import SSignal, { type ComputedSignal, computed } from 'ssignal';
import type { MetricType } from 'web-vitals';
import { onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals';
import { appendHistory, validateMaxHistory } from '../core/retainHistory';
import type {
  IWebVitalsCollector,
  WebVitalMetric,
  WebVitalName,
  WebVitalsCollectorConfig,
  WebVitalsSnapshot,
} from '../core/types';

const emptySnapshot = (): WebVitalsSnapshot => ({
  cls: null,
  fcp: null,
  inp: null,
  lcp: null,
  ttfb: null,
  entries: [],
});

export class WebVitalsCollector implements IWebVitalsCollector {
  #destroyed = false;
  readonly snapshot: ComputedSignal<WebVitalsSnapshot>;
  readonly onMetric: SSignal<WebVitalMetric | null>;

  #snapshot: SSignal<WebVitalsSnapshot>;
  #started = false;
  #registered = false;

  constructor(private readonly config: WebVitalsCollectorConfig) {
    validateMaxHistory(config.maxHistory);
    this.#snapshot = new SSignal<WebVitalsSnapshot>(emptySnapshot());
    this.onMetric = new SSignal<WebVitalMetric | null>(null);

    this.snapshot = computed([this.#snapshot], ([snapshot]): WebVitalsSnapshot => snapshot);
  }

  start(): void {
    if (this.#destroyed) {
      return;
    }

    if (typeof window === 'undefined') {
      return;
    }

    if (this.#started) {
      return;
    }

    this.#started = true;
    if (this.#registered) {
      return;
    }

    this.#registered = true;
    const opts = { reportAllChanges: this.config.reportAllChanges };

    onCLS((metric) => this.#record(metric), opts);
    onFCP((metric) => this.#record(metric), opts);
    onINP((metric) => this.#record(metric), opts);
    onLCP((metric) => this.#record(metric), opts);
    onTTFB((metric) => this.#record(metric), opts);
  }

  stop(): void {
    this.#started = false;
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }

    this.#destroyed = true;
    this.stop();
    this.snapshot.dispose();
  }

  clearLog(): void {
    this.#snapshot.value = emptySnapshot();
    this.onMetric.value = null;
  }

  #record(metric: MetricType): void {
    if (!this.#started) {
      return;
    }

    const nextMetric: WebVitalMetric = {
      name: metric.name as WebVitalName,
      value: metric.value,
      delta: metric.delta,
      rating: metric.rating,
      id: metric.id,
      navigationType: metric.navigationType,
      timestamp: Date.now(),
    };

    this.#snapshot.value = (prev: WebVitalsSnapshot): WebVitalsSnapshot => ({
      ...prev,
      [nextMetric.name.toLowerCase()]: nextMetric,
      entries: appendHistory(prev.entries, [nextMetric], this.config.maxHistory),
    });
    this.onMetric.value = nextMetric;
  }
}
