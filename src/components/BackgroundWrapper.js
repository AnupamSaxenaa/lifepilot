import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import { useTheme as useAppTheme } from '../context/ThemeContext';
import { mix, withAlpha } from '../utils/color';

// Default LifePilot look (kept in sync with ThemeContext.DEFAULT_THEME).
// Defined locally so the auto-import organizer can't strip a named import and
// leave a dangling reference at runtime.
const DEFAULT_BG = '#000000';
const DEFAULT_ACCENT = '#FFFFFF';

// ─── BackgroundWrapper ───────────────────────────────────────
// The app-wide backdrop behind every screen. It renders the EQUIPPED theme as
// a rich ambient gradient so switching themes visibly transforms the whole
// app's atmosphere (dark elevated cards then sit on top — the premium pattern).
//
// Layers (bottom → top):
//   1. Solid base fill in the theme's background color.
//   2. A soft vertical gradient from the theme's (lighter) surface color at the
//      top fading into the background — gives depth/glow near the header.
//   3. A subtle accent wash at the very top so the equipped accent tints the
//      atmosphere too, tying accent + theme together.
// Default theme (black bg / near-black surface / purple accent) reduces to the
// original near-black look, so nothing regresses when no theme is equipped.
// ─────────────────────────────────────────────────────────────
// Pass `plainBlack` for logged-out entry/auth screens. That path deliberately
// bypasses every equipped-theme and accent layer, guaranteeing a pure black
// first-launch background while signed-in screens retain marketplace styling.
export const BackgroundWrapper = ({ children, plainBlack = false }) => {
  const { theme } = useAppTheme();

  const bg = theme?.bg || '#000000';
  const surface = theme?.surface || '#0A0A0A';
  const accent = theme?.accent || '#FFFFFF';

  // When the default theme is equipped (or on logged-out screens), render a
  // pure flat black backdrop with NO ambient gradient/accent shimmer. The
  // premium ambient glow is reserved for actual marketplace themes.
  const isDefaultLook = bg === DEFAULT_BG && accent === DEFAULT_ACCENT;

  if (plainBlack || isDefaultLook) {
    return <View style={[styles.container, styles.plainBlack]}>{children}</View>;
  }

  // A gentle top glow: blend surface toward the accent a touch for richness.
  const topGlow = mix(surface, accent, 0.14);

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      {/* Ambient surface→bg gradient (top-weighted) */}
      <LinearGradient
        pointerEvents="none"
        colors={[topGlow, bg, bg]}
        locations={[0, 0.45, 1]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Subtle accent wash concentrated at the very top */}
      <LinearGradient
        pointerEvents="none"
        colors={[withAlpha(accent, 0.10), 'transparent']}
        locations={[0, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.35 }}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  plainBlack: {
    backgroundColor: '#000000',
  },
  container: {
    flex: 1,
  },
});
