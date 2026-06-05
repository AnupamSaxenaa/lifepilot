import React from 'react';
import { StyleSheet, TextInput, useColorScheme, View } from 'react-native';
import { COLORS } from '../theme/theme';

export const GlassInput = ({ style, ...props }) => {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? COLORS.dark : COLORS.light;

  return (
    <View style={[styles.container, { backgroundColor: theme.surface, borderColor: theme.border }, style]}>
      <TextInput 
        style={[styles.input, { color: theme.text }]} 
        placeholderTextColor={theme.textMuted}
        {...props} 
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
    overflow: 'hidden',
  },
  input: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    fontSize: 16,
  },
});
