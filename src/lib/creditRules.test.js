import {
    DEFAULT_AD_CREDITS,
    DEFAULT_AD_DAILY_MAX,
    DEFAULT_CREDIT_FLOOR,
    applyDailyTopUp,
    canAfford,
    describeBalance,
    normalizeAdStatus,
    normalizeBalance,
    projectNextDayTotal,
    splitSpend,
} from './creditRules';

describe('normalizeBalance', () => {
  it('reads a full server payload', () => {
    expect(normalizeBalance({
      daily_free: 12, purchased: 150, bonus: 6, total: 168, floor: 20,
    })).toEqual({ bonus: 6, free: 12, paid: 150, debt: 0, total: 168, floor: 20 });
  });

  it('treats a pre-0027 payload as having no bonus', () => {
    expect(normalizeBalance({ daily_free: 5, purchased: 0, total: 5, floor: 20 }))
      .toEqual({ bonus: 0, free: 5, paid: 0, debt: 0, total: 5, floor: 20 });
  });

  it('defaults the floor when the backend predates the floor field', () => {
    expect(normalizeBalance({ daily_free: 5, purchased: 0, total: 5 }).floor)
      .toBe(DEFAULT_CREDIT_FLOOR);
  });

  it('derives total from all three buckets when absent', () => {
    expect(normalizeBalance({ daily_free: 4, purchased: 6, bonus: 3 }).total).toBe(13);
  });

  it('never returns negative counts', () => {
    expect(normalizeBalance({ daily_free: -5, purchased: -2, bonus: -1, total: -9 }))
      .toEqual({ bonus: 0, free: 0, paid: 0, debt: 0, total: 0, floor: DEFAULT_CREDIT_FLOOR });
  });

  it('survives null and garbage', () => {
    expect(normalizeBalance(null)).toEqual({ bonus: 0, free: 0, paid: 0, debt: 0, total: 0, floor: 20 });
    expect(normalizeBalance({ daily_free: 'abc', purchased: undefined }).total).toBe(0);
  });
});

describe('applyDailyTopUp', () => {
  it('raises an empty balance to the floor', () => {
    expect(applyDailyTopUp({ free: 0, paid: 0, floor: 20 }))
      .toEqual({ bonus: 0, free: 20, paid: 0, debt: 0, total: 20 });
  });

  it('tops a partly spent free bucket back up to the floor', () => {
    expect(applyDailyTopUp({ free: 14, paid: 0, floor: 20 }))
      .toEqual({ bonus: 0, free: 20, paid: 0, debt: 0, total: 20 });
  });

  // 0032: the floor is ADDITIVE. These two previously asserted the opposite and
  // were encoding the bug that made Pro worth less than free — a user holding an
  // allotment got no daily grant at all.
  it('gives the full daily grant on top of purchased credits', () => {
    expect(applyDailyTopUp({ free: 0, paid: 150, floor: 20 }))
      .toEqual({ bonus: 0, free: 20, paid: 150, debt: 0, total: 170 });
  });

  it('does not let a purchased balance suppress the daily grant', () => {
    expect(applyDailyTopUp({ free: 0, paid: 8, floor: 20 }))
      .toEqual({ bonus: 0, free: 20, paid: 8, debt: 0, total: 28 });
  });

  it('a Pro user always ends up ahead of a free user', () => {
    // The regression this guards: at floor 20 a free user nets 20/day. A Pro user
    // holding an allotment must net 20/day PLUS that allotment, never less.
    const freeUser = applyDailyTopUp({ free: 0, paid: 0, floor: 20 });
    const proUser = applyDailyTopUp({ free: 0, paid: 500, floor: 20 });
    expect(freeUser.total).toBe(20);
    expect(proUser.total).toBe(520);
    expect(proUser.total).toBeGreaterThan(freeUser.total);
  });

  it('expires the bonus bucket', () => {
    expect(applyDailyTopUp({ bonus: 6, free: 20, paid: 0, floor: 20 }))
      .toEqual({ bonus: 0, free: 20, paid: 0, debt: 0, total: 20 });
  });

  it('does NOT let ad credits reduce the next free grant', () => {
    // The 0027 regression: if bonus counted toward the floor comparison, a user
    // who earned 6 ad credits would get 14 free tomorrow instead of 20.
    expect(applyDailyTopUp({ bonus: 6, free: 0, paid: 0, floor: 20 }).free).toBe(20);
  });

  it('ad credits cannot be farmed into a permanent balance', () => {
    // Earn 6, spend nothing, roll the day: the 6 are gone, total is just floor.
    expect(applyDailyTopUp({ bonus: 6, free: 20, paid: 0, floor: 20 }).total).toBe(20);
  });

  it('never lowers a total, and tops the free bucket to the floor', () => {
    expect(applyDailyTopUp({ free: 15, paid: 10, floor: 20 }))
      .toEqual({ bonus: 0, free: 20, paid: 10, debt: 0, total: 30 });
  });

  it('never raises the free bucket above the floor', () => {
    // The grant is a floor, not a bonus: it can only ever bring free UP TO cap.
    expect(applyDailyTopUp({ free: 35, paid: 0, floor: 20 }))
      .toEqual({ bonus: 0, free: 35, paid: 0, debt: 0, total: 35 });
  });

  it('is idempotent — a second top-up the same day adds nothing', () => {
    const once = applyDailyTopUp({ free: 3, paid: 0, floor: 20 });
    expect(applyDailyTopUp({ ...once, floor: 20 })).toEqual(once);
  });

  it('cannot be farmed from just below the floor', () => {
    const first = applyDailyTopUp({ free: 19, paid: 0, floor: 20 });
    expect(first.total).toBe(20);
    expect(applyDailyTopUp({ ...first, floor: 20 }).total).toBe(20);
  });

  it('honours a per-account floor override', () => {
    expect(applyDailyTopUp({ free: 50, paid: 0, floor: 10000 }).total).toBe(10000);
  });
});

describe('projectNextDayTotal', () => {
  it('promises the floor to a drained free user', () => {
    expect(projectNextDayTotal({ daily_free: 0, purchased: 0, total: 0, floor: 20 })).toBe(20);
  });

  it('promises the daily grant on top of paid credits', () => {
    expect(projectNextDayTotal({ daily_free: 0, purchased: 500, total: 500, floor: 20 })).toBe(520);
  });

  it('does not count today-only bonus credits toward tomorrow', () => {
    expect(projectNextDayTotal({
      daily_free: 20, purchased: 0, bonus: 6, total: 26, floor: 20,
    })).toBe(20);
  });
});

describe('canAfford', () => {
  it('counts bonus credits toward affordability', () => {
    expect(canAfford({ daily_free: 0, purchased: 0, bonus: 3, total: 3 }, 3)).toBe(true);
  });

  it('rejects a cost above balance', () => {
    expect(canAfford({ daily_free: 2, purchased: 0, total: 2 }, 3)).toBe(false);
  });

  it('always allows free modes', () => {
    expect(canAfford({ daily_free: 0, purchased: 0, total: 0 }, 0)).toBe(true);
  });
});

describe('splitSpend', () => {
  it('spends bonus before free, and free before paid', () => {
    expect(splitSpend({ bonus: 6, free: 20, paid: 100 }, 3))
      .toEqual({ fromBonus: 3, fromFree: 0, fromPaid: 0, bonus: 3, free: 20, paid: 100 });
  });

  it('spills bonus into free', () => {
    expect(splitSpend({ bonus: 1, free: 20, paid: 100 }, 3))
      .toEqual({ fromBonus: 1, fromFree: 2, fromPaid: 0, bonus: 0, free: 18, paid: 100 });
  });

  it('spills across all three buckets', () => {
    expect(splitSpend({ bonus: 1, free: 1, paid: 100 }, 3))
      .toEqual({ fromBonus: 1, fromFree: 1, fromPaid: 1, bonus: 0, free: 0, paid: 99 });
  });

  it('uses paid alone when the perishable buckets are empty', () => {
    expect(splitSpend({ bonus: 0, free: 0, paid: 5 }, 2))
      .toEqual({ fromBonus: 0, fromFree: 0, fromPaid: 2, bonus: 0, free: 0, paid: 3 });
  });

  it('returns null when the balance cannot cover the cost', () => {
    expect(splitSpend({ bonus: 1, free: 1, paid: 1 }, 4)).toBeNull();
  });

  it('refunding the split restores the original buckets exactly', () => {
    const before = { bonus: 1, free: 1, paid: 100 };
    const spend = splitSpend(before, 3);
    expect({
      bonus: spend.bonus + spend.fromBonus,
      free: spend.free + spend.fromFree,
      paid: spend.paid + spend.fromPaid,
    }).toEqual(before);
  });
});

describe('describeBalance', () => {
  it('describes a free-tier user', () => {
    expect(describeBalance({ daily_free: 8, purchased: 0, total: 8, floor: 20 })).toEqual({
      total: 8, bonus: 0, free: 8, paid: 0, debt: 0, floor: 20, effective: 8,
      hasPaid: false, hasBonus: false, hasDebt: false, aboveFloor: false, nextDayTotal: 20,
    });
  });

  it('describes a user who just watched ads', () => {
    const view = describeBalance({ daily_free: 20, purchased: 0, bonus: 6, total: 26, floor: 20 });
    expect(view.total).toBe(26);
    expect(view.hasBonus).toBe(true);
    // Honest: the 6 bonus credits are gone tomorrow.
    expect(view.nextDayTotal).toBe(20);
  });

  it('describes a paying user', () => {
    const view = describeBalance({ daily_free: 0, purchased: 150, total: 150, floor: 20 });
    expect(view.hasPaid).toBe(true);
    // Their free bucket is empty, so tomorrow's grant still applies on top.
    expect(view.aboveFloor).toBe(false);
    expect(view.nextDayTotal).toBe(170);
  });
});

describe('normalizeAdStatus', () => {
  it('reads a full server payload', () => {
    expect(normalizeAdStatus({
      credits_per_ad: 3, daily_max: 6, earned_today: 3, remaining_today: 3, ads_left: 1,
    })).toEqual({
      creditsPerAd: 3, dailyMax: 6, earnedToday: 3,
      remainingToday: 3, adsLeft: 1, nextReward: 3, exhausted: false,
    });
  });

  it('defaults sensibly when the backend predates 0027', () => {
    const status = normalizeAdStatus(null);
    expect(status.creditsPerAd).toBe(DEFAULT_AD_CREDITS);
    expect(status.dailyMax).toBe(DEFAULT_AD_DAILY_MAX);
    expect(status.exhausted).toBe(false);
  });

  it('marks the cap as exhausted', () => {
    const status = normalizeAdStatus({
      credits_per_ad: 3, daily_max: 6, earned_today: 6, remaining_today: 0, ads_left: 0,
    });
    expect(status.exhausted).toBe(true);
    expect(status.nextReward).toBe(0);
  });

  it('clamps a final partial reward to what is left under the cap', () => {
    const status = normalizeAdStatus({
      credits_per_ad: 5, daily_max: 6, earned_today: 5, remaining_today: 1,
    });
    expect(status.nextReward).toBe(1);
    // A 1-credit remainder still costs one full ad view.
    expect(status.adsLeft).toBe(1);
  });

  it('never reports more remaining than the cap allows', () => {
    const status = normalizeAdStatus({
      credits_per_ad: 3, daily_max: 6, earned_today: 6, remaining_today: 999,
    });
    expect(status.remainingToday).toBe(0);
  });

  it('derives ads_left when the server omits it', () => {
    expect(normalizeAdStatus({ credits_per_ad: 3, daily_max: 6, earned_today: 0 }).adsLeft).toBe(2);
  });
});

// ─── Refund clawback / credit debt (0031) ──────────────────────────────────
// These encode the anti-abuse contract. If any of them fail, the
// buy → spend → refund → repeat loop is profitable again.

describe('credit debt', () => {
  it('reads debt from the server payload', () => {
    expect(normalizeBalance({ daily_free: 0, purchased: 780, debt: 0, floor: 20 }).debt)
      .toBe(0);
    expect(normalizeBalance({ daily_free: 0, purchased: 0, debt: 20, floor: 20 }).debt)
      .toBe(20);
  });

  it('treats a pre-0031 payload as having no debt', () => {
    expect(normalizeBalance({ daily_free: 5, purchased: 0, total: 5, floor: 20 }).debt)
      .toBe(0);
  });

  it('never reports negative debt', () => {
    expect(normalizeBalance({ debt: -50 }).debt).toBe(0);
  });

  // The scenario as specified: bought 800, spent 20, then refunded.
  // 780 is recoverable from the paid bucket, the 20 already spent becomes debt,
  // and the effective balance reads -20.
  it('shows a negative effective balance after a refund of spent credits', () => {
    const afterRefund = describeBalance({
      daily_free: 0, purchased: 0, bonus: 0, debt: 20, total: 0, floor: 20,
    });
    expect(afterRefund.total).toBe(0);
    expect(afterRefund.debt).toBe(20);
    expect(afterRefund.effective).toBe(-20);
    expect(afterRefund.hasDebt).toBe(true);
  });

  it('debt is not a hold on credits already banked', () => {
    // Spendable credits stay spendable; debt only bites future grants. This must
    // match consume_ai_tokens, which does not check debt before allowing a spend.
    const balance = { daily_free: 5, purchased: 0, bonus: 0, debt: 100, floor: 20 };
    expect(canAfford(balance, 3)).toBe(true);
    expect(canAfford(balance, 6)).toBe(false);
  });

  describe('the daily top-up settles debt before crediting', () => {
    it('swallows the whole grant when debt exceeds it', () => {
      // floor 20, nothing banked, debt 50 → the 20 goes to debt, user gets 0.
      const next = applyDailyTopUp({ bonus: 0, free: 0, paid: 0, floor: 20, debt: 50 });
      expect(next.free).toBe(0);
      expect(next.total).toBe(0);
      expect(next.debt).toBe(30);
    });

    it('credits only the remainder when the grant exceeds debt', () => {
      const next = applyDailyTopUp({ bonus: 0, free: 0, paid: 0, floor: 20, debt: 8 });
      expect(next.free).toBe(12);
      expect(next.total).toBe(12);
      expect(next.debt).toBe(0);
    });

    it('leaves debt untouched when no top-up is due', () => {
      // Free bucket already at the floor, so there is no grant for debt to eat.
      const next = applyDailyTopUp({ bonus: 0, free: 20, paid: 500, floor: 20, debt: 40 });
      expect(next.free).toBe(20);
      expect(next.paid).toBe(500);
      expect(next.total).toBe(520);
      expect(next.debt).toBe(40);
    });

    it('a purchase does not let a refunder skip their debt', () => {
      // 0031 + 0032 together: buying credits while in debt settles the debt first
      // (grant_ai_tokens_once), and the daily grant is also consumed by it. There
      // is no combination of buying and waiting that outruns the clawback.
      const day = applyDailyTopUp({ bonus: 0, free: 0, paid: 0, floor: 20, debt: 20 });
      expect(day.total).toBe(0);
      expect(day.debt).toBe(0);
    });

    it('never mints credits from debt (the negative-paid trap)', () => {
      // Regression guard for the exact hole a negative `paid` would open:
      // free := floor - paid  →  20 - (-800) = 820. `paid` is clamped to >= 0 and
      // debt is tracked separately, so the grant can never exceed the floor.
      const next = applyDailyTopUp({ bonus: 0, free: 0, paid: -800, floor: 20, debt: 800 });
      expect(next.total).toBeLessThanOrEqual(20);
      expect(next.free).toBe(0);
      expect(next.debt).toBe(780);
    });

    it('a refunder earns nothing for as many days as the debt lasts', () => {
      // Simulates the loop being unprofitable: 500 refunded, floor 20/day.
      let state = { bonus: 0, free: 0, paid: 0, floor: 20, debt: 500 };
      for (let day = 0; day < 25; day += 1) {
        state = { ...applyDailyTopUp(state), floor: 20 };
        expect(state.total).toBe(0);
      }
      // 25 days x 20 = 500, so the debt is exactly cleared and still nothing spendable.
      expect(state.debt).toBe(0);
      // Day 26 is the first day they get anything.
      const day26 = applyDailyTopUp({ ...state, floor: 20 });
      expect(day26.total).toBe(20);
    });
  });

  it('projectNextDayTotal accounts for debt', () => {
    expect(projectNextDayTotal({ daily_free: 0, purchased: 0, debt: 50, floor: 20 })).toBe(0);
    expect(projectNextDayTotal({ daily_free: 0, purchased: 0, debt: 0, floor: 20 })).toBe(20);
  });

  it('describeBalance projects a debt-aware tomorrow', () => {
    const view = describeBalance({
      daily_free: 0, purchased: 0, bonus: 3, debt: 25, total: 3, floor: 20,
    });
    // Tomorrow's 20 is entirely eaten by the 25 debt, and today's bonus expires.
    expect(view.nextDayTotal).toBe(0);
  });
});
