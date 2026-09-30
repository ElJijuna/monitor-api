import SSignal from 'ssignal';
import { shallowEqual } from '../core/shallowEqual';
import type {
  BrowserInfo,
  ConnectionInfo,
  DeviceSnapshot,
  IDeviceCollector,
  ScreenInfo,
  ViewportInfo,
} from '../core/types';

export const emptyDeviceSnapshot = (): DeviceSnapshot => ({
  hardwareConcurrency: null,
  deviceMemory: null,
  online: null,
  offlineCount: 0,
  browser: { name: null, majorVersion: null, mobile: null, platform: null },
  language: null,
  timeZone: null,
  screen: { width: null, height: null, pixelRatio: null },
  viewport: { width: null, height: null },
  connection: { effectiveType: null, rtt: null, downlink: null, saveData: null },
  colorScheme: null,
  reducedMotion: null,
});

// Chromium-only navigator fields that the DOM lib does not declare.
interface UserAgentData {
  brands?: { brand: string; version: string }[];
  mobile?: boolean;
  platform?: string;
}

interface NetworkInformation extends EventTarget {
  effectiveType?: string;
  rtt?: number;
  downlink?: number;
  saveData?: boolean;
}

interface ExtendedNavigator {
  userAgentData?: UserAgentData;
  connection?: NetworkInformation;
  deviceMemory?: number;
}

const DARK_QUERY = '(prefers-color-scheme: dark)';
const LIGHT_QUERY = '(prefers-color-scheme: light)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
// Sizes are read once a resize settles: per-frame updates would rebuild the monitor snapshot
// and wake every subscriber at 60 Hz while the user drags the window.
const RESIZE_SETTLE_MS = 250;
// Order matters: Chromium-based browsers also send `Chrome/`, and Chrome also sends `Safari/`.
const UA_BROWSERS: [name: string, pattern: RegExp][] = [
  ['Edge', /Edg(?:e|A|iOS)?\/(\d+)/],
  ['Opera', /OPR\/(\d+)/],
  ['Samsung Internet', /SamsungBrowser\/(\d+)/],
  ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/],
  ['Chrome', /(?:Chrome|CriOS)\/(\d+)/],
  ['Safari', /Version\/(\d+).*Safari\//],
];
const UA_PLATFORMS: [name: string, pattern: RegExp][] = [
  ['Android', /Android/],
  ['iOS', /iPhone|iPad|iPod/],
  ['Chrome OS', /CrOS/],
  ['Windows', /Windows/],
  ['macOS', /Macintosh|Mac OS X/],
  ['Linux', /Linux/],
];
// Client Hints add placeholder brands such as "Not;A=Brand" that must be ignored.
const GREASE_BRAND = /not.?a.?brand/i;

function extendedNavigator(): (Navigator & ExtendedNavigator) | undefined {
  return typeof navigator === 'undefined'
    ? undefined
    : (navigator as Navigator & ExtendedNavigator);
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function readHardwareConcurrency(): number | null {
  const value = extendedNavigator()?.hardwareConcurrency;

  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : null;
}

function readOnline(): boolean | null {
  const value = extendedNavigator()?.onLine;

  return typeof value === 'boolean' ? value : null;
}

function browserFromClientHints(data: UserAgentData): BrowserInfo | null {
  const brands = (Array.isArray(data.brands) ? data.brands : []).filter(
    ({ brand }) => typeof brand === 'string' && !GREASE_BRAND.test(brand),
  );
  // Prefer the vendor brand ("Google Chrome", "Microsoft Edge") over the shared engine brand.
  const brand = brands.find(({ brand }) => brand !== 'Chromium') ?? brands[0];

  if (!brand) {
    return null;
  }

  const majorVersion = Number.parseInt(brand.version, 10);

  return {
    name: brand.brand.replace(/^(?:Google|Microsoft) /, ''),
    majorVersion: Number.isNaN(majorVersion) ? null : majorVersion,
    mobile: typeof data.mobile === 'boolean' ? data.mobile : null,
    platform: nonEmptyString(data.platform),
  };
}

export function parseUserAgent(userAgent: string): BrowserInfo {
  let name: string | null = null;
  let majorVersion: number | null = null;

  for (const [candidate, pattern] of UA_BROWSERS) {
    const match = pattern.exec(userAgent);

    if (match) {
      name = candidate;
      majorVersion = Number.parseInt(match[1] as string, 10);
      break;
    }
  }

  return {
    name,
    majorVersion,
    mobile: /Mobi/.test(userAgent),
    platform: UA_PLATFORMS.find(([, pattern]) => pattern.test(userAgent))?.[0] ?? null,
  };
}

function readBrowser(): BrowserInfo {
  const nav = extendedNavigator();
  const fromHints = nav?.userAgentData && browserFromClientHints(nav.userAgentData);

  if (fromHints) {
    return fromHints;
  }

  // Firefox and Safari have no Client Hints. Only the parsed fields are kept, never the string.
  return typeof nav?.userAgent === 'string'
    ? parseUserAgent(nav.userAgent)
    : emptyDeviceSnapshot().browser;
}

function readTimeZone(): string | null {
  try {
    return nonEmptyString(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return null;
  }
}

function readScreen(): ScreenInfo {
  const screen = typeof window.screen === 'object' ? window.screen : undefined;

  return {
    width: positiveNumber(screen?.width),
    height: positiveNumber(screen?.height),
    pixelRatio: positiveNumber(window.devicePixelRatio),
  };
}

function readViewport(): ViewportInfo {
  return {
    width: positiveNumber(window.innerWidth),
    height: positiveNumber(window.innerHeight),
  };
}

function readConnection(connection: NetworkInformation | null | undefined): ConnectionInfo {
  return {
    effectiveType: nonEmptyString(connection?.effectiveType),
    rtt: nonNegativeNumber(connection?.rtt),
    downlink: nonNegativeNumber(connection?.downlink),
    saveData: typeof connection?.saveData === 'boolean' ? connection.saveData : null,
  };
}

function mediaQuery(query: string): MediaQueryList | null {
  if (typeof window.matchMedia !== 'function') {
    return null;
  }

  try {
    return window.matchMedia(query);
  } catch {
    return null;
  }
}

export class DeviceCollector implements IDeviceCollector {
  #destroyed = false;
  #listening = false;
  #resizeTimer: ReturnType<typeof setTimeout> | null = null;
  #connection: NetworkInformation | null = null;
  #queries: MediaQueryList[] = [];
  readonly snapshot = new SSignal<DeviceSnapshot>(emptyDeviceSnapshot());

  start(): void {
    // Node also exposes `navigator`; only the browser's values describe the user.
    if (this.#destroyed || typeof window === 'undefined' || this.#listening) {
      return;
    }

    const nav = extendedNavigator();
    const connection = nav?.connection;

    this.#update({
      hardwareConcurrency: readHardwareConcurrency(),
      deviceMemory: positiveNumber(nav?.deviceMemory),
      online: readOnline(),
      browser: readBrowser(),
      language: nonEmptyString(nav?.language),
      timeZone: readTimeZone(),
      screen: readScreen(),
      viewport: readViewport(),
      connection: readConnection(connection),
      ...this.#readPreferences(),
    });

    if (typeof window.addEventListener !== 'function') {
      return;
    }

    window.addEventListener('online', this.#onOnline);
    window.addEventListener('offline', this.#onOffline);
    window.addEventListener('resize', this.#onResize);

    if (connection && typeof connection.addEventListener === 'function') {
      connection.addEventListener('change', this.#onConnectionChange);
      this.#connection = connection;
    }

    for (const query of [DARK_QUERY, LIGHT_QUERY, REDUCED_MOTION_QUERY]) {
      const list = mediaQuery(query);

      // Safari before 14 has only the deprecated addListener; those users keep the start value.
      if (list && typeof list.addEventListener === 'function') {
        list.addEventListener('change', this.#onPreferenceChange);
        this.#queries.push(list);
      }
    }

    this.#listening = true;
  }

  stop(): void {
    if (!this.#listening) {
      return;
    }

    window.removeEventListener('online', this.#onOnline);
    window.removeEventListener('offline', this.#onOffline);
    window.removeEventListener('resize', this.#onResize);
    this.#connection?.removeEventListener('change', this.#onConnectionChange);
    this.#connection = null;

    for (const list of this.#queries) {
      list.removeEventListener('change', this.#onPreferenceChange);
    }

    this.#queries = [];

    if (this.#resizeTimer !== null) {
      clearTimeout(this.#resizeTimer);
      this.#resizeTimer = null;
    }

    this.#listening = false;
  }

  destroy(): void {
    this.stop();
    this.#destroyed = true;
  }

  #readPreferences(): Pick<DeviceSnapshot, 'colorScheme' | 'reducedMotion'> {
    const reducedMotion = mediaQuery(REDUCED_MOTION_QUERY);

    let colorScheme: DeviceSnapshot['colorScheme'] = null;

    if (mediaQuery(DARK_QUERY)?.matches) {
      colorScheme = 'dark';
    } else if (mediaQuery(LIGHT_QUERY)?.matches) {
      colorScheme = 'light';
    }

    return { colorScheme, reducedMotion: reducedMotion ? reducedMotion.matches : null };
  }

  #onOnline = (): void => {
    this.#update({ online: true });
  };

  #onOffline = (): void => {
    const { online, offlineCount } = this.snapshot.value;

    // Count transitions only, in case a browser repeats the event while already offline.
    this.#update({
      online: false,
      offlineCount: online === false ? offlineCount : offlineCount + 1,
    });
  };

  #onResize = (): void => {
    if (this.#resizeTimer !== null) {
      clearTimeout(this.#resizeTimer);
    }

    this.#resizeTimer = setTimeout(() => {
      this.#resizeTimer = null;
      this.#update({ screen: readScreen(), viewport: readViewport() });
    }, RESIZE_SETTLE_MS);
  };

  #onConnectionChange = (): void => {
    this.#update({ connection: readConnection(this.#connection) });
  };

  #onPreferenceChange = (): void => {
    this.#update(this.#readPreferences());
  };

  #update(patch: Partial<DeviceSnapshot>): void {
    const current = this.snapshot.value;
    const next = { ...current };

    for (const key of Object.keys(patch) as (keyof DeviceSnapshot)[]) {
      // Keep the current nested object when its values are unchanged, so that the top-level
      // comparison below skips notifying and selectors on it keep their reference.
      if (!shallowEqual(patch[key], current[key])) {
        (next as Record<string, unknown>)[key] = patch[key];
      }
    }

    if (!shallowEqual(next, current)) {
      this.snapshot.value = next;
    }
  }
}
