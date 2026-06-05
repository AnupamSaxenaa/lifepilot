import React from 'react';
import { SafeAreaView, Text, StyleSheet } from 'react-native';
import { BackgroundWrapper } from '../components/BackgroundWrapper';

export const TasksScreen = () => {
  return (
    <BackgroundWrapper>
      <SafeAreaView style={styles.container}>
        <Text style={styles.text}>Tasks Screen (Eisenhower Matrix) Coming Soon!</Text>
      </SafeAreaView>
    </BackgroundWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    fontSize: 18,
    fontWeight: 'bold',
  }
});
