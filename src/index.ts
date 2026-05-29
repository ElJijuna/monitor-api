export { createMonitor } from './core/createMonitor'
export { emitMonitorEvent } from './collectors/EventCollector'

export type {
  // Core
  Monitor,
  MonitorSnapshot,
  MonitorConfig,
  ProductionReportConfig,
  CollectorName,
  // Performance
  PerformanceSnapshot,
  MemoryInfo,
  LongTaskInfo,
  PerformanceCollectorConfig,
  // Network
  NetworkSnapshot,
  NetworkEntry,
  NetworkWindow5s,
  NetworkCollectorConfig,
  // React
  ReactSnapshot,
  RenderEntry,
  RenderPhase,
  ComponentStats,
  ReactCollectorConfig,
  // Events
  EventSnapshot,
  MonitorEvent,
  EventCollectorConfig,
  // Web Vitals
  WebVitalName,
  WebVitalMetric,
  WebVitalsSnapshot,
  WebVitalsCollectorConfig,
  // Collector interfaces
  IPerformanceCollector,
  INetworkCollector,
  IReactCollector,
  IEventCollector,
  IWebVitalsCollector,
} from './core/types'
