// G9C §6 + §10: activation policy tests.

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_POLICY, lookupActivation,
  shouldUseCookbook, shouldAllowWarnings, shouldAllowMutation,
  type ActivationPolicy,
} from './activation-policy.js';

describe('cookbook activation policy (G9C §6)', () => {
  it('default level is minimal_only when no key matches', () => {
    const p = lookupActivation(DEFAULT_POLICY, 'unknown_genre', 'kick');
    expect(p.level).toBe('minimal_only');
    expect(p.reason).toMatch(/no smoke-real evidence/);
  });

  it('techno/kick is enabled_default after smoke-real evidence', () => {
    const p = lookupActivation(DEFAULT_POLICY, 'techno', 'kick');
    expect(p.level).toBe('enabled_default');
    expect(p.reason).toMatch(/weak-positive/);
  });

  it('dnb/kick is enabled_default post-G9C-fix', () => {
    const p = lookupActivation(DEFAULT_POLICY, 'dnb', 'kick');
    expect(p.level).toBe('enabled_default');
    expect(p.reason).toMatch(/post-G9C/);
  });

  it('idm is minimal_only because of pre-existing hard_fail', () => {
    expect(lookupActivation(DEFAULT_POLICY, 'idm', 'kick').level).toBe('minimal_only');
    expect(lookupActivation(DEFAULT_POLICY, 'idm', 'perc').level).toBe('minimal_only');
  });

  it('dub_techno is minimal_only pending render-failure repair', () => {
    expect(lookupActivation(DEFAULT_POLICY, 'dub_techno', 'kick').level).toBe('minimal_only');
    expect(lookupActivation(DEFAULT_POLICY, 'dub_techno', 'chord_stab').level).toBe('minimal_only');
  });

  it('ambient/pad_atmo is minimal_only pending warning investigation', () => {
    expect(lookupActivation(DEFAULT_POLICY, 'ambient', 'pad_atmo').level).toBe('minimal_only');
  });

  it('shouldUseCookbook is false for minimal_only', () => {
    expect(shouldUseCookbook(DEFAULT_POLICY, 'idm', 'kick')).toBe(false);
  });

  it('shouldUseCookbook is true for enabled_default', () => {
    expect(shouldUseCookbook(DEFAULT_POLICY, 'techno', 'kick')).toBe(true);
  });

  it('shouldAllowWarnings is false for enabled_default', () => {
    expect(shouldAllowWarnings(DEFAULT_POLICY, 'techno', 'kick')).toBe(false);
  });

  it('shouldAllowMutation is false everywhere by default', () => {
    expect(shouldAllowMutation(DEFAULT_POLICY, 'techno', 'kick')).toBe(false);
    expect(shouldAllowMutation(DEFAULT_POLICY, 'dnb', 'kick')).toBe(false);
  });

  it('a custom policy can flip a (genre, role) on or off independently', () => {
    const policy: ActivationPolicy = {
      default_level: 'minimal_only', default_reason: 'test',
      per_genre_role: {
        'idm/kick': { level: 'enabled_with_warnings', reason: 'test override' },
      },
    };
    expect(shouldUseCookbook(policy, 'idm', 'kick')).toBe(true);
    expect(shouldAllowWarnings(policy, 'idm', 'kick')).toBe(true);
    expect(shouldUseCookbook(policy, 'techno', 'kick')).toBe(false); // not in policy
  });
});
