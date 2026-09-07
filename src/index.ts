export { emitMonitorEvent } from './collectors/EventCollector';
export { createMonitor } from './core/createMonitor';

export type {
  CollectorName,
  ComponentStats,
  ErrorCollectorConfig,
  ErrorSnapshot,
  EventCollectorConfig,
  // Events
  EventSnapshot,
  IErrorCollector,
  IEventCollector,
  INetworkCollector,
  // Collector interfaces
  IPerformanceCollector,
  IReactCollector,
  IReporter,
  IWebVitalsCollector,
  LongTaskInfo,
  MemoryInfo,
  // Core
  Monitor,
  MonitorConfig,
  MonitorError,
  MonitorErrorDetails,
  MonitorErrorSource,
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
  ProductionReportRequest,
  ProductionReportRetryPolicy,
  ProductionReportTransport,
  ReactCollectorConfig,
  // React
  ReactSnapshot,
  RenderEntry,
  RenderPhase,
  ReporterSnapshot,
  ReportFailure,
  WebVitalMetric,
  // Web Vitals
  WebVitalName,
  WebVitalsCollectorConfig,
  WebVitalsSnapshot,
} from './core/types';
