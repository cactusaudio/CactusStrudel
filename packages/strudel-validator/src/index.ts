export interface ValidationIssue {
  code: string;
  message: string;
  span?: { start: number; end: number };
  hint?: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export const FN_WHITELIST_STUB = new Set<string>([
  's',
  'n',
  'note',
  'freq',
  'gain',
  'pan',
  'room',
  'delay',
  'lpf',
  'hpf',
  'bpf',
  'cutoff',
  'resonance',
  'crush',
  'distort',
  'coarse',
  'shape',
  'vowel',
  'attack',
  'decay',
  'sustain',
  'release',
  'speed',
  'cps',
  'setcps',
  'bpm',
  'setBpm',
  'stack',
  'cat',
  'seq',
  'slow',
  'fast',
  'rev',
  'every',
  'mask',
  'struct',
  'degradeBy',
  'sometimes',
  'chunk',
  'swing',
  'swingBy',
  'iter',
  'palindrome',
  'range',
  'sine',
  'saw',
  'square',
  'tri',
  'noise',
  'pink',
  'brown',
]);

export function validateMiniNotation(_input: string): ValidationResult {
  return { ok: true, issues: [] };
}

export function validateStrudelCode(_code: string): ValidationResult {
  return { ok: true, issues: [] };
}
