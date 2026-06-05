import React, { useState, useRef } from 'react';
import { StyleSheet, Text, View, SafeAreaView, Dimensions, TouchableOpacity, FlatList, useColorScheme } from 'react-native';
import { BackgroundWrapper } from '../components/BackgroundWrapper';
import { GlassButton } from '../components/GlassButton';
import { COLORS } from '../theme/theme';
import { Target, LayoutGrid, TrendingUp } from 'lucide-react-native';

const { width, height } = Dimensions.get('window');

const SLIDES = [
  {
    id: '1',
    title: 'Welcome to LifePilot',
    description: 'Master your tasks and focus sessions with a minimalist approach to gamified productivity.',
    icon: Target,
  },
  {
    id: '2',
    title: 'The Eisenhower Matrix',
    description: 'Organize your life seamlessly. Prioritize what matters, delegate the rest, and eliminate the noise.',
    icon: LayoutGrid,
  },
  {
    id: '3',
    title: 'Level Up Your Life',
    description: 'Complete tasks, earn focus hours, and watch your real-life stats grow day by day.',
    icon: TrendingUp,
  }
];

export const OnboardingScreen = ({ navigation }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef(null);
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? COLORS.dark : COLORS.light;

  const handleNext = () => {
    if (currentIndex < SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1, animated: true });
    } else {
      navigation.replace('Login');
    }
  };

  const handleSkip = () => {
    navigation.replace('Login');
  };

  const onScroll = (event) => {
    const slideSize = event.nativeEvent.layoutMeasurement.width;
    const index = event.nativeEvent.contentOffset.x / slideSize;
    const roundIndex = Math.round(index);
    if (roundIndex !== currentIndex) {
      setCurrentIndex(roundIndex);
    }
  };

  return (
    <BackgroundWrapper>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          {currentIndex < SLIDES.length - 1 ? (
            <TouchableOpacity onPress={handleSkip}>
              <Text style={[styles.skipText, { color: theme.textMuted }]}>Skip</Text>
            </TouchableOpacity>
          ) : (
            <View /> // Empty view to maintain layout
          )}
        </View>

        <FlatList
          ref={flatListRef}
          data={SLIDES}
          keyExtractor={(item) => item.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          bounces={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          renderItem={({ item }) => (
            <View style={[styles.slide, { width }]}>
              <View style={[styles.iconContainer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <item.icon size={80} color={theme.text} strokeWidth={1.5} />
              </View>
              <Text style={[styles.title, { color: theme.text }]}>{item.title}</Text>
              <Text style={[styles.description, { color: theme.textMuted }]}>{item.description}</Text>
            </View>
          )}
        />

        <View style={styles.footer}>
          <View style={styles.pagination}>
            {SLIDES.map((_, index) => (
              <View
                key={index}
                style={[
                  styles.dot,
                  { backgroundColor: currentIndex === index ? theme.text : theme.border }
                ]}
              />
            ))}
          </View>
          <GlassButton 
            title={currentIndex === SLIDES.length - 1 ? "Let's Go" : "Next"} 
            onPress={handleNext} 
          />
        </View>
      </SafeAreaView>
    </BackgroundWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 24,
    paddingTop: 20,
    height: 60,
  },
  skipText: {
    fontSize: 16,
    fontWeight: '600',
  },
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingBottom: 60,
  },
  iconContainer: {
    width: 160,
    height: 160,
    borderRadius: 80,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 40,
    borderWidth: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  description: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginHorizontal: 4,
  },
});
