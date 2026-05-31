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

export function combineResults(...results: ValidationResult[]): ValidationResult {
  const issues = results.flatMap((r) => r.issues);
  return { ok: results.every((r) => r.ok), issues };
}
