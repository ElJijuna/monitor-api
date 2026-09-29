import { createMonitor, emitMonitorEvent } from 'monitor-api';

const activity = document.querySelector('#activity');
const fields = {
  cls: document.querySelector('#cls'),
  errors: document.querySelector('#error-count'),
  events: document.querySelector('#event-count'),
  fps: document.querySelector('#fps'),
  lcp: document.querySelector('#lcp'),
  lcpDetail: document.querySelector('#lcp-detail'),
  loafCount: document.querySelector('#loaf-count'),
  loafDetail: document.querySelector('#loaf-detail'),
  network: document.querySelector('#network-count'),
  pageViewDetail: document.querySelector('#page-view-detail'),
  pageViews: document.querySelector('#page-views'),
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
  collectors: {
    performance: true,
    network: true,
    events: true,
    errors: true,
    resources: true,
    webVitals: { attribution: true, softNavigations: true },
  },
  env: 'production',
  maxHistory: 40,
  report: {
    endpoint: '/api/report',
    interval: 60_000,
    timeout: 2_000,
  },
});

const pathOf = (url) => (url ? new URL(url).pathname + new URL(url).search : 'unknown page');

monitor.subscribe((snapshot) => {
  const { longAnimationFrames } = snapshot.performance;
  const { lcp, entries } = snapshot.webVitals;
  const pageViews = new Set(entries.map((entry) => entry.navigationId)).size;

  fields.fps.textContent = String(snapshot.performance.fps);
  fields.network.textContent = String(snapshot.network.window5s.count);
  fields.events.textContent = String(snapshot.events.entries.length);
  fields.errors.textContent = String(snapshot.errors.totalErrors);
  fields.cls.textContent = snapshot.performance.cls.toFixed(4);
  fields.loafCount.textContent = String(longAnimationFrames.count);
  fields.loafDetail.textContent =
    longAnimationFrames.maxBlockingDuration === null
      ? 'No blocking frames yet'
      : `Worst blocked input for ${Math.round(longAnimationFrames.maxBlockingDuration)} ms`;
  fields.lcp.textContent = lcp ? `${Math.round(lcp.value)} ms` : '–';
  fields.lcpDetail.textContent = lcp
    ? `${pathOf(lcp.navigationURL)} · ${lcp.navigationType}`
    : 'Waiting for the first paint';
  fields.pageViews.textContent = String(Math.max(1, pageViews));
  fields.pageViewDetail.textContent =
    pageViews > 1 ? `${pageViews - 1} soft navigation${pageViews > 2 ? 's' : ''}` : 'Initial load';
});

let loggedFrames = 0;

monitor.performance.longAnimationFrames.subscribe(({ count, entries }) => {
  const latest = entries[entries.length - 1];

  if (count > loggedFrames && latest) {
    const culprit = latest.scripts[0];
    const cause = culprit ? ` by ${culprit.invoker ?? culprit.invokerType}` : '';

    log(
      `long frame ${Math.round(latest.duration)} ms, blocked ${Math.round(latest.blockingDuration)} ms${cause}`,
    );
  }

  loggedFrames = count;
});

monitor.webVitals.onMetric.subscribe((metric) => {
  if (metric && metric.name !== 'CLS') {
    log(
      `${metric.name} ${Math.round(metric.value)} ms on ${pathOf(metric.navigationURL)} (${metric.navigationType})`,
    );
  }
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

document.querySelector('#block-button').addEventListener('click', function blockMainThread() {
  const end = performance.now() + 200;

  // Busy-wait so this frame becomes a long animation frame attributed to the click handler.
  while (performance.now() < end) {
    // Blocking on purpose.
  }
});

const views = {
  home: [
    'Home',
    'Soft navigate changes the URL and paints a new view without a page load. Chromium 151+ reports Web Vitals for each of these page views.',
  ],
  orders: ['Orders', 'Twelve open orders, three waiting for payment.'],
  customers: ['Customers', 'Four new customers signed up this week.'],
  settings: ['Settings', 'Notifications are on for failed payments.'],
};
const routes = ['orders', 'customers', 'settings'];

/** Renders the view named in the URL, so reloads and the back button show the right one. */
function renderView() {
  const [title, body] = views[new URLSearchParams(location.search).get('view')] ?? views.home;

  document.querySelector('#view-title').textContent = title;
  document.querySelector('#view-body').textContent = body;
}

document.querySelector('#soft-nav-button').addEventListener('click', () => {
  const current = routes.indexOf(new URLSearchParams(location.search).get('view'));
  const next = routes[(current + 1) % routes.length];

  // An SPA route change: a user interaction that updates the URL and paints new content.
  history.pushState({}, '', `/?view=${next}`);
  renderView();
  log(`navigated to /?view=${next}`);
});

window.addEventListener('popstate', renderView);
renderView();

monitor.start();
fields.statusDot.classList.add('ready');
fields.statusText.textContent = 'running';
log('monitor started');

window.monitorDemo = {
  flush: () => monitor.reporter.flush(),
  monitor,
  snapshot: () => monitor.getSnapshot(),
};
