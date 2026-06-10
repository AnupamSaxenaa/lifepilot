import React, { useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, BackHandler, Animated, Dimensions } from 'react-native';
import notifee from '@notifee/react-native';
import { Audio } from 'expo-av';
import { scheduleSnoozeAlarm } from '../utils/AlarmManager';
import { LiquidAura } from '../components/LiquidAura';

const { width, height } = Dimensions.get('window');

const FALLBACK_QUOTES = [
  "Wake up and conquer your day.",
  "Your goals are waiting for you.",
  "Every morning is a new opportunity.",
  "Rise and shine, it's time to grind.",
  "Make today incredible."
];

// Galaxy Starfield component
const Starfield = () => {
  const moveAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(moveAnim, {
        toValue: 1,
        duration: 40000,
        useNativeDriver: true,
      })
    ).start();
  }, []);

  const translateY = moveAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -height]
  });

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.starsContainer, { transform: [{ translateY }] }]}>
        {/* Render 50 random white dots */}
        {[...Array(60)].map((_, i) => {
          const size = Math.random() * 3 + 1;
          const left = Math.random() * width;
          const top = Math.random() * (height * 2);
          const opacity = Math.random() * 0.8 + 0.2;
          return (
            <View key={i} style={[styles.star, { width: size, height: size, left, top, opacity }]} />
          );
        })}
      </Animated.View>
    </View>
  );
};

// Typewriter component
const TypewriterText = ({ quotes }) => {
  const [currentQuoteIndex, setCurrentQuoteIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState('');
  const fadeAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let timeout;
    let charIndex = 0;
    const currentQuote = quotes[currentQuoteIndex];
    setDisplayedText('');
    fadeAnim.setValue(1);

    const typeChar = () => {
      if (charIndex < currentQuote.length) {
        setDisplayedText(currentQuote.substring(0, charIndex + 1));
        charIndex++;
        timeout = setTimeout(typeChar, 40);
      } else {
        // Finished typing. Wait 7 seconds, fade out, then next.
        timeout = setTimeout(() => {
          Animated.timing(fadeAnim, { toValue: 0, duration: 1000, useNativeDriver: true }).start(() => {
            setCurrentQuoteIndex((prev) => (prev + 1) % quotes.length);
          });
        }, 7000);
      }
    };
    
    timeout = setTimeout(typeChar, 500); // small initial delay
    return () => clearTimeout(timeout);
  }, [currentQuoteIndex, quotes]);

  return (
    <Animated.Text style={[styles.motivationText, { opacity: fadeAnim }]}>
      {displayedText}
    </Animated.Text>
  );
};

export default function AlarmScreen(props) {
  const [soundObj, setSoundObj] = useState(null);

  // Extract quotes and sound_uri from props if available
  const notification = props.notification || {};
  const data = notification.data || {};
  const soundUri = data.sound_uri;
  
  // Parse quotes if they were pre-generated, else use fallback
  let quotes = FALLBACK_QUOTES;
  if (data.motivation_quotes) {
    try {
      const parsed = JSON.parse(data.motivation_quotes);
      if (Array.isArray(parsed) && parsed.length > 0) {
        quotes = parsed;
      }
    } catch (e) {}
  }

  useEffect(() => {
    const backAction = () => true;
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);

    // Play custom audio if provided
    let localSound = null;
    const playAudio = async () => {
      try {
        if (soundUri && soundUri !== 'default') {
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: false,
            playsInSilentModeIOS: true,
            staysActiveInBackground: true,
            shouldDuckAndroid: true,
            playThroughEarpieceAndroid: false,
          });
          const { sound } = await Audio.Sound.createAsync({ uri: soundUri });
          localSound = sound;
          await sound.setIsLoopingAsync(true);
          await sound.playAsync();
          setSoundObj(sound);
        }
      } catch (e) {
        console.log('Error playing custom sound', e);
      }
    };
    playAudio();

    return () => {
      backHandler.remove();
      if (localSound) localSound.unloadAsync();
    };
  }, []);

  const handleDismiss = async () => {
    if (soundObj) await soundObj.unloadAsync();
    await notifee.cancelAllNotifications();
  };

  const handleSnooze = async (minutes) => {
    if (soundObj) await soundObj.unloadAsync();
    await notifee.cancelAllNotifications();
    const snoozeTimeMs = Date.now() + minutes * 60 * 1000;
    await scheduleSnoozeAlarm(snoozeTimeMs);
  };

  const now = new Date();
  const timeString = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

  return (
    <View style={styles.container}>
      <Starfield />

      <View style={styles.content}>
        <Text style={styles.time}>{timeString}</Text>
        
        <View style={styles.auraContainer}>
          <LiquidAura isListening={true} isProcessing={false} />
        </View>

        <View style={styles.motivationContainer}>
          <TypewriterText quotes={quotes} />
        </View>
        
        <View style={styles.snoozeContainer}>
          <Text style={styles.snoozeLabel}>Snooze for:</Text>
          <View style={styles.snoozeRow}>
            <TouchableOpacity style={styles.snoozeBtn} onPress={() => handleSnooze(5)} activeOpacity={0.7}>
              <Text style={styles.btnTextSm}>5m</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.snoozeBtn} onPress={() => handleSnooze(10)} activeOpacity={0.7}>
              <Text style={styles.btnTextSm}>10m</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.snoozeBtn} onPress={() => handleSnooze(15)} activeOpacity={0.7}>
              <Text style={styles.btnTextSm}>15m</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity style={styles.dismissBtn} onPress={handleDismiss} activeOpacity={0.8}>
          <Text style={styles.btnText}>Dismiss</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  starsContainer: { position: 'absolute', width: width, height: height * 2 },
  star: { position: 'absolute', backgroundColor: '#FFF', borderRadius: 50 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', zIndex: 10, paddingHorizontal: 20 },
  time: { fontSize: 72, color: '#FFF', fontWeight: '300', marginBottom: 10 },
  auraContainer: { width: 240, height: 240, justifyContent: 'center', alignItems: 'center', marginVertical: 10 },
  motivationContainer: { minHeight: 100, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 30, width: '100%' },
  motivationText: { color: '#E4E4E7', fontSize: 22, fontWeight: '500', textAlign: 'center', lineHeight: 32, fontStyle: 'italic' },
  snoozeContainer: { marginBottom: 30, width: '100%', alignItems: 'center' },
  snoozeLabel: { color: '#A1A1AA', fontSize: 16, marginBottom: 12 },
  snoozeRow: { flexDirection: 'row', gap: 16 },
  snoozeBtn: { backgroundColor: 'rgba(39, 39, 42, 0.7)', paddingVertical: 16, paddingHorizontal: 24, borderRadius: 16, alignItems: 'center', borderWidth: 1, borderColor: '#3F3F46' },
  dismissBtn: { backgroundColor: '#FF453A', padding: 20, borderRadius: 32, width: '100%', alignItems: 'center', marginTop: 10, shadowColor: '#FF453A', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 10 },
  btnText: { fontSize: 20, color: '#FFF', fontWeight: '600' },
  btnTextSm: { fontSize: 18, color: '#FFF', fontWeight: '600' },
});
