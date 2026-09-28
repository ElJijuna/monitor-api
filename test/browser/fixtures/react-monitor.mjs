// Evaluated before react-dom so the monitor owns the DevTools hook when React registers with it.
import { createMonitor } from '../../../src/index';

export const monitor = createMonitor({ collectors: ['react'], maxHistory: 500 });

monitor.start();
