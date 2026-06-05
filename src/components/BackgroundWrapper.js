import React from 'react';
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../theme/theme';

export const BackgroundWrapper = ({ children }) => {
  return (
    <LinearGradient
      colors={[COLORS.backgroundStart, COLORS.backgroundEnd]}
      style={styles.container}
    >
      {children}
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
