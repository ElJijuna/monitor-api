// Imported by name: the package's "sideEffects": false would let the bundler drop a bare import.
import { monitor } from './react-monitor.mjs';

window.reactMonitor = monitor;

// React must load after monitor.start() installs the DevTools hook. A dynamic import keeps
// that order even if an import sorter reorders the static imports above.
await import('./react-tree.mjs');
