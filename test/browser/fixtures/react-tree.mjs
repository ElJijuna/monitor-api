import { createElement as h, memo, useState } from 'react';
import { createRoot } from 'react-dom/client';

function busy(ms) {
  const end = performance.now() + ms;

  while (performance.now() < end) {
    // Simulates render cost so durations are measurable.
  }
}

function Heavy() {
  busy(8);

  return h('span', null, 'heavy');
}

const MemoHeavy = memo(Heavy);

function Counter() {
  const [count, setCount] = useState(0);

  busy(2);

  return h(
    'button',
    { type: 'button', id: 'increment', onClick: () => setCount(count + 1) },
    String(count),
  );
}

function App() {
  const [showCounter, setShowCounter] = useState(true);

  return h(
    'div',
    null,
    h(MemoHeavy),
    showCounter ? h(Counter) : null,
    h('button', { type: 'button', id: 'hide', onClick: () => setShowCounter(false) }, 'hide'),
  );
}

createRoot(document.getElementById('root')).render(h(App));
