/* global beforeEach, describe, expect, jest, test */

jest.mock('../../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../../utils/widgetUpdater', () => ({ updateAllWidgets: jest.fn() }));
jest.mock('nativewind', () => ({ NativeWindStyleSheet: { create: jest.fn() } }));
jest.mock('../../../utils/storage', () => ({
  Storage: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  },
}));
jest.mock('../../../lib/syncQueue', () => ({
  drainSyncQueue: jest.fn(),
  enqueueMutation: jest.fn(),
  getQueueLength: jest.fn(),
  syncToSupabase: jest.fn(),
}));

const { Storage } = require('../../../utils/storage');
const { drainSyncQueue, enqueueMutation } = require('../../../lib/syncQueue');
const { reorderAlarms } = require('../../../lib/dataManager');

beforeEach(() => {
  jest.clearAllMocks();
  Storage.get.mockResolvedValue(null);
  Storage.set.mockResolvedValue(undefined);
  Storage.remove.mockResolvedValue(undefined);
  enqueueMutation.mockResolvedValue('queued');
  drainSyncQueue.mockResolvedValue({ succeeded: 0, failed: 0, remaining: 0 });
});

describe('dataManager reorderAlarms', () => {
  test('caches the complete alarm list before enqueueing changed rows', async () => {
    const full = [
      { id: 'a', order_index: 0 },
      { id: 'hidden', order_index: 1, flags: { archived: true } },
      { id: 'b', order_index: 2 },
    ];

    await reorderAlarms('user-1', full, [full[0], full[2]]);

    expect(Storage.set).toHaveBeenCalledWith('alarms_user-1', full);
    expect(Storage.set.mock.invocationCallOrder[0])
      .toBeLessThan(enqueueMutation.mock.invocationCallOrder[0]);
    expect(Storage.set.mock.calls[0][1].map((alarm) => alarm.id))
      .toEqual(['a', 'hidden', 'b']);
  });


  test('queues only changed indexes and handles no changes safely', async () => {
    const full = [{ id: 'a', order_index: 0 }, { id: 'b', order_index: 1 }];
    await reorderAlarms('user-1', full, [full[1]]);

    expect(enqueueMutation).toHaveBeenCalledTimes(1);
    expect(enqueueMutation).toHaveBeenCalledWith(
      'alarms',
      'update',
      { order_index: 1 },
      { column: 'id', value: 'b' },
    );

    jest.clearAllMocks();
    Storage.get.mockResolvedValue(null);
    await expect(reorderAlarms('user-1', full, [])).resolves.toBe(full);
    expect(enqueueMutation).not.toHaveBeenCalled();
  });

  test('retains the local order when immediate queue draining fails', async () => {
    const full = [{ id: 'b', order_index: 0 }, { id: 'a', order_index: 1 }];
    drainSyncQueue.mockRejectedValueOnce(new Error('offline'));

    await expect(reorderAlarms('user-1', full, full)).resolves.toBe(full);
    expect(Storage.set).toHaveBeenCalledWith('alarms_user-1', full);
    expect(enqueueMutation).toHaveBeenCalledTimes(2);
    await Promise.resolve();
  });
});