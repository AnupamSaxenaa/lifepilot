import React, { useState, useRef } from 'react';
import { StyleSheet, TextInput, useColorScheme, View, TouchableOpacity, Animated } from 'react-native';
import { COLORS } from '../theme/theme';
import { Eye, EyeOff } from 'lucide-react-native';

export const GlassInput = ({ style, secureTextEntry, ...props }) => {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? COLORS.dark : COLORS.light;
  const [isSecure, setIsSecure] = useState(secureTextEntry);
  const [scaleValue] = useState(() => new Animated.Value(1));

  const toggleSecure = () => {
    Animated.sequence([
      Animated.timing(scaleValue, { toValue: 0.7, duration: 100, useNativeDriver: true }),
      Animated.timing(scaleValue, { toValue: 1, duration: 100, useNativeDriver: true })
    ]).start();
    setIsSecure(!isSecure);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.surface, borderColor: theme.border }, style]}>
      <TextInput 
        style={[styles.input, { color: theme.text }, secureTextEntry && { paddingRight: 50 }]} 
        placeholderTextColor={theme.textMuted}
        secureTextEntry={isSecure}
        {...props} 
      />
      {secureTextEntry && (
        <TouchableOpacity style={styles.eyeIcon} onPress={toggleSecure} activeOpacity={0.7}>
          <Animated.View style={{ transform: [{ scale: scaleValue }] }}>
            {isSecure ? (
              <EyeOff color={theme.textMuted} size={20} />
            ) : (
              <Eye color={theme.textMuted} size={20} />
            )}
          </Animated.View>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  input: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    fontSize: 16,
  },
  eyeIcon: {
    position: 'absolute',
    right: 16,
    padding: 4,
  }
});
