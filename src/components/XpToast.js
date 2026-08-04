// ─── XP Toast ────────────────────────────────────────────────
// A very small, dismissible popup that shows "+X XP" (gain) or "−X XP" (loss)
// whenever the user completes / un-completes a task or step. Mounted ONCE at
// the app root; it listens to the global XpEvents bus so every screen triggers
// it automatically. Auto-hides after a couple seconds and has a tiny ✕ to
// dismiss immediately.
// ─────────────────────────────────────────────────────────────
import { X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { XpEvents } from '../utils/xpEvents';

export const XpToast = () => {
  const [amount, setAmount] = useState(0);
  const [visible, setVisible] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(10)).current;
  const hideTimer = useRef(null);

  useEffect(() => {
    const unsub = XpEvents.subscribe((delta) => {
      setAmount(delta);
      setVisible(true);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!visible) return;
    // Animate in
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, friction: 7, tension: 60, useNativeDriver: true }),
    ]).start();

    // Auto-hide after 2s
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(dismiss, 2000);

    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, amount]);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 160, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 10, duration: 160, useNativeDriver: true }),
    ]).start(() => {
      setVisible(false);
      translateY.setValue(10);
    });
  };

  if (!visible) return null;

  const gain = amount > 0;
  const color = gain ? '#34D399' : '#FB7185';
  const label = `${gain ? '+' : '−'}${Math.abs(amount)} XP`;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Animated.View style={[styles.pill, { opacity, transform: [{ translateY }], borderColor: color + '55' }]}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={[styles.text, { color }]}>{label}</Text>
        <TouchableOpacity onPress={dismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.close}>
          <X color="#8A8A8E" size={13} />
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 54,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(18,18,20,0.96)',
    borderWidth: 1,
    borderRadius: 999,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 7,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
  close: { padding: 3, marginLeft: 2 },
});
