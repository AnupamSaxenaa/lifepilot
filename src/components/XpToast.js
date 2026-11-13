// ─── XP Toast ────────────────────────────────────────────────
// A quiet confirmation that XP changed. Mounted ONCE at the app root and
// driven by the global XpEvents bus, so every screen gets it for free.
//
// Deliberately monochrome: the old version used a saturated green/red pill
// with heavy 800-weight type, which fought the app's black-and-white,
// thin-typography language. Direction is now carried by an arrow, a hairline
// border, and weight — not by colour.
// ─────────────────────────────────────────────────────────────
import { ArrowDownRight, ArrowUpRight } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { XpEvents } from '../utils/xpEvents';

export const XpToast = () => {
  const [amount, setAmount] = useState(0);
  const [visible, setVisible] = useState(false);
  const [opacity] = useState(() => new Animated.Value(0));
  const [translateY] = useState(() => new Animated.Value(-8));
  const [scale] = useState(() => new Animated.Value(0.96));
  const hideTimer = useRef(null);

  useEffect(() => {
    const unsub = XpEvents.subscribe((delta) => {
      setAmount(delta);
      setVisible(true);
    });
    return unsub;
  }, []);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 200, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(translateY, { toValue: -8, duration: 200, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start(() => {
      setVisible(false);
      translateY.setValue(-8);
      scale.setValue(0.96);
    });
  };

  useEffect(() => {
    if (!visible) return undefined;

    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, damping: 16, stiffness: 180, mass: 0.7, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, damping: 15, stiffness: 190, mass: 0.7, useNativeDriver: true }),
    ]).start();

    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(dismiss, 1900);

    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, amount]);

  if (!visible) return null;

  const gain = amount > 0;
  const Arrow = gain ? ArrowUpRight : ArrowDownRight;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Animated.View
        style={[
          styles.pill,
          { opacity, transform: [{ translateY }, { scale }] },
        ]}
      >
        <TouchableOpacity
          onPress={dismiss}
          activeOpacity={0.75}
          style={styles.inner}
          accessibilityRole="button"
          accessibilityLabel={`${gain ? 'Gained' : 'Lost'} ${Math.abs(amount)} XP`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Arrow color={gain ? '#F4F4F5' : '#8A8A8E'} size={13} strokeWidth={2} />
          <Text style={[styles.value, !gain && styles.valueLoss]}>{Math.abs(amount)}</Text>
          <Text style={styles.unit}>XP</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 52,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  pill: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(244,244,245,0.22)',
    backgroundColor: 'rgba(10,10,11,0.92)',
    overflow: 'hidden',
  },
  inner: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
  },
  value: {
    color: '#F4F4F5',
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: -0.2,
  },
  valueLoss: { color: '#8A8A8E' },
  unit: {
    color: '#71717A',
    fontSize: 9.5,
    fontWeight: '600',
    letterSpacing: 1,
  },
});
