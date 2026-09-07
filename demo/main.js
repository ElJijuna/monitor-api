import { createMonitor, emitMonitorEvent } from 'monitor-api';

const activity = document.querySelector('#activity');
const fields = {
  cls: document.querySelector('#cls'),
  errors: document.querySelector('#error-count'),
  events: document.querySelector('#event-count'),
  fps: document.querySelector('#fps'),
  network: document.querySelector('#network-count'),
  reporter: document.querySelector('#reporter-sent'),
  statusDot: document.querySelector('#status-dot'),
  statusText: document.querySelector('#status-text'),
};

function log(message) {
  const item = document.createElement('li');

  item.textContent = `${new Date().toLocaleTimeString()} ${message}`;
  activity.prepend(item);

  while (activity.children.length > 8) {
    activity.lastElementChild?.remove();
  }
}

const monitor = createMonitor({
  collectors: ['performance', 'network', 'events', 'errors', 'webVitals'],
  env: 'production',
  maxHistory: 40,
  report: {
    endpoint: '/api/report',
    interval: 60_000,
    timeout: 2_000,
  },
});

monitor.subscribe((snapshot) => {
  fields.fps.textContent = String(snapshot.performance.fps);
  fields.network.textContent = String(snapshot.network.window5s.count);
  fields.events.textContent = String(snapshot.events.entries.length);
  fields.errors.textContent = String(snapshot.errors.totalErrors);
  fields.cls.textContent = snapshot.performance.cls.toFixed(4);
});

monitor.reporter.snapshot.subscribe((snapshot) => {
  fields.reporter.textContent = String(snapshot.sent);
});

monitor.network.onRequest.subscribe((entry) => {
  if (entry) {
    log(`${entry.initiator.toUpperCase()} ${entry.method} ${entry.url} -> ${entry.status}`);
  }
});

monitor.events.onEvent.subscribe((entry) => {
  if (entry) {
    log(`event:${entry.label}`);
  }
});

monitor.errors.onError.subscribe((entry) => {
  if (entry) {
    log(`error:${entry.details.message}`);
  }
});

document.querySelector('#event-button').addEventListener('click', () => {
  emitMonitorEvent('demo:clicked', { screen: 'demo' });
});

document.querySelector('#fetch-button').addEventListener('click', async () => {
  await fetch('/api/fetch');
});

document.querySelector('#xhr-button').addEventListener('click', () => {
  const xhr = new XMLHttpRequest();

  xhr.open('POST', '/api/xhr');
  xhr.send('demo');
});

document.querySelector('#error-button').addEventListener('click', () => {
  monitor.errors.capture(new Error('demo error'));
});

document.querySelector('#flush-button').addEventListener('click', async () => {
  const sent = await monitor.reporter.flush();

  log(sent ? 'report flushed' : 'report skipped');
});

monitor.start();
fields.statusDot.classList.add('ready');
fields.statusText.textContent = 'running';
log('monitor started');

window.monitorDemo = {
  flush: () => monitor.reporter.flush(),
  monitor,
  snapshot: () => monitor.getSnapshot(),
};
