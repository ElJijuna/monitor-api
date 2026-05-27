export { createMonitor } from './core/createMonitor'
export { emitMonitorEvent } from './collectors/EventCollector'

export type {
  // Core
  Monitor,
  MonitorSnapshot,
  MonitorConfig,
  // Performance
  PerformanceSnapshot,
  MemoryInfo,
  LongTaskInfo,
  // Network
  NetworkSnapshot,
  NetworkEntry,
  NetworkWindow5s,
  // React
  ReactSnapshot,
  RenderEntry,
  RenderPhase,
  ComponentStats,
  // Events
  EventSnapshot,
  MonitorEvent,
  // Collector interfaces
  IPerformanceCollector,
  INetworkCollector,
  IReactCollector,
  IEventCollector,
} from './core/types'
