export function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

export const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;

export function createGate({limit, onSlow, window = 20, minimum = 3, stat = values => percentile(values, 0.95)}) {
  const timings = [];
  let fired = false;
  return {
    get fired() { return fired; },
    push(ms) {
      timings.push(ms);
      if (timings.length > window) timings.shift();
      if (fired || timings.length < minimum) return false;
      const value = stat(timings);
      if (value <= limit) return false;
      fired = true;
      onSlow(value);
      return true;
    },
  };
}
