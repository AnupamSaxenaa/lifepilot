import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Vibration, Dimensions } from 'react-native';

import { Bell, X } from 'lucide-react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, Easing } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

const { width, height } = Dimensions.get('window');

export const AlarmOverlay = ({ visible, alarmData, onDismiss }) => {
  const [sound, setSound] = useState(null);
  const pulseAnim = useSharedValue(1);

  useEffect(() => {
    if (visible) {
      // Start pulsing animation
      pulseAnim.value = withRepeat(
        withSequence(
          withTiming(1.2, { duration: 600, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 600, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      );

      // Start Vibration
      Vibration.vibrate([1000, 1000, 1000, 1000], true);

    } else {
      pulseAnim.value = 1;
      Vibration.cancel();
    }

    return () => {
      Vibration.cancel();
    };
  }, [visible]);

  const handleDismiss = () => {
    Vibration.cancel();
    onDismiss();
  };

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseAnim.value }],
  }));

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.container}>
        <LinearGradient
          colors={['rgba(20,20,22,0.95)', 'rgba(5,5,5,0.98)']}
          style={StyleSheet.absoluteFill}
        />
        
        <View style={styles.content}>
          <Animated.View style={[styles.bellContainer, pulseStyle]}>
            <LinearGradient
              colors={['rgba(167, 139, 250, 0.4)', 'rgba(167, 139, 250, 0.1)']}
              style={styles.bellGlow}
            >
              <Bell color="#A78BFA" size={64} />
            </LinearGradient>
          </Animated.View>

          <Text style={styles.title}>{alarmData?.title || 'Alarm'}</Text>
          <Text style={styles.time}>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>

          <TouchableOpacity style={styles.dismissBtn} onPress={handleDismiss} activeOpacity={0.8}>
            <X color="#111" size={24} />
            <Text style={styles.dismissText}>Dismiss Alarm</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    width: '100%',
    paddingHorizontal: 20,
  },
  bellContainer: {
    marginBottom: 40,
  },
  bellGlow: {
    width: 140,
    height: 140,
    borderRadius: 70,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.5)',
  },
  title: {
    color: '#FFF',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  time: {
    color: '#A78BFA',
    fontSize: 64,
    fontWeight: '800',
    marginBottom: 60,
  },
  dismissBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#A78BFA',
    paddingVertical: 18,
    paddingHorizontal: 40,
    borderRadius: 30,
    gap: 12,
  },
  dismissText: {
    color: '#111',
    fontSize: 20,
    fontWeight: '700',
  },
});
