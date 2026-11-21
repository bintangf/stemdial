export function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

export function createGate({limit, onSlow, window = 20, minimum = 3}) {
  const timings = [];
  let fired = false;
  return {
    get fired() { return fired; },
    push(ms) {
      timings.push(ms);
      if (timings.length > window) timings.shift();
      if (fired || timings.length < minimum) return false;
      const p95 = percentile(timings, 0.95);
      if (p95 <= limit) return false;
      fired = true;
      onSlow(p95);
      return true;
    },
  };
}
