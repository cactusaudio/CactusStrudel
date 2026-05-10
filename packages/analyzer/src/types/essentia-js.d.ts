// essentia.js@0.1.3 ships as CommonJS without bundled types. We use it via
// dynamic import (`await import('essentia.js')`), so we only need a permissive
// module declaration to satisfy TS — runtime shape checks live in essentia.ts.
declare module 'essentia.js' {
  // The actual exports are `Essentia` (class), `EssentiaWASM` (initialized
  // module instance), `EssentiaExtractor`, `EssentiaModel`, `EssentiaPlot`.
  // We intentionally keep the type as `any` here because essentia's public
  // surface is large and version-volatile; structural runtime checks do the
  // real work in src/essentia.ts.
  const exported: any;
  export = exported;
}
