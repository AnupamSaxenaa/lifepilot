// ─── Jasper Tribute ──────────────────────────────────────
// The dedication artwork that closes the Settings screen.
//
// Rendered through `expo-image` rather than React Native's `Image`: RN's Android
// implementation does not animate GIFs without extra Fresco setup and would show
// a frozen first frame, while expo-image animates out of the box and adds
// memory/disk caching plus a soft fade-in.
//
// Layout intent: edge to edge, and the LAST thing in the scroll view with no
// trailing padding, so scrolling to the very bottom lands on the artwork rather
// than a band of black. Height is a share of the viewport so it fills the tail
// of the screen on both short and tall devices.
//
// Swap assets/jasper.gif to change the artwork — no code change needed.
// ─────────────────────────────────────────────────────────
import { Image } from 'expo-image';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

const JASPER_GIF = require('../../assets/jasper.gif');

// Fraction of screen height the artwork occupies, clamped so it never dominates
// a small phone nor looks like a thin strip on a tablet.
const HEIGHT_RATIO = 0.34;
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 380;

export const JasperTribute = () => {
  const { width, height } = useWindowDimensions();
  const artHeight = Math.round(
    Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height * HEIGHT_RATIO)),
  );

  return (
    <View
      style={[styles.frame, { width, height: artHeight }]}
      // Decorative: the dedication text above carries the meaning, so a screen
      // reader should not announce the image separately.
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      <Image
        source={JASPER_GIF}
        style={styles.image}
        // cover, so the frame is always filled regardless of the GIF's aspect
        // ratio — letterboxing would reintroduce the black bands.
        contentFit="cover"
        autoplay
        transition={220}
        cachePolicy="memory-disk"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  frame: {
    // No margins and no border radius: any inset here shows through as black.
    alignSelf: 'stretch',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
