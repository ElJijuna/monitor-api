import SSignal, { type ComputedSignal, computed } from 'ssignal';
import { appendHistory, validateMaxHistory } from '../core/retainHistory';
import type {
  IResourceCollector,
  ResourceCollectorConfig,
  ResourceEntry,
  ResourceSnapshot,
  ResourceTotals,
  ResourceType,
  ResourceTypeStats,
} from '../core/types';

const MAX_URL_LENGTH = 2048;
const DEFAULT_SLOWEST_COUNT = 5;
/** Requests the NetworkCollector already measures, plus beacons such as the monitor's reports. */
const IGNORED_INITIATORS = new Set(['fetch', 'xmlhttprequest', 'beacon']);
const RESOURCE_TYPES: ResourceType[] = [
  'script',
  'stylesheet',
  'image',
  'font',
  'media',
  'iframe',
  'other',
];
const INITIATOR_TYPES: Record<string, ResourceType> = {
  script: 'script',
  img: 'image',
  image: 'image',
  input: 'image',
  video: 'media',
  audio: 'media',
  track: 'media',
  iframe: 'iframe',
  frame: 'iframe',
  embed: 'iframe',
  object: 'iframe',
};
const EXTENSION_TYPES: Record<string, ResourceType> = {
  js: 'script',
  mjs: 'script',
  css: 'stylesheet',
  woff: 'font',
  woff2: 'font',
  ttf: 'font',
  otf: 'font',
  eot: 'font',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  svg: 'image',
  ico: 'image',
  mp4: 'media',
  webm: 'media',
  mp3: 'media',
  ogg: 'media',
  vtt: 'media',
};

/** The Resource Timing fields this collector reads; newer ones are missing in some engines. */
interface ResourceTiming extends PerformanceEntry {
  initiatorType: string;
  responseEnd: number;
  transferSize: number;
  encodedBodySize: number;
  decodedBodySize: number;
  renderBlockingStatus?: 'blocking' | 'non-blocking';
  responseStatus?: number;
}

interface ResourceState {
  entries: ResourceEntry[];
  totals: ResourceTotals;
  byType: Record<ResourceType, ResourceTypeStats>;
  slowest: ResourceEntry[];
}

const emptyStats = (): ResourceTypeStats => ({
  count: 0,
  transferSize: 0,
  decodedBodySize: 0,
  cacheHits: 0,
  totalDuration: 0,
  maxDuration: 0,
});

/** Empty snapshot, also used by the disabled collector facade. */
export const emptyResourceSnapshot = (): ResourceSnapshot => ({
  entries: [],
  totals: {
    ...emptyStats(),
    thirdPartyCount: 0,
    thirdPartyTransferSize: 0,
    renderBlockingCount: 0,
    failedCount: 0,
  },
  byType: Object.fromEntries(RESOURCE_TYPES.map((type) => [type, emptyStats()])) as Record<
    ResourceType,
    ResourceTypeStats
  >,
  slowest: [],
});

function classify(initiatorType: string, url: string): ResourceType {
  const fromInitiator = INITIATOR_TYPES[initiatorType];

  if (fromInitiator) {
    return fromInitiator;
  }

  // `link` and `css` initiators load anything: stylesheets, fonts, preloads, background images.
  const path = url.split(/[?#]/, 1)[0] ?? '';
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();

  return EXTENSION_TYPES[extension] ?? 'other';
}

function isThirdParty(url: string): boolean {
  try {
    return new URL(url, location.href).origin !== location.origin;
  } catch {
    return false;
  }
}

function addStats(stats: ResourceTypeStats, entry: ResourceEntry): ResourceTypeStats {
  return {
    count: stats.count + 1,
    transferSize: stats.transferSize + entry.transferSize,
    decodedBodySize: stats.decodedBodySize + entry.decodedBodySize,
    cacheHits: stats.cacheHits + Number(entry.cache === 'hit'),
    totalDuration: stats.totalDuration + entry.duration,
    maxDuration: Math.max(stats.maxDuration, entry.duration),
  };
}

export class ResourceCollector implements IResourceCollector {
  #destroyed = false;
  readonly snapshot: ComputedSignal<ResourceSnapshot>;
  readonly onResource: SSignal<ResourceEntry | null>;

  #state: SSignal<ResourceState>;
  #filter: (url: string) => boolean;
  #isExcluded: (url: string) => boolean;
  #slowestCount: number;
  #observer: PerformanceObserver | null = null;
  #hasStarted = false;
  /** `performance.now()` of the latest restart; earlier resources were already seen or missed. */
  #acceptFrom = 0;

  constructor(
    private readonly config: ResourceCollectorConfig,
    isExcluded: (url: string) => boolean = () => false,
  ) {
    validateMaxHistory(config.maxHistory);
    this.#filter = config.filter ?? (() => true);
    this.#isExcluded = isExcluded;
    this.#slowestCount = Math.max(0, Math.floor(config.slowestCount ?? DEFAULT_SLOWEST_COUNT));
    this.#state = new SSignal<ResourceState>(emptyResourceSnapshot());
    this.onResource = new SSignal<ResourceEntry | null>(null);
    this.snapshot = computed([this.#state], ([state]): ResourceSnapshot => state);
  }

  start(): void {
    if (this.#destroyed || this.#observer) {
      return;
    }

    if (
      typeof window === 'undefined' ||
      typeof PerformanceObserver === 'undefined' ||
      typeof performance === 'undefined'
    ) {
      return;
    }

    this.#acceptFrom = this.#hasStarted ? performance.now() : 0;
    this.#hasStarted = true;

    try {
      const observer = new PerformanceObserver((list) => {
        if (this.#observer === observer) {
          this.#record(list.getEntries() as ResourceTiming[]);
        }
      });

      this.#observer = observer;
      // Buffered delivery includes the assets the page loaded before start().
      observer.observe({ type: 'resource', buffered: true });
    } catch {
      // Resource Timing is not supported.
      this.#observer = null;
    }
  }

  stop(): void {
    this.#observer?.disconnect();
    this.#observer = null;
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
    this.#state.value = emptyResourceSnapshot();
    this.onResource.value = null;
  }

  #toEntry(timing: ResourceTiming): ResourceEntry | null {
    const url = timing.name;

    if (
      IGNORED_INITIATORS.has(timing.initiatorType) ||
      timing.responseEnd < this.#acceptFrom ||
      this.#isExcluded(url) ||
      !this.#filter(url)
    ) {
      return null;
    }

    const transferSize = timing.transferSize || 0;
    const decodedBodySize = timing.decodedBodySize || 0;
    const status = timing.responseStatus;

    return {
      url: url.slice(0, MAX_URL_LENGTH),
      type: classify(timing.initiatorType, url),
      initiatorType: timing.initiatorType,
      duration: Math.round(timing.duration * 10) / 10,
      transferSize,
      encodedBodySize: timing.encodedBodySize || 0,
      decodedBodySize,
      cache: decodedBodySize === 0 ? 'unknown' : transferSize === 0 ? 'hit' : 'miss',
      renderBlocking:
        timing.renderBlockingStatus === undefined
          ? null
          : timing.renderBlockingStatus === 'blocking',
      status: typeof status === 'number' && status > 0 ? status : null,
      thirdParty: isThirdParty(url),
      timestamp: Math.round(performance.timeOrigin + timing.responseEnd),
    };
  }

  /** Folds one observer batch into a single state update. */
  #record(timings: ResourceTiming[]): void {
    const added: ResourceEntry[] = [];

    for (const timing of timings) {
      const entry = this.#toEntry(timing);

      if (entry) {
        added.push(entry);
      }
    }

    const last = added[added.length - 1];

    if (!last) {
      return;
    }

    this.#state.value = (prev: ResourceState): ResourceState => {
      let { totals, slowest } = prev;

      const byType = { ...prev.byType };

      for (const entry of added) {
        byType[entry.type] = addStats(byType[entry.type], entry);
        totals = {
          ...addStats(totals, entry),
          thirdPartyCount: totals.thirdPartyCount + Number(entry.thirdParty),
          thirdPartyTransferSize:
            totals.thirdPartyTransferSize + (entry.thirdParty ? entry.transferSize : 0),
          renderBlockingCount: totals.renderBlockingCount + Number(entry.renderBlocking === true),
          failedCount: totals.failedCount + Number((entry.status ?? 0) >= 400),
        };
      }

      if (this.#slowestCount > 0) {
        slowest = [...slowest, ...added]
          .sort((a, b) => b.duration - a.duration)
          .slice(0, this.#slowestCount);
      }

      return {
        entries: appendHistory(prev.entries, added, this.config.maxHistory),
        totals,
        byType,
        slowest,
      };
    };

    this.onResource.value = last;
  }
}
