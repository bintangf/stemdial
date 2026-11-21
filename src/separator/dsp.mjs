export const SAMPLE_RATE = 44100;
export const N = 5120;
export const HOP = 1024;
export const BINS = 2048;
export const OVERLAP = N / HOP;

export const WINDOW = Float64Array.from({length: N}, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));

// The model has a noise floor of its own. Scaling a prediction down to the
// mixture magnitude in bins where it is louder keeps the instrumental from
// gaining energy the source never had, which is what makes quiet passages hiss.
export function mixGain(vRe, vIm, xRe, xIm) {
  const v2 = vRe * vRe + vIm * vIm;
  const x2 = xRe * xRe + xIm * xIm;
  return v2 > x2 && v2 > 0 ? Math.sqrt(x2 / v2) : 1;
}

// 5120 = 5 * 1024, so a mixed-radix FFT keeps every stage radix 2 or 5.
export function createFFT() {
  const n2 = 1024;
  const bitrev = new Uint16Array(n2);
  let bits = 0;
  while (1 << bits < n2) bits++;
  for (let i = 0; i < n2; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    bitrev[i] = r;
  }
  const twRe = new Float64Array(n2 / 2), twIm = new Float64Array(n2 / 2);
  for (let i = 0; i < n2 / 2; i++) {
    twRe[i] = Math.cos(-2 * Math.PI * i / n2);
    twIm[i] = Math.sin(-2 * Math.PI * i / n2);
  }
  // exp(-2*pi*i*k/5120) for k = 1..4, indexed [k-1][n2]
  const w5Re = [], w5Im = [];
  for (let k = 1; k <= 4; k++) {
    const re = new Float64Array(n2), im = new Float64Array(n2);
    for (let t = 0; t < n2; t++) {
      re[t] = Math.cos(-2 * Math.PI * t * k / N);
      im[t] = Math.sin(-2 * Math.PI * t * k / N);
    }
    w5Re.push(re); w5Im.push(im);
  }
  const c1 = Math.cos(2 * Math.PI / 5), s1 = Math.sin(2 * Math.PI / 5);
  const c2 = Math.cos(4 * Math.PI / 5), s2 = Math.sin(4 * Math.PI / 5);

  function fft1024(re, im) {
    for (let i = 0; i < n2; i++) {
      const j = bitrev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n2; len <<= 1) {
      const half = len >> 1, step = n2 / len;
      for (let base = 0; base < n2; base += len) {
        for (let k = 0; k < half; k++) {
          const wr = twRe[k * step], wi = twIm[k * step];
          const a = base + k, b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
  }

  const tmpRe = new Float64Array(N), tmpIm = new Float64Array(N);
  const aRe = new Float64Array(5), aIm = new Float64Array(5);
  const bRe = new Float64Array(5), bIm = new Float64Array(5);

  function forward(re, im) {
    for (let t = 0; t < n2; t++) {
      for (let r = 0; r < 5; r++) { aRe[r] = re[r * n2 + t]; aIm[r] = im[r * n2 + t]; }
      const t1r = aRe[1] + aRe[4], t1i = aIm[1] + aIm[4];
      const t2r = aRe[2] + aRe[3], t2i = aIm[2] + aIm[3];
      const d1r = aRe[1] - aRe[4], d1i = aIm[1] - aIm[4];
      const d2r = aRe[2] - aRe[3], d2i = aIm[2] - aIm[3];
      bRe[0] = aRe[0] + t1r + t2r;
      bIm[0] = aIm[0] + t1i + t2i;
      bRe[1] = aRe[0] + c1 * t1r + c2 * t2r + s1 * d1i + s2 * d2i;
      bIm[1] = aIm[0] + c1 * t1i + c2 * t2i - s1 * d1r - s2 * d2r;
      bRe[2] = aRe[0] + c2 * t1r + c1 * t2r + s2 * d1i - s1 * d2i;
      bIm[2] = aIm[0] + c2 * t1i + c1 * t2i - s2 * d1r + s1 * d2r;
      bRe[3] = aRe[0] + c2 * t1r + c1 * t2r - s2 * d1i + s1 * d2i;
      bIm[3] = aIm[0] + c2 * t1i + c1 * t2i + s2 * d1r - s1 * d2r;
      bRe[4] = aRe[0] + c1 * t1r + c2 * t2r - s1 * d1i - s2 * d2i;
      bIm[4] = aIm[0] + c1 * t1i + c2 * t2i + s1 * d1r + s2 * d2r;
      for (let k = 0; k < 5; k++) {
        const o = k * n2 + t;
        if (k) {
          tmpRe[o] = bRe[k] * w5Re[k - 1][t] - bIm[k] * w5Im[k - 1][t];
          tmpIm[o] = bRe[k] * w5Im[k - 1][t] + bIm[k] * w5Re[k - 1][t];
        } else {
          tmpRe[o] = bRe[0]; tmpIm[o] = bIm[0];
        }
      }
    }
    for (let k = 0; k < 5; k++) fft1024(tmpRe.subarray(k * n2, k * n2 + n2), tmpIm.subarray(k * n2, k * n2 + n2));
    for (let k2 = 0; k2 < n2; k2++) {
      for (let k1 = 0; k1 < 5; k1++) {
        const s = k1 * n2 + k2, d = k1 + 5 * k2;
        re[d] = tmpRe[s]; im[d] = tmpIm[s];
      }
    }
  }

  function inverse(re, im) {
    for (let i = 0; i < N; i++) im[i] = -im[i];
    forward(re, im);
    // Only the positive half (BINS) is populated, so the analytic signal needs 2/N.
    const scale = 2 / N;
    for (let i = 0; i < N; i++) { re[i] *= scale; im[i] = -im[i] * scale; }
  }

  return {forward, inverse};
}

export function stftInto(fft, srcL, srcR, offset, reL, imL, reR, imR, dstOffset) {
  const lr = new Float64Array(N), li = new Float64Array(N), rr = new Float64Array(N), ri = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    lr[i] = (srcL[offset + i] || 0) * WINDOW[i];
    rr[i] = (srcR[offset + i] || 0) * WINDOW[i];
  }
  fft.forward(lr, li);
  fft.forward(rr, ri);
  reL.set(lr.subarray(0, BINS), dstOffset);
  imL.set(li.subarray(0, BINS), dstOffset);
  reR.set(rr.subarray(0, BINS), dstOffset);
  imR.set(ri.subarray(0, BINS), dstOffset);
}

// Adds one inverse-STFT frame into the overlap-add accumulator and its window sum.
export function istftFrame(fft, reL, imL, reR, imR, srcOffset, accL, accR, wsum, dstOffset) {
  const lr = new Float64Array(N), li = new Float64Array(N), rr = new Float64Array(N), ri = new Float64Array(N);
  lr.set(reL.subarray(srcOffset, srcOffset + BINS));
  li.set(imL.subarray(srcOffset, srcOffset + BINS));
  rr.set(reR.subarray(srcOffset, srcOffset + BINS));
  ri.set(imR.subarray(srcOffset, srcOffset + BINS));
  fft.inverse(lr, li);
  fft.inverse(rr, ri);
  for (let i = 0; i < N; i++) {
    const w = WINDOW[i];
    accL[dstOffset + i] += lr[i] * w;
    accR[dstOffset + i] += rr[i] * w;
    wsum[dstOffset + i] += w * w;
  }
}
