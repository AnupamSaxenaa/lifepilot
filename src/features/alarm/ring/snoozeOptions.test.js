/* global describe, expect, test */
import { deriveVisibleSnoozePresets } from './snoozeOptions';

describe('deriveVisibleSnoozePresets', () => {
  test('keeps three compact standard choices', () => {
    expect(deriveVisibleSnoozePresets({ defaultMin: 5, presets: [5, 10, 15, 30] }))
      .toEqual([5, 10, 15]);
  });

  test('always includes a configured custom default', () => {
    expect(deriveVisibleSnoozePresets({ defaultMin: 45, presets: [5, 10, 15, 30, 45] }))
      .toEqual([5, 10, 45]);
  });

  test('normalizes malformed presets without losing a valid default', () => {
    expect(deriveVisibleSnoozePresets({ defaultMin: 30, presets: [0, 'bad', 10, 10] }))
      .toEqual([5, 10, 30]);
  });
});