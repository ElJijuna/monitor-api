// Loads the built package through its "import" exports, as an ESM consumer would.
import assert from 'node:assert/strict';
import { createMonitor, emitMonitorEvent } from 'monitor-api';
import { useMonitor, useSignal } from 'monitor-api/react';

assert.equal(typeof createMonitor, 'function');
assert.equal(typeof emitMonitorEvent, 'function');
assert.equal(typeof useMonitor, 'function');
assert.equal(typeof useSignal, 'function');

const monitor = createMonitor();

monitor.start();
assert.equal(typeof monitor.getSnapshot().timestamp, 'number');
monitor.destroy();

console.log('ESM package entry points load');
