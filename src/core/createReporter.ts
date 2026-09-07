import SSignal, { computed } from 'ssignal';
import type {
  IReporter,
  ProductionReportConfig,
  ProductionReportRequest,
  ReporterSnapshot,
  ReportFailure,
} from './types';

const MAX_TIMER_DELAY = 2_147_483_647;

function validateDelay(value: number, name: string, minimum = 0): void {
  if (!Number.isFinite(value) || value < minimum || value > MAX_TIMER_DELAY) {
    throw new RangeError(`${name} must be between ${minimum} and ${MAX_TIMER_DELAY} milliseconds`);
  }
}

export function validateReportConfig(report: ProductionReportConfig | undefined): void {
  if (!report) {
    return;
  }

  validateDelay(report.interval, 'report.interval', 1);
  if (report.timeout !== undefined) {
    validateDelay(report.timeout, 'report.timeout');
  }

  if (
    report.maxPayloadBytes !== undefined &&
    (!Number.isSafeInteger(report.maxPayloadBytes) || report.maxPayloadBytes < 1)
  ) {
    throw new RangeError('report.maxPayloadBytes must be a positive safe integer');
  }

  if (
    report.retry &&
    (!Number.isSafeInteger(report.retry.maxAttempts) || report.retry.maxAttempts < 1)
  ) {
    throw new RangeError('report.retry.maxAttempts must be a positive safe integer');
  }

  if (typeof report.retry?.delay === 'number') {
    validateDelay(report.retry.delay, 'report.retry.delay');
  }
}

class DeliveryError extends Error {
  constructor(readonly category: ReportFailure) {
    super(category);
  }
}

/** Races even transports that ignore AbortSignal, and always removes the abort listener. */
function cancellable<T>(operation: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(new Error('Report cancelled'));
    };

    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    Promise.resolve(operation)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
}

async function waitForRetry(delay: number, signal: AbortSignal): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await cancellable(
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, delay);
      }),
      signal,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function attemptDelivery(
  report: ProductionReportConfig,
  request: Omit<ProductionReportRequest, 'signal'>,
  signal: AbortSignal,
): Promise<void> {
  const controller = new AbortController();
  const cancel = () => controller.abort();

  signal.addEventListener('abort', cancel, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  try {
    if (signal.aborted) {
      throw new Error('Report cancelled');
    }

    if (report.timeout !== undefined) {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, report.timeout);
    }

    const delivery = report.transport
      ? report.transport({ ...request, signal: controller.signal })
      : fetch(request.endpoint, {
          method: 'POST',
          headers: request.headers,
          body: request.body,
          signal: controller.signal,
        }).then((response) => {
          if (!response.ok) {
            throw new DeliveryError('transport');
          }
        });

    await cancellable(Promise.resolve(delivery), controller.signal);
  } catch (error) {
    if (timedOut) {
      throw new DeliveryError('timeout');
    }

    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}

/** Owns delivery lifecycle independently of collector construction. */
export function createReporter(
  report: ProductionReportConfig | undefined,
  enabled: boolean,
  getPayload: () => unknown,
): IReporter & { start(): void; stop(): void; destroy(): void } {
  const state = new SSignal<ReporterSnapshot>({
    status: enabled && report ? 'stopped' : 'disabled',
    attempts: 0,
    sent: 0,
    failed: 0,
    dropped: 0,
    retries: 0,
    cancelled: 0,
    skipped: 0,
    lastSuccessAt: null,
    lastFailure: null,
  });
  const snapshot = computed(state, (value) => value);

  let interval: ReturnType<typeof setInterval> | undefined;
  let started = false;
  let destroyed = false;
  let active: { controller: AbortController; promise: Promise<boolean> } | null = null;
  const update = (patch: Partial<ReporterSnapshot>) => {
    state.value = { ...state.value, ...patch };
  };

  async function deliver(
    config: ProductionReportConfig,
    request: Omit<ProductionReportRequest, 'signal'>,
    signal: AbortSignal,
  ): Promise<boolean> {
    try {
      for (let attempt = 1; attempt <= (config.retry?.maxAttempts ?? 1); attempt += 1) {
        if (signal.aborted) {
          return false;
        }

        update({ status: 'sending', attempts: state.value.attempts + 1 });
        // Subscribers may stop the monitor while observing a status change.
        if (signal.aborted) {
          return false;
        }

        try {
          await attemptDelivery(config, request, signal);
          if (signal.aborted) {
            return false;
          }

          update({
            status: 'idle',
            sent: state.value.sent + 1,
            lastSuccessAt: Date.now(),
            lastFailure: null,
          });

          return true;
        } catch (error) {
          if (signal.aborted) {
            return false;
          }

          if (
            attempt >= (config.retry?.maxAttempts ?? 1) ||
            config.retry?.shouldRetry?.(error, attempt) === false
          ) {
            throw error;
          }

          const configured = config.retry?.delay ?? 0;
          const delay = typeof configured === 'function' ? configured(attempt, error) : configured;

          validateDelay(delay, 'report.retry.delay result');
          update({ status: 'retrying', retries: state.value.retries + 1 });
          await waitForRetry(delay, signal);
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        update({
          status: 'idle',
          failed: state.value.failed + 1,
          lastFailure: error instanceof DeliveryError ? error.category : 'transport',
        });
      }
    }

    return false;
  }

  function flush(): Promise<boolean> {
    if (!started || destroyed || !report) {
      return Promise.resolve(false);
    }

    if (active) {
      return active.promise;
    }

    // Install the run before user code executes, so stop/destroy and reentrant flush are safe.
    const controller = new AbortController();

    let settle!: (sent: boolean) => void;
    const run = {
      controller,
      promise: new Promise<boolean>((resolve) => {
        settle = resolve;
      }),
    };

    active = run;
    let payload: unknown;
    let body: string;
    let stage: ReportFailure = 'transform';

    try {
      payload = getPayload();
      stage = 'serialization';
      const serialized = JSON.stringify(payload);

      if (serialized === undefined) {
        throw new DeliveryError('serialization');
      }

      body = serialized;
      stage = 'payload-too-large';
      if (new TextEncoder().encode(body).byteLength > (report.maxPayloadBytes ?? 65_536)) {
        throw new DeliveryError(stage);
      }
    } catch {
      if (!controller.signal.aborted) {
        update({ dropped: state.value.dropped + 1, lastFailure: stage });
      }

      if (active === run) {
        active = null;
      }

      settle(false);

      return run.promise;
    }

    if (controller.signal.aborted) {
      settle(false);

      return run.promise;
    }

    void deliver(
      report,
      {
        endpoint: report.endpoint,
        payload,
        body,
        headers: { 'Content-Type': 'application/json', ...report.headers },
      },
      controller.signal,
    ).then(
      (sent) => {
        if (active === run) {
          active = null;
        }

        settle(sent);
      },
      () => {
        if (active === run) {
          active = null;
        }

        settle(false);
      },
    );

    return run.promise;
  }

  function stop(): void {
    if (destroyed) {
      return;
    }

    started = false;
    clearInterval(interval);
    interval = undefined;
    const pending = active;

    active = null;
    pending?.controller.abort();
    if (enabled && report) {
      update({ status: 'stopped', cancelled: state.value.cancelled + Number(pending !== null) });
    }
  }

  return {
    snapshot,
    flush,
    start() {
      if (
        started ||
        destroyed ||
        !enabled ||
        !report ||
        (typeof fetch === 'undefined' && !report.transport)
      ) {
        return;
      }

      started = true;
      interval = setInterval(() => {
        if (active) {
          update({ skipped: state.value.skipped + 1 });
        } else {
          void flush();
        }
      }, report.interval);
      update({ status: 'idle' });
    },
    stop,
    destroy() {
      if (destroyed) {
        return;
      }

      stop();
      destroyed = true;
      update({ status: 'destroyed' });
      snapshot.dispose();
    },
  };
}
