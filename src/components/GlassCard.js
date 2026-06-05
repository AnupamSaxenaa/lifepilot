import React from 'react';
import { StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { COLORS } from '../theme/theme';

export const GlassCard = ({ children, style }) => {
  return (
    <View style={[styles.container, style]}>
      <BlurView intensity={20} tint="light" style={styles.blurView}>
        {children}
      </BlurView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 24,
    overflow: 'hidden',
    borderColor: COLORS.glassBorder,
    borderWidth: 1,
    backgroundColor: COLORS.glassBackground,
  },
  blurView: {
    padding: 20,
  },
});
