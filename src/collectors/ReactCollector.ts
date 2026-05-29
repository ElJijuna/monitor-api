import SSignal, { computed } from 'ssignal'
import type {
  IReactCollector,
  RenderEntry,
  RenderPhase,
  ReactSnapshot,
  ComponentStats,
  ReactCollectorConfig,
} from '../core/types'

// Minimal fiber types — only the fields we access
interface Fiber {
  tag: number
  type: unknown
  alternate: Fiber | null
  child: Fiber | null
  sibling: Fiber | null
  flags: number
  actualDuration?: number
}

interface FiberRoot {
  current: Fiber
}

interface DevToolsHook {
  onCommitFiberRoot: (rendererID: number, root: FiberRoot, priorityLevel?: unknown) => void
  isDisabled?: boolean
  supportsFiber?: boolean
  inject?: (renderer: unknown) => void
  checkDCE?: (fn: unknown) => void
  onCommitFiberUnmount?: (rendererID: number, fiber: Fiber) => void
  onPostCommitFiberRoot?: (rendererID: number, root: FiberRoot) => void
  [key: string]: unknown
}

const FunctionComponent = 0
const ClassComponent = 1

// React 19 fiber flags
const Deletion = 0b000000000000000001000  // 8

const REACT_MEMO_TYPE = Symbol.for('react.memo')
const REACT_FORWARD_REF_TYPE = Symbol.for('react.forward_ref')

let _commitCounter = 0

export class ReactCollector implements IReactCollector {
  readonly snapshot: SSignal<ReactSnapshot>
  readonly onCommit: SSignal<RenderEntry | null>

  #entries: SSignal<RenderEntry[]>
  #totalCommits: SSignal<number>
  #slowThreshold: number
  #teardown: (() => void) | null = null

  constructor(private readonly config: ReactCollectorConfig) {
    this.#slowThreshold = config.slowThreshold
    this.#entries = new SSignal<RenderEntry[]>([])
    this.#totalCommits = new SSignal(0)
    this.onCommit = new SSignal<RenderEntry | null>(null)

    this.snapshot = computed(
      [this.#entries, this.#totalCommits],
      ([entries, totalCommits]): ReactSnapshot => ({
        totalCommits,
        entries,
        byComponent: this.#computeByComponent(entries),
        slowComponents: entries.filter(e => e.duration >= this.#slowThreshold),
      }),
    )
  }

  start(): void {
    if (typeof window === 'undefined') return
    this.#teardown = this.#installHook()
  }

  stop(): void {
    this.#teardown?.()
    this.#teardown = null
  }

  destroy(): void {
    this.stop()
  }

  setSlowThreshold(ms: number): void {
    this.#slowThreshold = ms
    // Force snapshot recompute by touching entries
    this.#entries.value = (prev: RenderEntry[]) => [...prev]
  }

  clearLog(): void {
    this.#entries.value = []
    this.#totalCommits.value = 0
  }

  #installHook(): () => void {
    const win = window as Window & { __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevToolsHook }

    if (!win.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
      win.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        checkDCE: () => {},
        isDisabled: false,
        supportsFiber: true,
        inject: () => {},
        onCommitFiberRoot: () => {},
        onCommitFiberUnmount: () => {},
        onPostCommitFiberRoot: () => {},
      }
    }

    const hook = win.__REACT_DEVTOOLS_GLOBAL_HOOK__
    const original = hook.onCommitFiberRoot

    hook.onCommitFiberRoot = (rendererID, root, priorityLevel) => {
      original.call(hook, rendererID, root, priorityLevel)
      this.#handleCommit(root)
    }

    return () => {
      if (win.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
        win.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot = original
      }
    }
  }

  #handleCommit(root: FiberRoot): void {
    const commitId = ++_commitCounter
    const now = Date.now()
    const newEntries: RenderEntry[] = []

    this.#walkFiber(root.current, newEntries, now, commitId)

    if (newEntries.length === 0) return

    this.#totalCommits.value = (n: number) => n + 1

    this.#entries.value = (prev: RenderEntry[]) =>
      [...prev, ...newEntries].slice(-this.config.maxHistory)

    // Fire onCommit for the last entry of this batch
    const last = newEntries[newEntries.length - 1]
    if (last) this.onCommit.value = last
  }

  #computeByComponent(entries: RenderEntry[]): Record<string, ComponentStats> {
    const byComponent: Record<string, ComponentStats> = {}

    for (const entry of entries) {
      const existing = byComponent[entry.component]
      if (existing) {
        const renders = existing.renders + 1
        const totalDuration = existing.totalDuration + entry.duration
        byComponent[entry.component] = {
          renders,
          totalDuration,
          avgDuration: Math.round((totalDuration / renders) * 10) / 10,
          lastRender: entry.timestamp,
        }
      } else {
        byComponent[entry.component] = {
          renders: 1,
          totalDuration: entry.duration,
          avgDuration: entry.duration,
          lastRender: entry.timestamp,
        }
      }
    }

    return byComponent
  }

  #walkFiber(fiber: Fiber | null, entries: RenderEntry[], now: number, commitId: number): void {
    if (!fiber) return

    if (fiber.tag === FunctionComponent || fiber.tag === ClassComponent) {
      const name = this.#getComponentName(fiber.type)
      if (name) {
        entries.push({
          component: name,
          duration: Math.round((fiber.actualDuration ?? 0) * 10) / 10,
          timestamp: now,
          type: this.#getPhase(fiber),
          commitId,
        })
      }
    }

    this.#walkFiber(fiber.child, entries, now, commitId)
    this.#walkFiber(fiber.sibling, entries, now, commitId)
  }

  #getComponentName(type: unknown): string | null {
    if (!type) return null
    if (typeof type === 'function') {
      return (type as { displayName?: string; name?: string }).displayName
        ?? (type as { name?: string }).name
        ?? null
    }
    if (typeof type === 'object' && type !== null) {
      const t = type as { $$typeof?: symbol; type?: unknown; render?: unknown; displayName?: string }
      if (t.$$typeof === REACT_MEMO_TYPE) {
        return this.#getComponentName(t.type)
      }
      if (t.$$typeof === REACT_FORWARD_REF_TYPE) {
        return t.displayName ?? this.#getComponentName(t.render)
      }
    }
    return null
  }

  #getPhase(fiber: Fiber): RenderPhase {
    if (fiber.flags & Deletion) return 'unmount'
    if (fiber.alternate === null) return 'mount'
    return 'update'
  }
}
