import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { BlurView } from 'expo-blur';
import { COLORS } from '../theme/theme';

export const GlassButton = ({ title, onPress, icon: Icon, style }) => {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={[styles.container, style]}>
      <BlurView intensity={30} tint="light" style={styles.blurView}>
        {Icon && <Icon color={COLORS.text} size={20} style={styles.icon} />}
        <Text style={styles.text}>{title}</Text>
      </BlurView>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    overflow: 'hidden',
    borderColor: COLORS.glassBorder,
    borderWidth: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  blurView: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  icon: {
    marginRight: 8,
  },
  text: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
  },
});
