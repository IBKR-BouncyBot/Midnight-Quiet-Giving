// Only sanitized proof metadata crosses from the worker into this page.
const events = [];
let beats = 0, lastBeat = performance.now(), largestGap = 0, measuring = false;
const timer = setInterval(() => {
  const now = performance.now();
  if (measuring) { beats++; largestGap = Math.max(largestGap, now - lastBeat); }
  lastBeat = now;
}, 20);
const worker = new Worker('./proof-worker.mjs', { type: 'module' });
window.workerProofTest = { events, result: null };
function finish(result) {
  window.workerProofTest.result = { ...result, mainThreadHeartbeats: beats, largestHeartbeatGapMs: Math.round(largestGap) };
  clearInterval(timer); worker.terminate();
  document.getElementById('status').textContent = result.type === 'complete' ? 'Both donation circuit proofs completed.' : 'Worker test failed; private details withheld.';
}
worker.onmessage = ({ data }) => {
  if (!data || typeof data !== 'object') { finish({ type: 'failed', category: 'invalid-worker-message' }); return; }
  if (data.type === 'ready') {
    measuring = true; lastBeat = performance.now();
    worker.postMessage({ op: 'prove-synthetic' });
  } else if (data.type === 'progress') {
    events.push({ type: data.type, circuit: data.circuit, heartbeat: beats, receivedAtMs: Math.round(performance.now()) });
    document.getElementById('status').textContent = `Proving ${data.circuit} in the worker…`;
  } else if (data.type === 'proof-completed') {
    events.push({ type: data.type, circuit: data.circuit, heartbeat: beats, receivedAtMs: Math.round(performance.now()) });
  } else if (data.type === 'complete' || data.type === 'failed') finish(data);
  else finish({ type: 'failed', category: 'unexpected-worker-message' });
};
worker.onerror = () => finish({ type: 'failed', category: 'worker-runtime-failed' });
