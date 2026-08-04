import {
    DEFAULT_VISUAL_CONFIG,
    normalizeAlarm,
} from './alarmModel';

describe('alarm visual and snooze normalization', () => {
  test('uses stable visual defaults for missing or invalid values', () => {
    expect(normalizeAlarm({}).visual_config).toEqual(DEFAULT_VISUAL_CONFIG);
    expect(normalizeAlarm({
      visual_config: { clockStyle: 'unknown', backgroundMode: 'neon', palette: 'invalid' },
    }).visual_config).toEqual(DEFAULT_VISUAL_CONFIG);
  });

  test('migrates accessibilityPalette to canonical palette', () => {
    const visual = normalizeAlarm({
      visual_config: {
        clockStyle: 'glass',
        backgroundMode: 'dynamic',
        accessibilityPalette: 'deuteranopia',
      },
    }).visual_config;

    expect(visual).toEqual({
      clockStyle: 'glass',
      backgroundMode: 'dynamic',
      palette: 'deuteranopia',
    });
    expect(visual).not.toHaveProperty('accessibilityPalette');
  });

  test('canonical palette wins over the legacy field', () => {
    const visual = normalizeAlarm({
      visual_config: { palette: 'tritanopia', accessibilityPalette: 'highContrast' },
    }).visual_config;
    expect(visual.palette).toBe('tritanopia');
  });
});