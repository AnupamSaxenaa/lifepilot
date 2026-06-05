import React from 'react';
import { StyleSheet, View, useColorScheme } from 'react-native';
import { COLORS } from '../theme/theme';

export const BackgroundWrapper = ({ children }) => {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? COLORS.dark : COLORS.light;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
