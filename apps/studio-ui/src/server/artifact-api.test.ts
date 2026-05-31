import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isAllowedArtifactRelPath,
  resolveArtifactPath,
  rewriteUrlPath,
} from './artifact-api.js';

const ROOT = '/repo';

describe('artifact api allowlist', () => {
  it('rewrites public session and audit URLs to CLI artifact directories', () => {
    expect(rewriteUrlPath('sessions/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/iter_0000.json'))
      .toBe('apps/cli/sessions/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/iter_0000.json');
    expect(rewriteUrlPath('audits/cookbook-impact-real/20260601/cookbook-impact-real-report.json'))
      .toBe('apps/cli/audits/cookbook-impact-real/20260601/cookbook-impact-real-report.json');
  });

  it('allows only Studio session text artifacts through /api', () => {
    const target = resolveArtifactPath(
      ROOT,
      'sessions/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/iter_0000.strudel.js',
      'api',
    );
    expect(target).toBe(path.join(ROOT, 'apps/cli/sessions/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/iter_0000.strudel.js'));

    expect(resolveArtifactPath(
      ROOT,
      'sessions/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/.env',
      'api',
    )).toBeNull();
    expect(resolveArtifactPath(
      ROOT,
      'sessions/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/iter_0000.wav',
      'api',
    )).toBeNull();
  });

  it('allows binary session artifacts only through /artifact', () => {
    expect(resolveArtifactPath(
      ROOT,
      'sessions/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/iter_0000.wav',
      'artifact',
    )).toBe(path.join(ROOT, 'apps/cli/sessions/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/iter_0000.wav'));
    expect(resolveArtifactPath(
      ROOT,
      'sessions/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/iter_0000.json',
      'artifact',
    )).toBeNull();
  });

  it('keeps research and test fixture directories out of the product API', () => {
    expect(resolveArtifactPath(ROOT, 'references/techno.yaml', 'api')).toBeNull();
    expect(resolveArtifactPath(ROOT, 'tests/fixtures/session.json', 'api')).toBeNull();
    expect(resolveArtifactPath(ROOT, 'cookbook/house.yaml', 'api')).toBeNull();
  });

  it('allows impact audit reports and cookbook ledger entries only on their narrow paths', () => {
    expect(resolveArtifactPath(
      ROOT,
      'audits/cookbook-impact-real/20260601/cookbook-impact-real-report.json',
      'api',
    )).toBe(path.join(ROOT, 'apps/cli/audits/cookbook-impact-real/20260601/cookbook-impact-real-report.json'));
    expect(resolveArtifactPath(
      ROOT,
      'learning_ledger/cookbook/promoted_priors/g9c.md',
      'api',
    )).toBe(path.join(ROOT, 'learning_ledger/cookbook/promoted_priors/g9c.md'));
    expect(resolveArtifactPath(
      ROOT,
      'learning_ledger/cookbook/promoted_priors/README.md',
      'api',
    )).toBeNull();
  });

  it('allows directory listing roots but filters child files by file policy', () => {
    expect(isAllowedArtifactRelPath('apps/cli/sessions', 'api', true)).toBe(true);
    expect(isAllowedArtifactRelPath('apps/cli/sessions/session-a/random.txt', 'api', false)).toBe(false);
    expect(isAllowedArtifactRelPath('apps/cli/sessions/session-a/iter_0000.spectrogram.png', 'artifact', false)).toBe(true);
  });
});
