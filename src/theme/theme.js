export const COLORS = {
  light: {
    background: '#f8fafc',
    surface: '#ffffff',
    text: '#0f172a',
    textMuted: '#64748b',
    border: '#e2e8f0',
    glassBackground: 'rgba(255, 255, 255, 0.7)',
    glassBorder: 'rgba(255, 255, 255, 0.5)',
    primary: '#000000',
    accent: '#111111',
    // Foreground for anything drawn ON `accent`/`primary`/`success`/`danger`.
    // These exist so a filled button never has to hardcode '#FFF' — the accent
    // is user-configurable (and white by default in dark mode), so a hardcoded
    // light label is invisible. ThemeContext.applyPalette recomputes these
    // whenever a marketplace theme is equipped.
    onAccent: '#FFFFFF',
    danger: '#FB7185',
    success: '#34D399',
    onDanger: '#0B0B0D',
    onSuccess: '#0B0B0D',
    warning: '#FBBF24',
    info: '#60A5FA',
    streak: '#FB923C',
  },
  dark: {
    background: '#000000',
    surface: '#131316',
    text: '#F2F2F2',
    textMuted: '#8E8E93',
    border: '#26262A',
    glassBackground: 'rgba(24, 24, 27, 0.65)',
    glassBorder: 'rgba(255, 255, 255, 0.1)',
    primary: '#ffffff',
    accent: '#FFFFFF',
    // The default accent is pure white, so the label on top of it must be dark.
    onAccent: '#0B0B0D',
    danger: '#FB7185',
    success: '#34D399',
    onDanger: '#0B0B0D',
    onSuccess: '#0B0B0D',
    warning: '#FBBF24',
    info: '#60A5FA',
    streak: '#FB923C',
  }
};
