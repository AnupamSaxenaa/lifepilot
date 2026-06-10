import React from 'react';
import { StyleSheet, Text, TouchableOpacity, useColorScheme, View, Image } from 'react-native';
import { COLORS } from '../theme/theme';

export const GlassButton = ({ title, onPress, icon: Icon, imageSource, style, textStyle }) => {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? COLORS.dark : COLORS.light;

  return (
    <TouchableOpacity 
      style={[styles.button, { backgroundColor: theme.surface, borderColor: theme.border }, style]} 
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.content}>
        {imageSource ? (
          <Image source={imageSource} style={[styles.imageIcon, title && styles.iconWithText]} />
        ) : Icon ? (
          <Icon color={theme.text} size={20} style={[styles.icon, title && styles.iconWithText]} />
        ) : null}
        {title ? (
          <Text style={[styles.title, { color: theme.text }, textStyle]}>{title}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  icon: {
    marginRight: 8,
  },
  iconWithText: {
    marginRight: 8,
  },
  imageIcon: {
    width: 20,
    height: 20,
    resizeMode: 'contain',
  },
});
