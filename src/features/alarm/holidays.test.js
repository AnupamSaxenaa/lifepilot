const mockCache = new Map();

jest.mock('../../utils/storage', () => ({
  Storage: {
    get: jest.fn(async (key) => mockCache.get(key) || null),
    set: jest.fn(async (key, value) => mockCache.set(key, value)),
  },
}));

const { applyHolidaySkips, getPublicHolidays } = require('./holidays');

describe('public holiday recurrence support', () => {
  beforeEach(() => {
    mockCache.clear();
    global.fetch = jest.fn(async (_url) => ({
      ok: true,
      json: async () => [
        { date: '2026-01-26', localName: 'Republic Day' },
        { date: '2026-08-15', localName: 'Independence Day' },
      ],
    }));
  });

  test('fetches dates and reuses the offline cache', async () => {
    expect(await getPublicHolidays('IN', 2026)).toEqual(['2026-01-26', '2026-08-15']);
    expect(await getPublicHolidays('IN', 2026)).toEqual(['2026-01-26', '2026-08-15']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('keeps generated holidays separate from manual skip dates', async () => {
    const rule = await applyHolidaySkips({ mode: 'daily', time: '07:00', skipDates: ['2026-07-20'] }, 'IN');
    expect(rule.skipDates).toEqual(['2026-07-20']);
    expect(rule.skipPublicHolidays).toBe(true);
    expect(rule.holidayCountry).toBe('IN');
    expect(rule.holidayDates).toContain('2026-01-26');
  });

  test('disabling holiday skips clears only generated dates', async () => {
    const rule = await applyHolidaySkips({ skipDates: ['2026-07-20'], holidayDates: ['2026-01-01'] }, null);
    expect(rule).toEqual(expect.objectContaining({ skipDates: ['2026-07-20'], holidayDates: [], skipPublicHolidays: false, holidayCountry: null }));
  });
});