import { Check } from 'lucide-react-native';
import { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useAuthPalette } from './auth/AuthKit';

export const GlassCheckbox = ({ isChecked, onToggle, label, style }) => {
  const palette = useAuthPalette();
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withTiming(isChecked ? 1.08 : 1, { duration: 90 }, () => {
      scale.value = withSpring(1, { damping: 12, stiffness: 260 });
    });
  }, [isChecked, scale]);

  const boxStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <TouchableOpacity
      style={[styles.container, style]}
      onPress={onToggle}
      activeOpacity={0.72}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: isChecked }}
    >
      <Animated.View
        style={[
          styles.box,
          {
            borderColor: isChecked ? palette.accent : palette.border,
            backgroundColor: isChecked ? palette.accent : 'transparent',
          },
          boxStyle,
        ]}
      >
        {isChecked ? <Check color="#FFFFFF" size={13} strokeWidth={3} /> : null}
      </Animated.View>
      <Text style={[styles.label, { color: palette.muted }]}>{label}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.3,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 11,
  },
  label: {
    fontSize: 13.5,
    lineHeight: 19,
    flex: 1,
  },
});
