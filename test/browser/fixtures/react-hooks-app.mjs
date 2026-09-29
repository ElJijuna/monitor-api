import { createElement as h, StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { createMonitor } from '../../../src/index';
import { shallowEqual, useEvents } from '../../../src/react';

const monitor = createMonitor({ collectors: ['events'] });
const commits = { full: 0, count: 0, object: 0 };

monitor.start();

function useCommitCounter(name) {
  useEffect(() => {
    commits[name] += 1;
  });
}

function Full() {
  const snapshot = useEvents(monitor);

  useCommitCounter('full');

  return h('span', { id: 'full' }, String(snapshot.entries.length));
}

function SaveCount() {
  const saves = useEvents(monitor, (snapshot) => snapshot.byLabel.save ?? 0);

  useCommitCounter('count');

  return h('span', { id: 'saves' }, String(saves));
}

function SaveSummary() {
  const summary = useEvents(
    monitor,
    (snapshot) => ({ saves: snapshot.byLabel.save ?? 0, any: snapshot.entries.length > 0 }),
    shallowEqual,
  );

  useCommitCounter('object');

  return h('span', { id: 'summary' }, `${summary.saves}/${summary.any}`);
}

window.hooksTest = {
  commits,
  emit: (label) => monitor.events.emit(label),
};

createRoot(document.getElementById('root')).render(
  h(StrictMode, null, h(Full), h(SaveCount), h(SaveSummary)),
);
