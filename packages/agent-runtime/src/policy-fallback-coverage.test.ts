// G11A iteration-4 closeout: pin the activation-policy coverage contract
// against the legacy fallback path. Pre-fix, dub_techno at seed=2
// (policy=minimal_only) silently used legacy pickSnippet over the
// dub_techno cookbook bucket, producing non_silent_ratio=0.315 in enabled
// mode while minimal stayed at 0.655. Post-fix, a policy-disabled (genre,
// role) goes straight to defaultPatternForRole; the legacy fallback never
// re-introduces cookbook influence.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseBrief } from './brief-parser.js';
import { buildSessionGraphFromBrief, _resetCookbookCacheForTests, type CookbookTrace } from './index.js';

beforeEach(() => {
  delete process.env.CACTUS_COOKBOOK_MODE;
  _resetCookbookCacheForTests();
});

afterEach(() => {
  delete process.env.CACTUS_COOKBOOK_MODE;
});

describe('activation policy covers legacy fallback (G11A iter-4 closeout)', () => {
  it('dub_techno (policy=minimal_only) under enabled mode does NOT pick from legacy cookbook', async () => {
    process.env.CACTUS_COOKBOOK_MODE = 'enabled';
    const brief = parseBrief('dub techno 122 BPM, 16 bars, restrained chord stab');
    const trace: CookbookTrace[] = [];
    await buildSessionGraphFromBrief(brief, { seed: 2, traceOut: trace });
    const t = trace[0]!;
    const dubTechnoPicks = t.picks.filter((p) => p.cookbook_role !== null);
    // Every pick for dub_techno must EITHER come from typed retrieval honoring policy
    // (in which case selected_id is non-null and fallback_reason is unset) OR
    // fall through with fallback_reason starting with "policy-disabled" or
    // "role-default". A pick with fallback_reason "legacy-pickSnippet*" would
    // mean the legacy fallback bypassed the policy — the iteration-4 bug.
    for (const p of dubTechnoPicks) {
      const fr = p.fallback_reason ?? '';
      expect(fr, `pick for ${p.layer_role}/${p.section_function} fell through to legacy pickSnippet, bypassing the activation policy`)
        .not.toMatch(/^legacy-pickSnippet/);
    }
  });

  it('dub_techno enabled trace logs policy-disabled fallback for at least one pick', async () => {
    process.env.CACTUS_COOKBOOK_MODE = 'enabled';
    const brief = parseBrief('dub techno 122 BPM, 16 bars');
    const trace: CookbookTrace[] = [];
    await buildSessionGraphFromBrief(brief, { seed: 2, traceOut: trace });
    const policyDisabledPicks = trace[0]!.picks.filter((p) =>
      (p.fallback_reason ?? '').startsWith('policy-disabled'),
    );
    // dub_techno has 0 (genre, role) pairs in DEFAULT_POLICY at enabled_default,
    // so EVERY pick should report policy-disabled when enabled mode runs against it.
    expect(policyDisabledPicks.length).toBeGreaterThan(0);
  });

  it('techno enabled (policy permits techno/kick) still produces selected cookbook entries', async () => {
    process.env.CACTUS_COOKBOOK_MODE = 'enabled';
    const brief = parseBrief('peak time techno 132 BPM, 16 bars');
    const trace: CookbookTrace[] = [];
    await buildSessionGraphFromBrief(brief, { seed: 2, traceOut: trace });
    const kickPicksWithSelection = trace[0]!.picks.filter(
      (p) => p.cookbook_role === 'kick' && p.selected_id !== null,
    );
    // Sanity: the policy fix didn't accidentally disable techno too.
    expect(kickPicksWithSelection.length).toBeGreaterThan(0);
  });
});
