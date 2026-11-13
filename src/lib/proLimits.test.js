import {
    FREE_LOCKED_APP_LIMIT,
    canLockMoreApps,
    canUseSchedules,
    lockedAppQuota,
} from './proLimits';

// The Pro gate for Mindful Lock. The paywall copy promises "Lock unlimited apps
// (free plan: 3) + time-based schedules", so these tests are what make that claim
// true — a paywall benefit with no gate behind it is a Play policy problem.

describe('lockedAppQuota', () => {
  it('caps a free user at the advertised limit', () => {
    expect(FREE_LOCKED_APP_LIMIT).toBe(3);
    expect(lockedAppQuota({ isPro: false, currentCount: 0 })).toEqual({
      limit: 3, used: 0, remaining: 3, atLimit: false, unlimited: false,
    });
  });

  it('reports the limit reached exactly at the cap', () => {
    const q = lockedAppQuota({ isPro: false, currentCount: 3 });
    expect(q.remaining).toBe(0);
    expect(q.atLimit).toBe(true);
  });

  it('never reports negative headroom when somehow over the cap', () => {
    // e.g. a user who was Pro, locked 8 apps, then let the subscription lapse.
    const q = lockedAppQuota({ isPro: false, currentCount: 8 });
    expect(q.remaining).toBe(0);
    expect(q.atLimit).toBe(true);
  });

  it('is unlimited for Pro', () => {
    const q = lockedAppQuota({ isPro: true, currentCount: 250 });
    expect(q.unlimited).toBe(true);
    expect(q.atLimit).toBe(false);
    expect(q.limit).toBeNull();
  });

  it('treats garbage input as zero rather than throwing', () => {
    expect(lockedAppQuota().used).toBe(0);
    expect(lockedAppQuota({ currentCount: 'abc' }).used).toBe(0);
    expect(lockedAppQuota({ currentCount: -5 }).used).toBe(0);
  });
});

describe('canLockMoreApps', () => {
  it('allows a free user up to the cap and no further', () => {
    expect(canLockMoreApps({ isPro: false, currentCount: 0, adding: 3 })).toBe(true);
    expect(canLockMoreApps({ isPro: false, currentCount: 0, adding: 4 })).toBe(false);
    expect(canLockMoreApps({ isPro: false, currentCount: 2, adding: 1 })).toBe(true);
    expect(canLockMoreApps({ isPro: false, currentCount: 3, adding: 1 })).toBe(false);
  });

  it('counts a batch add against the remaining headroom, not just one at a time', () => {
    // The setup flow adds several apps at once; the check must consider the whole
    // batch or a free user could select 3 more on top of 2 existing.
    expect(canLockMoreApps({ isPro: false, currentCount: 2, adding: 2 })).toBe(false);
  });

  it('always allows Pro', () => {
    expect(canLockMoreApps({ isPro: true, currentCount: 99, adding: 50 })).toBe(true);
  });
});

describe('canUseSchedules', () => {
  it('is Pro-only', () => {
    expect(canUseSchedules(true)).toBe(true);
    expect(canUseSchedules(false)).toBe(false);
    // A missing/unknown entitlement must fail closed, not open.
    expect(canUseSchedules(undefined)).toBe(false);
    expect(canUseSchedules(null)).toBe(false);
  });
});
