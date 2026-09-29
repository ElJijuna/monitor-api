import SSignal, { computed } from 'ssignal';
import type {
  IReporter,
  ProductionReportConfig,
  ProductionReportRequest,
  ReporterSnapshot,
  ReportFailure,
} from './types';
import { fitsInUtf8Bytes } from './utf8';

const MAX_TIMER_DELAY = 2_147_483_647;
const MAX_DEFAULT_TIMEOUT = 30_000;

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

  if (report.timeout !== undefined && report.timeout !== false) {
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

/** A delivery slower than the interval would block every later one, so it bounds the default. */
function resolveTimeout(report: ProductionReportConfig): number | null {
  if (report.timeout === false) {
    return null;
  }

  return report.timeout ?? Math.min(report.interval, MAX_DEFAULT_TIMEOUT);
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

    void (async () => {
      try {
        resolve(await operation);
      } catch (error) {
        reject(error);
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    })();
  });
}

async function postReport(
  request: Omit<ProductionReportRequest, 'signal'>,
  signal: AbortSignal | null = null,
) {
  const response = await fetch(request.endpoint, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    keepalive: request.keepalive,
    signal,
  });

  if (!response.ok) {
    throw new DeliveryError('transport');
  }
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

    const timeout = resolveTimeout(report);

    if (timeout !== null) {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeout);
    }

    const delivery = report.transport
      ? report.transport({ ...request, signal: controller.signal })
      : postReport(request, controller.signal);

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
  let hiddenFlushSent = false;

  const update = (patch: Partial<ReporterSnapshot>) => {
    state.value = { ...state.value, ...patch };
  };

  /** Builds the request, or returns the stage at which the report had to be dropped. */
  function prepare(config: ProductionReportConfig, keepalive: boolean) {
    let stage: ReportFailure = 'transform';

    try {
      const payload = getPayload();

      stage = 'serialization';
      const body = JSON.stringify(payload);

      if (body === undefined) {
        throw new DeliveryError('serialization');
      }

      stage = 'payload-too-large';

      if (!fitsInUtf8Bytes(body, config.maxPayloadBytes ?? 65_536)) {
        throw new DeliveryError(stage);
      }

      return {
        endpoint: config.endpoint,
        payload,
        body,
        headers: { 'Content-Type': 'application/json', ...config.headers },
        keepalive,
      };
    } catch {
      return stage;
    }
  }

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
    const request = prepare(report, false);

    if (typeof request === 'string') {
      if (!controller.signal.aborted) {
        update({ dropped: state.value.dropped + 1, lastFailure: request });
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

    void (async () => {
      try {
        const sent = await deliver(report, request, controller.signal);

        if (active === run) {
          active = null;
        }

        settle(sent);
      } catch {
        if (active === run) {
          active = null;
        }

        settle(false);
      }
    })();

    return run.promise;
  }

  /**
   * The page may be frozen or discarded right after this, so the request is fire-and-forget: one
   * attempt, no timeout, and not cancelled by stop or destroy. It runs even while an interval
   * delivery is pending, because that one carries an older snapshot and may not survive the page.
   */
  function flushHidden(): void {
    if (!started || destroyed || !report || hiddenFlushSent) {
      return;
    }

    hiddenFlushSent = true;
    const request = prepare(report, true);

    // transform may stop or destroy the monitor.
    if (!started || destroyed) {
      return;
    }

    if (typeof request === 'string') {
      update({ dropped: state.value.dropped + 1, lastFailure: request });

      return;
    }

    update({ attempts: state.value.attempts + 1 });

    void (async () => {
      try {
        await (report.transport ? report.transport(request) : postReport(request));

        if (!destroyed) {
          update({ sent: state.value.sent + 1, lastSuccessAt: Date.now(), lastFailure: null });
        }
      } catch (error) {
        if (!destroyed) {
          update({
            failed: state.value.failed + 1,
            lastFailure: error instanceof DeliveryError ? error.category : 'transport',
          });
        }
      }
    })();
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
      flushHidden();
    } else {
      hiddenFlushSent = false;
    }
  }

  function onPageShow(): void {
    hiddenFlushSent = false;
  }

  function listenForHide(listen: boolean): void {
    if (report?.flushOnHide === false) {
      return;
    }

    const method = listen ? 'addEventListener' : 'removeEventListener';

    if (typeof document !== 'undefined' && typeof document[method] === 'function') {
      document[method]('visibilitychange', onVisibilityChange);
    }

    if (typeof window !== 'undefined' && typeof window[method] === 'function') {
      window[method]('pagehide', flushHidden);
      window[method]('pageshow', onPageShow);
    }
  }

  function stop(): void {
    if (destroyed) {
      return;
    }

    if (started) {
      listenForHide(false);
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
      hiddenFlushSent = false;
      listenForHide(true);
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
