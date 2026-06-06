export { emitMonitorEvent } from './collectors/EventCollector';
export { createMonitor } from './core/createMonitor';

export type {
  CollectorName,
  ComponentStats,
  EventCollectorConfig,
  // Events
  EventSnapshot,
  IEventCollector,
  INetworkCollector,
  // Collector interfaces
  IPerformanceCollector,
  IReactCollector,
  IWebVitalsCollector,
  LongTaskInfo,
  MemoryInfo,
  // Core
  Monitor,
  MonitorConfig,
  MonitorEvent,
  MonitorSnapshot,
  NetworkCollectorConfig,
  NetworkEntry,
  // Network
  NetworkSnapshot,
  NetworkWindow5s,
  PerformanceCollectorConfig,
  // Performance
  PerformanceSnapshot,
  ProductionReportConfig,
  ReactCollectorConfig,
  // React
  ReactSnapshot,
  RenderEntry,
  RenderPhase,
  WebVitalMetric,
  // Web Vitals
  WebVitalName,
  WebVitalsCollectorConfig,
  WebVitalsSnapshot,
} from './core/types';
