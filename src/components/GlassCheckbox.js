import React from 'react';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { CheckSquare, Square } from 'lucide-react-native';
import { useColorScheme } from 'react-native';
import { COLORS } from '../theme/theme';

export const GlassCheckbox = ({ isChecked, onToggle, label, style }) => {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? COLORS.dark : COLORS.light;

  return (
    <TouchableOpacity 
      style={[styles.container, style]} 
      onPress={onToggle}
      activeOpacity={0.7}
    >
      <View style={styles.iconContainer}>
        {isChecked ? (
          <CheckSquare color={theme.primary} size={24} />
        ) : (
          <Square color={theme.textMuted} size={24} />
        )}
      </View>
      <Text style={[styles.label, { color: theme.textMuted }]}>{label}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  iconContainer: {
    marginRight: 12,
  },
  label: {
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
  },
});
