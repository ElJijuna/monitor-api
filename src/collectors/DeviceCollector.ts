import SSignal from 'ssignal';
import { shallowEqual } from '../core/shallowEqual';
import type { DeviceSnapshot, IDeviceCollector } from '../core/types';

export const emptyDeviceSnapshot = (): DeviceSnapshot => ({
  hardwareConcurrency: null,
  online: null,
  offlineCount: 0,
});

function readHardwareConcurrency(): number | null {
  const value = typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency;

  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : null;
}

function readOnline(): boolean | null {
  const value = typeof navigator === 'undefined' ? undefined : navigator.onLine;

  return typeof value === 'boolean' ? value : null;
}

export class DeviceCollector implements IDeviceCollector {
  #destroyed = false;
  #listening = false;
  readonly snapshot = new SSignal<DeviceSnapshot>(emptyDeviceSnapshot());

  start(): void {
    // Node also exposes `navigator`; only the browser's values describe the user.
    if (this.#destroyed || typeof window === 'undefined' || this.#listening) {
      return;
    }

    this.#update({ hardwareConcurrency: readHardwareConcurrency(), online: readOnline() });

    if (typeof window.addEventListener === 'function') {
      window.addEventListener('online', this.#onOnline);
      window.addEventListener('offline', this.#onOffline);
      this.#listening = true;
    }
  }

  stop(): void {
    if (!this.#listening) {
      return;
    }

    window.removeEventListener('online', this.#onOnline);
    window.removeEventListener('offline', this.#onOffline);
    this.#listening = false;
  }

  destroy(): void {
    this.stop();
    this.#destroyed = true;
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

  #update(patch: Partial<DeviceSnapshot>): void {
    const next = { ...this.snapshot.value, ...patch };

    if (!shallowEqual(next, this.snapshot.value)) {
      this.snapshot.value = next;
    }
  }
}
