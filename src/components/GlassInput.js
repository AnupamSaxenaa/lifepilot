import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { COLORS } from '../theme/theme';

export const GlassInput = ({ icon: Icon, ...props }) => {
  return (
    <View style={styles.container}>
      <BlurView intensity={15} tint="light" style={styles.blurView}>
        {Icon && <Icon color={COLORS.textMuted} size={20} style={styles.icon} />}
        <TextInput 
          style={styles.input}
          placeholderTextColor={COLORS.textMuted}
          {...props}
        />
      </BlurView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    overflow: 'hidden',
    borderColor: COLORS.glassBorder,
    borderWidth: 1,
    marginBottom: 16,
    backgroundColor: COLORS.glassBackground,
  },
  blurView: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  icon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    color: COLORS.text,
    fontSize: 16,
    height: 48,
  },
});
