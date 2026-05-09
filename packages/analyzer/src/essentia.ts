// essentia.js wrapper — single-instance lifecycle.
// essentia.js@0.1.3 ships as CommonJS with named exports including a globally-initialized
// `EssentiaWASM` module ready to feed into `new Essentia(EssentiaWASM)`.

let _essentiaPromise: Promise<{ essentia: any }> | null = null;

export async function getEssentia(): Promise<{ essentia: any }> {
  if (!_essentiaPromise) {
    _essentiaPromise = (async () => {
      const mod: any = await import('essentia.js');
      const { Essentia, EssentiaWASM } = mod;
      const essentia = new Essentia(EssentiaWASM);
      return { essentia };
    })();
  }
  return _essentiaPromise;
}

export function arrayToVector(essentia: any, arr: Float32Array): any {
  return essentia.arrayToVector(arr);
}

export function vectorToArray(vec: any): Float32Array {
  // essentia returns a vector with .size() and .get(i)
  if (vec && typeof vec.size === 'function' && typeof vec.get === 'function') {
    const n = vec.size();
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = vec.get(i);
    return out;
  }
  // Already a TypedArray
  if (vec instanceof Float32Array) return vec;
  if (vec && typeof vec === 'object' && 'length' in vec) {
    return Float32Array.from(vec as ArrayLike<number>);
  }
  return new Float32Array(0);
}
