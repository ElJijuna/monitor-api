import SSignal from 'ssignal';
import type { DeviceSnapshot, IDeviceCollector } from '../core/types';

export const emptyDeviceSnapshot = (): DeviceSnapshot => ({ hardwareConcurrency: null });

function readHardwareConcurrency(): number | null {
  const value = typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency;

  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : null;
}

export class DeviceCollector implements IDeviceCollector {
  #destroyed = false;
  readonly snapshot = new SSignal<DeviceSnapshot>(emptyDeviceSnapshot());

  start(): void {
    // Node also exposes `navigator.hardwareConcurrency`; only the browser's value describes the user.
    if (this.#destroyed || typeof window === 'undefined') {
      return;
    }

    const hardwareConcurrency = readHardwareConcurrency();

    if (hardwareConcurrency !== this.snapshot.value.hardwareConcurrency) {
      this.snapshot.value = { hardwareConcurrency };
    }
  }

  stop(): void {}

  destroy(): void {
    this.#destroyed = true;
  }
}
