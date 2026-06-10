import React from 'react';
import { StyleSheet, View, useColorScheme } from 'react-native';
import { BlurView } from 'expo-blur';
import { COLORS } from '../theme/theme';

export const GlassCard = ({ children, style }) => {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? COLORS.dark : COLORS.light;
  const blurTint = colorScheme === 'dark' ? 'dark' : 'light';

  return (
    <View style={[styles.container, style]}>
      <BlurView intensity={40} tint={blurTint} style={styles.blur}>
        <View style={[
          styles.content, 
          { 
            backgroundColor: theme.glassBackground,
            borderColor: theme.glassBorder 
          }
        ]}>
          {children}
        </View>
      </BlurView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 24,
    overflow: 'hidden',
    marginVertical: 8,
  },
  blur: {
  },
  content: {
    padding: 24,
    borderWidth: 1,
    borderRadius: 24,
  },
});
