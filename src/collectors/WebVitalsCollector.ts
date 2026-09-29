import SSignal, { type ComputedSignal, computed } from 'ssignal';
import type { MetricType, MetricWithAttribution, ReportOpts } from 'web-vitals';
import { onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals';
import { appendHistory, validateMaxHistory } from '../core/retainHistory';
import type {
  IWebVitalsCollector,
  WebVitalAttributionMap,
  WebVitalMetric,
  WebVitalName,
  WebVitalsCollectorConfig,
  WebVitalsSnapshot,
} from '../core/types';

/** Bounds selectors, URLs, and invokers copied from the page. */
const MAX_ATTRIBUTION_STRING = 500;
const emptySnapshot = (): WebVitalsSnapshot => ({
  cls: null,
  fcp: null,
  inp: null,
  lcp: null,
  ttfb: null,
  entries: [],
});

type ReportedMetric = MetricType | MetricWithAttribution;
type MetricSubscriber = (metric: ReportedMetric) => void;
type Register = (callback: MetricSubscriber, opts: ReportOpts) => void;

interface WebVitalsApi {
  onCLS: Register;
  onFCP: Register;
  onINP: Register;
  onLCP: Register;
  onTTFB: Register;
}

interface SharedChannel {
  registered: boolean;
  subscribers: Set<MetricSubscriber>;
}

type ChannelKey = `${'all' | 'final'}Changes${'' | 'WithAttribution'}`;

const sharedChannels: Record<ChannelKey, SharedChannel> = {
  allChanges: { registered: false, subscribers: new Set() },
  finalChanges: { registered: false, subscribers: new Set() },
  allChangesWithAttribution: { registered: false, subscribers: new Set() },
  finalChangesWithAttribution: { registered: false, subscribers: new Set() },
};
const standardApi: WebVitalsApi = {
  onCLS: onCLS as Register,
  onFCP: onFCP as Register,
  onINP: onINP as Register,
  onLCP: onLCP as Register,
  onTTFB: onTTFB as Register,
};

/** Loaded on demand, so apps without attribution never download the larger build. */
function loadAttributionApi(): Promise<WebVitalsApi> {
  return import('web-vitals/attribution') as Promise<WebVitalsApi>;
}

function subscribeToWebVitals(
  subscriber: MetricSubscriber,
  reportAllChanges: boolean,
  attribution: boolean,
): () => void {
  const channel =
    sharedChannels[
      `${reportAllChanges ? 'all' : 'final'}Changes${attribution ? 'WithAttribution' : ''}`
    ];

  channel.subscribers.add(subscriber);

  if (!channel.registered) {
    channel.registered = true;

    const publish = (metric: ReportedMetric) => {
      for (const currentSubscriber of channel.subscribers) {
        currentSubscriber(metric);
      }
    };
    const register = (api: WebVitalsApi) => {
      const opts = { reportAllChanges };

      api.onCLS(publish, opts);
      api.onFCP(publish, opts);
      api.onINP(publish, opts);
      api.onLCP(publish, opts);
      api.onTTFB(publish, opts);
    };

    if (attribution) {
      void (async () => {
        try {
          register(await loadAttributionApi());
        } catch {
          // A failed chunk load leaves the channel unregistered, so a later start retries it.
          channel.registered = false;
        }
      })();
    } else {
      register(standardApi);
    }
  }

  return () => channel.subscribers.delete(subscriber);
}

function boundedString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value.slice(0, MAX_ATTRIBUTION_STRING) : null;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Copies only serializable fields; performance entries and DOM nodes are never retained. */
function summarizeAttribution(
  metric: ReportedMetric,
): WebVitalAttributionMap[WebVitalName] | undefined {
  if (!('attribution' in metric) || !metric.attribution) {
    return undefined;
  }

  switch (metric.name) {
    case 'LCP': {
      const a = metric.attribution;

      return {
        target: boundedString(a.target),
        url: boundedString(a.url),
        timeToFirstByte: a.timeToFirstByte,
        resourceLoadDelay: a.resourceLoadDelay,
        resourceLoadDuration: a.resourceLoadDuration,
        elementRenderDelay: a.elementRenderDelay,
      };
    }

    case 'INP': {
      const a = metric.attribution;
      const script = a.longestScript;

      return {
        interactionTarget: boundedString(a.interactionTarget),
        interactionType: a.interactionType ?? null,
        interactionTime: finiteOrNull(a.interactionTime),
        inputDelay: a.inputDelay,
        processingDuration: a.processingDuration,
        presentationDelay: a.presentationDelay,
        loadState: a.loadState ?? null,
        longestScript: script
          ? {
              url: boundedString(script.entry.sourceURL),
              invoker: boundedString(script.entry.invoker),
              invokerType: boundedString(script.entry.invokerType),
              subpart: script.subpart,
              intersectingDuration: script.intersectingDuration,
            }
          : null,
        totalScriptDuration: finiteOrNull(a.totalScriptDuration),
        totalStyleAndLayoutDuration: finiteOrNull(a.totalStyleAndLayoutDuration),
        totalPaintDuration: finiteOrNull(a.totalPaintDuration),
        totalUnattributedDuration: finiteOrNull(a.totalUnattributedDuration),
      };
    }

    case 'CLS': {
      const a = metric.attribution;

      return {
        largestShiftTarget: boundedString(a.largestShiftTarget),
        largestShiftTime: finiteOrNull(a.largestShiftTime),
        largestShiftValue: finiteOrNull(a.largestShiftValue),
        loadState: a.loadState ?? null,
      };
    }

    case 'FCP': {
      const a = metric.attribution;

      return {
        timeToFirstByte: a.timeToFirstByte,
        firstByteToFCP: a.firstByteToFCP,
        loadState: a.loadState ?? null,
      };
    }

    case 'TTFB': {
      const a = metric.attribution;

      return {
        waitingDuration: a.waitingDuration,
        cacheDuration: a.cacheDuration,
        dnsDuration: a.dnsDuration,
        connectionDuration: a.connectionDuration,
        requestDuration: a.requestDuration,
      };
    }

    default:
      return undefined;
  }
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
      this.config.attribution === true,
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

  #record(metric: ReportedMetric): void {
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
    const attribution = this.config.attribution ? summarizeAttribution(metric) : undefined;

    if (attribution) {
      nextMetric.attribution = attribution;
    }

    this.#snapshot.value = (prev: WebVitalsSnapshot): WebVitalsSnapshot => ({
      ...prev,
      [nextMetric.name.toLowerCase()]: nextMetric,
      entries: appendHistory(prev.entries, [nextMetric], this.config.maxHistory),
    });
    this.onMetric.value = nextMetric;
  }
}
