import { mergeVisibleAlarmOrder } from './alarmOrder';

const ids = (rows) => rows.map((row) => row.id);

describe('mergeVisibleAlarmOrder', () => {
  test('reorders visible alarms while preserving filtered and archived slots', () => {
    const full = [
      { id: 'visible-a', order_index: 0, title: 'A' },
      { id: 'hidden-search', order_index: 1, title: 'Hidden' },
      { id: 'visible-b', order_index: 2, title: 'B' },
      { id: 'archived', order_index: 3, flags: { archived: true } },
    ];

    const { merged, changed } = mergeVisibleAlarmOrder(full, [full[2], full[0]]);

    expect(ids(merged)).toEqual(['visible-b', 'hidden-search', 'visible-a', 'archived']);
    expect(merged.map((row) => row.order_index)).toEqual([0, 1, 2, 3]);
    expect(ids(changed)).toEqual(['visible-b', 'visible-a']);
    expect(merged[1]).toEqual(full[1]);
    expect(merged[3]).toEqual(full[3]);
  });

  test('normalizes missing and duplicate indexes deterministically', () => {
    const full = [
      { id: 'a', order_index: 1 },
      { id: 'b', order_index: 1 },
      { id: 'c' },
    ];
    const { merged } = mergeVisibleAlarmOrder(full, full);
    expect(ids(merged)).toEqual(['a', 'b', 'c']);
    expect(merged.map((row) => row.order_index)).toEqual([0, 1, 2]);
  });

  test('ignores unknown and duplicate drag rows without dropping alarms', () => {
    const full = [{ id: 'a', order_index: 0 }, { id: 'b', order_index: 1 }];
    const { merged } = mergeVisibleAlarmOrder(full, [full[1], full[1], { id: 'unknown' }]);
    expect(ids(merged)).toEqual(['a', 'b']);
  });
});