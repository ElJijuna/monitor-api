import SSignal, { computed } from 'ssignal';
import { appendHistory } from '../core/retainHistory';
import type {
  ComponentStats,
  IReactCollector,
  ReactCollectorConfig,
  ReactSnapshot,
  RenderEntry,
  RenderPhase,
} from '../core/types';

// Minimal fiber types — only the fields we access
interface Fiber {
  type: unknown;
  alternate: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  actualDuration?: number;
}

interface FiberRoot {
  current: Fiber;
}

interface DevToolsHook {
  onCommitFiberRoot: (
    rendererID: number,
    root: FiberRoot,
    priorityLevel?: unknown,
    didError?: boolean,
  ) => void;
  isDisabled?: boolean;
  supportsFiber?: boolean;
  inject?: (renderer: unknown) => void;
  checkDCE?: (fn: unknown) => void;
  onCommitFiberUnmount?: (rendererID: number, fiber: Fiber) => void;
  onPostCommitFiberRoot?: (rendererID: number, root: FiberRoot) => void;
  [key: string]: unknown;
}

type ReactWindow = Window & { __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevToolsHook };
interface ReactCommitListener {
  onCommit(rendererID: number, root: FiberRoot): void;
  onUnmount(rendererID: number, fiber: Fiber): void;
}

interface PendingUnmount {
  component: string;
}

const reactCommitListeners = new Set<ReactCommitListener>();

let installedWindow: ReactWindow | null = null;
let installedHook: DevToolsHook | null = null;
let originalCommitHandler: DevToolsHook['onCommitFiberRoot'] | null = null;
let patchedCommitHandler: DevToolsHook['onCommitFiberRoot'] | null = null;
let originalUnmountHandler: DevToolsHook['onCommitFiberUnmount'] | null = null;
let patchedUnmountHandler: DevToolsHook['onCommitFiberUnmount'] | null = null;

function installReactHook(): void {
  const win = window as ReactWindow;

  if (!win.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    win.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      checkDCE: () => {},
      isDisabled: false,
      supportsFiber: true,
      inject: () => {},
      onCommitFiberRoot: () => {},
      onCommitFiberUnmount: () => {},
      onPostCommitFiberRoot: () => {},
    };
  }

  const hook = win.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const original = hook.onCommitFiberRoot;
  const originalUnmount = hook.onCommitFiberUnmount;

  const patched: DevToolsHook['onCommitFiberRoot'] = (
    rendererID,
    root,
    priorityLevel,
    didError,
  ) => {
    original.call(hook, rendererID, root, priorityLevel, didError);

    for (const listener of reactCommitListeners) {
      listener.onCommit(rendererID, root);
    }
  };

  const patchedUnmount: NonNullable<DevToolsHook['onCommitFiberUnmount']> = (rendererID, fiber) => {
    originalUnmount?.call(hook, rendererID, fiber);

    for (const listener of reactCommitListeners) {
      listener.onUnmount(rendererID, fiber);
    }
  };

  installedWindow = win;
  installedHook = hook;
  originalCommitHandler = original;
  patchedCommitHandler = patched;
  originalUnmountHandler = originalUnmount ?? null;
  patchedUnmountHandler = patchedUnmount;
  hook.onCommitFiberRoot = patched;
  hook.onCommitFiberUnmount = patchedUnmount;
}

function restoreReactHook(): void {
  if (
    installedWindow?.__REACT_DEVTOOLS_GLOBAL_HOOK__ === installedHook &&
    installedHook?.onCommitFiberRoot === patchedCommitHandler &&
    originalCommitHandler
  ) {
    installedHook.onCommitFiberRoot = originalCommitHandler;
  }

  if (
    installedWindow?.__REACT_DEVTOOLS_GLOBAL_HOOK__ === installedHook &&
    installedHook?.onCommitFiberUnmount === patchedUnmountHandler
  ) {
    if (originalUnmountHandler) {
      installedHook.onCommitFiberUnmount = originalUnmountHandler;
    } else {
      Reflect.deleteProperty(installedHook, 'onCommitFiberUnmount');
    }
  }

  installedWindow = null;
  installedHook = null;
  originalCommitHandler = null;
  patchedCommitHandler = null;
  originalUnmountHandler = null;
  patchedUnmountHandler = null;
}

function subscribeToReactCommits(listener: ReactCommitListener): () => void {
  reactCommitListeners.add(listener);

  if (reactCommitListeners.size === 1) {
    installReactHook();
  }

  let subscribed = true;

  return () => {
    if (!subscribed) {
      return;
    }

    subscribed = false;
    reactCommitListeners.delete(listener);

    if (reactCommitListeners.size === 0) {
      restoreReactHook();
    }
  };
}

const REACT_MEMO_TYPE = Symbol.for('react.memo');
const REACT_FORWARD_REF_TYPE = Symbol.for('react.forward_ref');
const DEFAULT_MAX_FIBER_VISITS = 10_000;

function normalizeMaxFiberVisits(value: number | undefined): number {
  if (value === Number.POSITIVE_INFINITY) {
    return value;
  }

  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_MAX_FIBER_VISITS;
  }

  return Math.max(0, Math.floor(value));
}

export class ReactCollector implements IReactCollector {
  readonly snapshot: SSignal<ReactSnapshot>;
  readonly onCommit: SSignal<RenderEntry | null>;

  #entries: SSignal<RenderEntry[]>;
  #totalCommits: SSignal<number>;
  #truncatedCommits: SSignal<number>;
  #slowThreshold: number;
  #maxFiberVisits: number;
  #commitCounter = 0;
  #pendingUnmounts = new Map<number, PendingUnmount[]>();
  #teardown: (() => void) | null = null;

  constructor(private readonly config: ReactCollectorConfig) {
    this.#slowThreshold = config.slowThreshold;
    this.#maxFiberVisits = normalizeMaxFiberVisits(config.maxFiberVisits);
    this.#entries = new SSignal<RenderEntry[]>([]);
    this.#totalCommits = new SSignal(0);
    this.#truncatedCommits = new SSignal(0);
    this.onCommit = new SSignal<RenderEntry | null>(null);

    this.snapshot = computed(
      [this.#entries, this.#totalCommits, this.#truncatedCommits],
      ([entries, totalCommits, truncatedCommits]): ReactSnapshot => ({
        totalCommits,
        truncatedCommits,
        entries,
        byComponent: this.#computeByComponent(entries),
        slowComponents: entries.filter(
          (entry) => entry.type !== 'unmount' && entry.duration >= this.#slowThreshold,
        ),
      }),
    );
  }

  start(): void {
    if (typeof window === 'undefined') {
      return;
    }

    if (this.#teardown) {
      return;
    }

    this.#teardown = subscribeToReactCommits({
      onCommit: (rendererID, root) => this.#handleCommit(rendererID, root),
      onUnmount: (rendererID, fiber) => this.#handleUnmount(rendererID, fiber),
    });
  }

  stop(): void {
    this.#teardown?.();
    this.#teardown = null;
    this.#pendingUnmounts.clear();
  }

  destroy(): void {
    this.stop();
  }

  setSlowThreshold(ms: number): void {
    this.#slowThreshold = ms;
    // Force snapshot recompute by touching entries
    this.#entries.value = (prev: RenderEntry[]) => [...prev];
  }

  clearLog(): void {
    this.#entries.value = [];
    this.#totalCommits.value = 0;
    this.#truncatedCommits.value = 0;
    this.#pendingUnmounts.clear();
  }

  #handleCommit(rendererID: number, root: FiberRoot): void {
    const commitId = ++this.#commitCounter;
    const now = Date.now();
    const pendingUnmounts = this.#pendingUnmounts.get(rendererID) ?? [];
    const newEntries: RenderEntry[] = pendingUnmounts.map(({ component }) => ({
      component,
      duration: 0,
      timestamp: now,
      type: 'unmount',
      commitId,
    }));

    this.#pendingUnmounts.delete(rendererID);

    const truncated = this.#walkFiber(root.current, newEntries, now, commitId);

    this.#totalCommits.value = (n: number) => n + 1;

    if (truncated) {
      this.#truncatedCommits.value = (n: number) => n + 1;
    }

    if (newEntries.length === 0) {
      return;
    }

    this.#entries.value = (prev: RenderEntry[]) =>
      appendHistory(prev, newEntries, this.config.maxHistory);

    // Fire onCommit for the last entry of this batch
    const last = newEntries[newEntries.length - 1];

    if (last) {
      this.onCommit.value = last;
    }
  }

  #handleUnmount(rendererID: number, fiber: Fiber): void {
    const component = this.#getComponentName(fiber.type);

    if (!component) {
      return;
    }

    this.#pendingUnmounts.set(
      rendererID,
      appendHistory(
        this.#pendingUnmounts.get(rendererID) ?? [],
        [{ component }],
        Math.max(1, this.config.maxHistory),
      ),
    );
  }

  #computeByComponent(entries: RenderEntry[]): Record<string, ComponentStats> {
    const byComponent = new Map<string, ComponentStats>();

    for (const entry of entries) {
      if (entry.type === 'unmount') {
        continue;
      }

      const existing = byComponent.get(entry.component);

      if (existing) {
        const renders = existing.renders + 1;
        const totalDuration = existing.totalDuration + entry.duration;

        byComponent.set(entry.component, {
          renders,
          totalDuration,
          avgDuration: Math.round((totalDuration / renders) * 10) / 10,
          lastRender: entry.timestamp,
        });
      } else {
        byComponent.set(entry.component, {
          renders: 1,
          totalDuration: entry.duration,
          avgDuration: entry.duration,
          lastRender: entry.timestamp,
        });
      }
    }

    return Object.fromEntries(byComponent);
  }

  #walkFiber(fiber: Fiber | null, entries: RenderEntry[], now: number, commitId: number): boolean {
    if (!fiber) {
      return false;
    }

    const stack = [fiber];

    let visited = 0;

    while (stack.length > 0 && visited < this.#maxFiberVisits) {
      const current = stack.pop();

      if (!current) {
        continue;
      }

      visited += 1;

      const name = this.#getComponentName(current.type);
      const duration = current.actualDuration ?? 0;

      if (name && (duration > 0 || this.config.includeZeroDuration === true)) {
        entries.push({
          component: name,
          duration: Math.round(duration * 10) / 10,
          timestamp: now,
          type: this.#getPhase(current),
          commitId,
        });
      }

      if (current.sibling) {
        stack.push(current.sibling);
      }

      if (current.child) {
        stack.push(current.child);
      }
    }

    return stack.length > 0;
  }

  #getComponentName(type: unknown): string | null {
    if (!type) {
      return null;
    }

    if (typeof type === 'function') {
      return (
        (type as { displayName?: string; name?: string }).displayName ??
        (type as { name?: string }).name ??
        null
      );
    }

    if (typeof type === 'object' && type !== null) {
      const t = type as {
        $$typeof?: symbol;
        type?: unknown;
        render?: unknown;
        displayName?: string;
      };

      if (t.$$typeof === REACT_MEMO_TYPE) {
        return this.#getComponentName(t.type);
      }

      if (t.$$typeof === REACT_FORWARD_REF_TYPE) {
        return t.displayName ?? this.#getComponentName(t.render);
      }
    }

    return null;
  }

  #getPhase(fiber: Fiber): RenderPhase {
    if (fiber.alternate === null) {
      return 'mount';
    }

    return 'update';
  }
}
