import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeHifGuideProfile } from '../lib/hif-memory-profile.mjs';

test('guide roles keep selected upgrade artwork and unowned base artwork without changing fulfillment', () => {
  const profile = { id: 'guide', status: 'conditional_guide_profile', carryRoles: [
    { gameId: 'selected', nameKo: '선택 스킬', requiredAcquisitionPhaseForEarlyRole: 1 },
    { gameId: 'missing', nameKo: '없는 스킬' },
    { gameId: 'unknown', nameKo: '조건 미확정 스킬' },
  ] };
  const memories = [{ id: 'memory', skillCard: { gameId: 'selected', upgradeCount: 2, thumbnailUrl: '/assets/selected-plus.webp' },
    modelEffects: { carriedSkill: { id: 'selected', upgrade: 2, obtainable: true, phase: { code: 1 } } } }];
  const candidates = [{ id: 'unknown-memory', modelEffects: { carriedSkill: { id: 'unknown', obtainable: null } } }];
  const catalog = { skillCards: [
    { gameId: 'selected', upgradeCount: 0, thumbnailUrl: '/assets/selected-base.webp' },
    { gameId: 'missing', upgradeCount: 1, thumbnailUrl: '/assets/missing-plus.webp' },
    { gameId: 'missing', upgradeCount: 0, imageUrl: '/assets/missing-base.webp' },
    { gameId: 'unknown', upgradeCount: 0, thumbnailUrl: '/assets/unknown-base.webp' },
  ] };
  const before = structuredClone({ profile, memories, candidates });
  const result = summarizeHifGuideProfile(profile, memories, catalog, { prioritized: true, candidates });
  assert.deepEqual(result.roles.map(({ skillImageUrl, status, memoryId }) => ({ skillImageUrl, status, memoryId })), [
    { skillImageUrl: '/assets/selected-plus.webp', status: 'fulfilled', memoryId: 'memory' },
    { skillImageUrl: '/assets/missing-base.webp', status: 'missing', memoryId: null },
    { skillImageUrl: '/assets/unknown-base.webp', status: 'unknown', memoryId: null },
  ]);
  assert.equal(result.fulfilledCount, 1);
  assert.equal(result.missingCount, 1);
  assert.equal(result.unknownCount, 1);
  assert.equal(result.readinessConfirmed, false);
  assert.deepEqual({ profile, memories, candidates }, before);
});
