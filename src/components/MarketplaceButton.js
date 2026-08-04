// ─── Animated Marketplace Button ──────────────────────
// A highlighted entry row with a looping purple glow so it stands out.
// Self-contained so the app-wide import formatter can't strip its deps.

import { ChevronRight, Store } from 'lucide-react-native';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { withAlpha } from '../utils/color';

export const MarketplaceButton = ({ onPress }) => {
  const { t } = useTranslation();
  const glow = useRef(new Animated.Value(0)).current;
  const ACCENT = useTheme().theme.accent;
  const styles = useMemo(() => makeStyles(ACCENT), [ACCENT]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(glow, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [glow]);

  // Flat border-color pulse only — no elevation/shadow. Android's `elevation`
  // always renders its own dark shadow underneath regardless of shadowColor,
  // which muddied the purple glow into an inconsistent-looking blob. A clean
  // animated border reads as a proper highlight on every device.
  const borderColor = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [withAlpha(ACCENT, 0.3), withAlpha(ACCENT, 0.9)],
  });

  return (
    <Animated.View style={[styles.wrap, { borderColor }]}>
      <TouchableOpacity style={styles.inner} activeOpacity={0.85} onPress={onPress}>
        <View style={styles.iconWrap}>
          <Store color={ACCENT} size={20} />
        </View>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={styles.title}>{t('marketplaceButton.title')}</Text>
          <Text style={styles.sub} numberOfLines={1}>{t('marketplaceButton.subtitle')}</Text>
        </View>
        <ChevronRight color={ACCENT} size={20} />
      </TouchableOpacity>
    </Animated.View>
  );
};

const makeStyles = (ACCENT) => StyleSheet.create({
  // Matches the app's standard settingGroup card exactly (same horizontal
  // margin, radius, and border width as every other Settings section) so it
  // sits flush with the rest of the list instead of floating wider/narrower.
  wrap: {
    borderRadius: 18,
    borderWidth: 1,
    backgroundColor: withAlpha(ACCENT, 0.06),
    overflow: 'hidden',
    marginHorizontal: 16,
    marginBottom: 28,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingRight: 16,
    paddingLeft: 14,
  },
  iconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: withAlpha(ACCENT, 0.18),
    alignItems: 'center', justifyContent: 'center',
    marginRight: 14,
  },
  title: { color: '#FAFAFA', fontSize: 16, fontWeight: '600' },
  sub: { color: ACCENT, fontSize: 12, marginTop: 3, fontWeight: '500' },
});
