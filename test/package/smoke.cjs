// Loads the built package through its "require" exports, as a CommonJS consumer would.
const assert = require('node:assert/strict');
const { createMonitor, emitMonitorEvent } = require('monitor-api');
const { useMonitor, useSignal } = require('monitor-api/react');

assert.equal(typeof createMonitor, 'function');
assert.equal(typeof emitMonitorEvent, 'function');
assert.equal(typeof useMonitor, 'function');
assert.equal(typeof useSignal, 'function');

const monitor = createMonitor();

monitor.start();
assert.equal(typeof monitor.getSnapshot().timestamp, 'number');
monitor.destroy();

console.log('CommonJS package entry points load');
