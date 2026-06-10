import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export const PasswordStrengthIndicator = ({ password }) => {
  let score = 0;
  
  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;

  const getBarColor = (index) => {
    if (score === 0) return '#334155'; // default dark gray
    if (score < 3) return index < score ? '#ef4444' : '#334155'; // Weak: Red
    if (score === 3) return index < score ? '#eab308' : '#334155'; // Fair: Yellow
    return index < score ? '#22c55e' : '#334155'; // Strong: Green
  };

  const getLabel = () => {
    if (score === 0) return '';
    if (score < 3) return 'Weak';
    if (score === 3) return 'Fair';
    return 'Strong';
  };

  return (
    <View style={styles.container}>
      <View style={styles.barsContainer}>
        {[0, 1, 2, 3].map((index) => (
          <View 
            key={index} 
            style={[styles.bar, { backgroundColor: getBarColor(index) }]} 
          />
        ))}
      </View>
      <View style={styles.labelContainer}>
        <Text style={styles.label}>{getLabel()}</Text>
        <Text style={styles.hint}>At least 8 chars, 1 uppercase, 1 number</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  barsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  bar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    marginHorizontal: 2,
  },
  labelContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  label: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#94a3b8',
  },
  hint: {
    fontSize: 10,
    color: '#64748b',
  },
});
