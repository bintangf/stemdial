// In-place radix-2 FFT. The fallback only needs a fixed small transform, so
// this keeps its own twiddles instead of pulling in the 5120-point separator FFT.
export function createFFT(n) {
  const bits = Math.log2(n) | 0;
  const reverse = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    reverse[i] = r;
  }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos(2 * Math.PI * i / n);
    sin[i] = Math.sin(2 * Math.PI * i / n);
  }

  function transform(re, im, inverse) {
    for (let i = 0; i < n; i++) {
      const j = reverse[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1, step = n / len;
      for (let base = 0; base < n; base += len) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * step], wi = inverse ? sin[k * step] : -sin[k * step];
          const a = base + k, b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
    }
  }

  return {
    forward(re, im) { transform(re, im, false); },
    inverse(re, im) { transform(re, im, true); },
  };
}
