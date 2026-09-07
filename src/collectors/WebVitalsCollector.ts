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

type MetricSubscriber = (metric: MetricType) => void;

interface SharedChannel {
  registered: boolean;
  subscribers: Set<MetricSubscriber>;
}

const sharedChannels: Record<'allChanges' | 'finalChanges', SharedChannel> = {
  allChanges: { registered: false, subscribers: new Set() },
  finalChanges: { registered: false, subscribers: new Set() },
};

function subscribeToWebVitals(subscriber: MetricSubscriber, reportAllChanges: boolean): () => void {
  const channel = sharedChannels[reportAllChanges ? 'allChanges' : 'finalChanges'];

  channel.subscribers.add(subscriber);

  if (!channel.registered) {
    channel.registered = true;

    const publish = (metric: MetricType) => {
      for (const currentSubscriber of channel.subscribers) {
        currentSubscriber(metric);
      }
    };
    const opts = { reportAllChanges };

    onCLS(publish, opts);
    onFCP(publish, opts);
    onINP(publish, opts);
    onLCP(publish, opts);
    onTTFB(publish, opts);
  }

  return () => channel.subscribers.delete(subscriber);
}

export class WebVitalsCollector implements IWebVitalsCollector {
  #destroyed = false;
  readonly snapshot: ComputedSignal<WebVitalsSnapshot>;
  readonly onMetric: SSignal<WebVitalMetric | null>;

  #snapshot: SSignal<WebVitalsSnapshot>;
  #started = false;
  #unsubscribe: (() => void) | null = null;

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
    this.#unsubscribe = subscribeToWebVitals(
      (metric) => this.#record(metric),
      this.config.reportAllChanges,
    );
  }

  stop(): void {
    this.#started = false;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
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
