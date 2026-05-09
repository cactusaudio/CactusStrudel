// Function/control whitelist generated from installed @strudel/* packages on
// 2026-05-10 via `pnpm extract-registry`. Refresh via that command.

export const STRUDEL_REGISTRY_GENERATED_AT = '2026-05-10';

const REGISTRY_LIST: ReadonlyArray<string> = [
  'accelerate','activeLabel','ad','adsr','almostAlways','almostNever','always','amp','analyze','anchor',
  'apply','applyN','ar','arpWith','as','att','attack','bandf','bandq','bank','bbexpr','bbst','begin',
  'bgain','binshift','bjork','bp','bpa','bpattack','bpd','bpdc','bpdecay','bpdepth','bpdepthfreq',
  'bpdepthfrequency','bpe','bpenv','bpf','bpq','bpr','bprate','bprelease','bps','bpshape','bpskew',
  'bpsustain','bpsync','brak','bus','busgain','byteBeatExpression','byteBeatStartTime','ccn','ccv','ceil',
  'ch','channel','channels','chop','chord','chorus','chunkbackinto','chunkBackInto','chunkinto','chunkInto',
  'clip','coarse','color','colour','comb','compress','compressorAttack','compressorKnee','compressorRatio',
  'compressorRelease','compressspan','compressSpan','control','cpm','cps','crush','ctf','ctlNum','ctranspose',
  'curve','cut','cutoff','dec','decay','degrade','degree','delay','delayfb','delayfeedback','delayspeed',
  'delaysync','delayt','delaytime','deltaSlide','density','det','detune','dfb','dict','dictionary','dist',
  'distort','distorttype','distortvol','disttype','distvol','djf','drive','dry','ds','dt','duck','duckatt',
  'duckattack','duckdepth','duckons','duckonset','duckorbit','dur','duration','echo','eish','end','enhance',
  'euclid','euclidish','euclidLegato','euclidLegatoRot','euclidrot','euclidRot','every','expression',
  'fadeInTime','fadeOutTime','fadeTime','fanchor','fastgap','fastGap','fft','filter','filterWhen','firstOf',
  'fit','floor','fm','fmatt','fmattack','fmdec','fmdecay','fmh','fmi','fmrel','fmrelease','fmsus','fmsustain',
  'focus','focusspan','focusSpan','frameRate','frames','freeze','freq','fromBipolar','fshift','fshiftnote',
  'fshiftphase','ftype','fxr','FXr','FXrel','FXrelease','gain','gat','gate','harmonic','hbrick','hcutoff',
  'hold','hours','hp','hpa','hpattack','hpd','hpdc','hpdecay','hpdepth','hpdepthfreq','hpdepthfrequency','hpe',
  'hpenv','hpf','hpq','hpr','hprate','hprelease','hps','hpshape','hpskew','hpsustain','hpsync','hresonance',
  'hsl','hsla','hurry','i','imag','inhabit','inhabitmod','inside','ir','irbegin','iresponse','irspeed','jux',
  'juxby','juxBy','kcutoff','keyDown','kick','krush','label','lastOf','lbrick','legato','leslie','lock','loop',
  'loopat','loopAt','loopatcps','loopAtCps','loopb','loopBegin','loope','loopEnd','lp','lpa','lpattack','lpd',
  'lpdc','lpdecay','lpdepth','lpdepthfreq','lpdepthfrequency','lpe','lpenv','lpf','lpq','lpr','lprate',
  'lprelease','lps','lpshape','lpskew','lpsustain','lpsync','lrate','lsize','midibend','midichan','midicmd',
  'midimap','midiport','miditouch','minutes','mode','moveXY','mtranspose','n','never','noise','note','nrpnn',
  'nrpv','nudge','o','oct','octave','octaveR','octaves','octer','octersub','octersubsub','off','offset','often',
  'orbit','oschost','oscport','outside','overgain','overshape','pace','pan','panchor','panorient','panspan',
  'pansplay','panwidth','patt','pattack','pcurve','pdec','pdecay','penv','phasdp','phasercenter','phaserdepth',
  'phasersweep','phc','phd','phs','pick','pickF','pickmod','pickmodF','pickmodOut','pickmodReset','pickmodRestart',
  'pickmodSqueeze','pickOut','pickReset','pickRestart','pickSqueeze','pitchJump','pitchJumpTime','ply','plyforeach',
  'plyForEach','plywith','plyWith','polyTouch','postgain','prel','prelease','press','pressBy','progNum','psus',
  'psustain','pw','pwrate','pwsweep','range','range2','rangex','rarely','ratio','rdim','real','rel','release',
  'rescale','resonance','revv','rfade','rib','ribbon','ring','ringdf','ringf','rlp','room','roomdim','roomfade',
  'roomlp','roomsize','rootNotes','round','rsize','s','scram','scramble','seconds','seed','seg','segment','semitone',
  'shape','shapevol','shuffle','size','slide','slow','smear','someCycles','someCyclesBy','sometimes','sometimesBy',
  'songPtr','sound','source','sparsity','speak','speed','spread','squiz','src','stepsPerOctave','stretch','striate',
  'stut','sus','sustain','sustainpedal','swing','swingBy','sysex','sysexdata','sysexid','sz','toBipolar','trans',
  'transient','transpose','transsustain','trem','tremdepth','tremolo','tremolodepth','tremolophase','tremoloshape',
  'tremoloskew','tremphase','tremshape','tremskew','triode','tsdelay','uid','undegrade','unison','unit','v','val',
  'vel','velocity','vib','vibmod','vibrato','vlpf','vmod','voice','voicing','voicings','vowel','warp','warpatt',
  'warpattack','warpdc','warpdec','warpdecay','warpdepth','warpenv','warpmode','warprate','warprel','warprelease',
  'warpshape','warpskew','warpsus','warpsustain','warpsync','waveloss','wavetablePhaseRand','wavetablePosition',
  'wavetableWarp','wavetableWarpMode','when','whenKey','within','wt','wtatt','wtattack','wtdc','wtdec','wtdecay',
  'wtdepth','wtenv','wtphaserand','wtrate','wtrel','wtrelease','wtshape','wtskew','wtsus','wtsustain','wtsync',
  'xsdelay','zcrush','zdelay','zmod','znoise','zoom','zoomarc','zoomArc','zoomIn','zrand','zzfx',
];

// Top-level constructs not registered via register(...) but exported by @strudel/core.
// Source: @strudel/core pattern.mjs / index.mjs.
const CORE_TOP_LEVEL: ReadonlyArray<string> = [
  'stack','cat','seq','sequence','polymeter','polyrhythm','silence','pure','reify','timeCat',
  'timecat','fast','slow','setcps','setBpm','setbpm','mini','m','register','registerControl',
  'evaluate','evalScope','controls','samples','setSampleBaseUrl','initAudioOnFirstClick',
  'initAudio','getAudioContext','panic',
];

export const STRUDEL_FUNCTIONS: ReadonlySet<string> = new Set([
  ...REGISTRY_LIST,
  ...CORE_TOP_LEVEL,
]);

// Single-value scalar effects that should not appear twice in the same chain.
// `.lpf(800).distort(0.4).lpf(800)` is almost always a mental-model error.
export const SINGLE_USE_EFFECTS: ReadonlySet<string> = new Set([
  'lpf','hpf','bpf','cutoff','hcutoff','resonance','room','roomsize','delay','delaytime',
  'speed','gain','pan','crush','distort','shape','vowel','attack','decay','sustain','release',
]);

// Pattern-shaping methods that may legitimately appear multiple times in a chain
// (e.g., .every(2, fast(2)).every(3, rev) is fine).
export const REPEATABLE_METHODS: ReadonlySet<string> = new Set([
  'every','sometimes','sometimesBy','rarely','often','almostAlways','almostNever','jux',
  'fast','slow','rev','iter','palindrome','off','press','pressBy','chunk','chunkInto',
  'when','whenKey','within','inside','outside','firstOf','lastOf','swing','swingBy','seg',
  'apply','applyN','ply','plyWith','plyForEach','someCycles','someCyclesBy','degradeBy','degrade',
]);

export function isStrudelFunction(name: string): boolean {
  return STRUDEL_FUNCTIONS.has(name);
}
