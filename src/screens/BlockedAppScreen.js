import React, { useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, BackHandler, Animated, Easing, StyleSheet, Dimensions, Platform, Image } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BrainCircuit } from 'lucide-react-native';
import { getApps, grantTempAllowance, getProfile, addLogEntry } from '../utils/mindfulLock';
import { generateAggressiveBlockMessage, generateMindfulIntervention } from '../lib/AIEngine';
import { loadTasks } from '../lib/dataManager';
import { supabase } from '../lib/supabase';
import { Gamification } from '../utils/gamification';

const { width } = Dimensions.get('window');

const getTasksByDate = async (userId, targetDate) => {
  const allTasks = await loadTasks(userId, () => {});
  const dateStr = targetDate.toISOString().split('T')[0];
  
  return (allTasks || []).filter(t => {
    if (t.is_deleted || t.status === 'completed') return false;
    if (t.planned_date && t.planned_date.startsWith(dateStr)) return true;
    if (t.due_date && t.due_date.startsWith(dateStr)) return true;
    if (t.recurrence_rule) return true;
    return false;
  });
};

export function BlockedAppScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const [appId, setAppId] = useState(null);
  const [appName, setAppName] = useState('');
  const [message, setMessage] = useState('');
  const [displayedText, setDisplayedText] = useState('');
  const [canUnlock, setCanUnlock] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isStrict, setIsStrict] = useState(true);
  const [grantCountdown, setGrantCountdown] = useState(10);

  const blockedPkg = route.params?.app || route.params?.blocked_app;

  useEffect(() => {
    // 🔒 HARCORE LOCK: Disable physical back button on Android (only if strict)
    const backAction = () => {
      if (isStrict) return true; // prevent default
      return false; // allow back button if not strict
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [isStrict]);

  useEffect(() => {
    const initBlockScreen = async () => {
      if (!blockedPkg) {
        // Fallback if opened without context
        setMessage("You shouldn't be here. Get back to work.");
        setLoading(false);
        return;
      }

      const session = await supabase.auth.getSession();
      const userId = session?.data?.session?.user?.id;
      
      let name = blockedPkg;
      if (userId) {
        const apps = await getApps(userId);
        const app = apps.find(a => a.packageName === blockedPkg || a.name.toLowerCase() === blockedPkg);
        if (app) {
          name = app.name;
          setAppId(app.id);
        }

        const profile = await getProfile(userId);
        const strictMode = profile?.blockingMode === 'strict';
        setIsStrict(strictMode);

        // Fetch today's tasks for AI context
        const todayTasks = await getTasksByDate(userId, new Date());
        
        // Generate AI message
        if (strictMode) {
          const aiMessage = await generateAggressiveBlockMessage(name, todayTasks);
          setMessage(aiMessage);
        } else {
          const aiMessageObj = await generateMindfulIntervention(name, '', 'gentle', null, null);
          setMessage(aiMessageObj?.message || `Take a deep breath. Do you really need to use ${name} right now?`);
          setCanUnlock(true); // Don't enforce 10s wait in coach mode
        }
      } else {
        setMessage(`WTF are you doing opening ${name}? Close it right now and get back to work.`);
      }
      
      setAppName(name);
      setLoading(false);
    };

    initBlockScreen();
  }, [blockedPkg]);

  // Typewriter effect
  useEffect(() => {
    if (!loading && message) {
      if (displayedText.length < message.length) {
        const timer = setTimeout(() => {
          setDisplayedText(message.slice(0, displayedText.length + 1));
        }, 35); // 35ms per character for smooth typing
        return () => clearTimeout(timer);
      } else if (displayedText.length === message.length && !canUnlock) {
        // Finished typing! Show buttons immediately
        setCanUnlock(true);
      }
    }
  }, [loading, message, displayedText, canUnlock]);

  // Grant Countdown Timer
  useEffect(() => {
    if (canUnlock && grantCountdown > 0) {
      const timer = setTimeout(() => {
        setGrantCountdown(prev => prev - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [canUnlock, grantCountdown]);

  const handleGrantAllowance = async (mins) => {
    const session = await supabase.auth.getSession();
    const userId = session?.data?.session?.user?.id;
    if (userId && appId) {
      await grantTempAllowance(userId, appId, mins);
      await Gamification.addXP(userId, -20);
      await addLogEntry(userId, { appId, appName, action: 'granted', duration: mins });
    }
    
    // Exit lifepilot completely so it returns to the previously opened app (e.g. YouTube)
    if (Platform.OS === 'android') {
      BackHandler.exitApp();
    } else {
      navigation.goBack();
    }
  };

  const handleCloseApp = async () => {
    // Reward resisting the urge
    const session = await supabase.auth.getSession();
    const userId = session?.data?.session?.user?.id;
    if (userId) {
      await Gamification.addXP(userId, 15);
      await addLogEntry(userId, { appId, appName: appName || 'App', action: 'closed' });
    }

    // They are closing it, redirect them to the Android Home Screen
    if (Platform.OS === 'android') {
      try {
        const IntentLauncher = require('expo-intent-launcher');
        await IntentLauncher.startActivityAsync('android.intent.action.MAIN', {
          category: 'android.intent.category.HOME',
          flags: 268435456, // FLAG_ACTIVITY_NEW_TASK
        });
        
        // Wait a tiny bit for the home screen transition to start, then kill the React activity
        setTimeout(() => {
          BackHandler.exitApp();
        }, 100);
      } catch (e) {
        BackHandler.exitApp();
      }
    } else {
      navigation.goBack();
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.gifContainer}>
          <Image source={require('../../assets/finalstop.gif')} style={styles.gifImage} />
        </View>
        
        <View style={styles.messageContainer}>
          <Text style={styles.typewriterText}>
            {loading ? 'Analyzing your behavior...' : displayedText}
            {!canUnlock && <Text style={styles.cursor}>|</Text>}
          </Text>
        </View>

        {canUnlock && (
          <View style={styles.actionContainer}>
            <TouchableOpacity style={styles.closeBtn} onPress={handleCloseApp}>
              <Text style={styles.closeBtnText}>I{"'"}m closing {appName || 'it'}. Thanks.</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.temptedBtn} 
              onPress={() => {
                navigation.navigate('MindfulLock', { 
                  triggerInterventionForApp: blockedPkg, 
                  appName: appName 
                });
              }}
              activeOpacity={0.8}
            >
              <BrainCircuit color="#A855F7" size={20} style={{ marginRight: 8 }} />
              <Text style={styles.temptedBtnText}>I'm Tempted (Talk to Coach)</Text>
            </TouchableOpacity>

            <Text style={styles.orText}>Or override quickly:</Text>

            <View style={styles.grantRow}>
              <TouchableOpacity 
                style={[styles.grantBtn, grantCountdown > 0 && { opacity: 0.5 }]} 
                onPress={() => handleGrantAllowance(2)}
                disabled={grantCountdown > 0}
              >
                <Text style={styles.grantBtnText}>{grantCountdown > 0 ? `Wait ${grantCountdown}s` : '2 Min'}</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.grantBtn, grantCountdown > 0 && { opacity: 0.5 }]} 
                onPress={() => handleGrantAllowance(5)}
                disabled={grantCountdown > 0}
              >
                <Text style={styles.grantBtnText}>{grantCountdown > 0 ? `Wait ${grantCountdown}s` : '5 Min'}</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.grantBtn, grantCountdown > 0 && { opacity: 0.5 }]} 
                onPress={() => handleGrantAllowance(10)}
                disabled={grantCountdown > 0}
              >
                <Text style={styles.grantBtnText}>{grantCountdown > 0 ? `Wait ${grantCountdown}s` : '10 Min'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  content: {
    flex: 1,
    padding: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gifContainer: {
    width: 140,
    height: 140,
    borderRadius: 70,
    overflow: 'hidden',
    marginBottom: 30,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#a855f7', // Purple ring around it
  },
  gifImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  messageContainer: {
    width: '100%',
    minHeight: 120, // Shrunk from 180
    backgroundColor: 'rgba(168, 85, 247, 0.05)',
    borderRadius: 24,
    padding: 20, // Shrunk from 24
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.2)',
    marginBottom: 24, // Shrunk from 32
  },
  typewriterText: {
    color: '#ffffff',
    fontSize: 18, // Shrunk from 22
    lineHeight: 28, // Shrunk from 34
    fontWeight: '600',
  },
  cursor: {
    color: '#a855f7', // Purple
    fontWeight: 'bold',
  },
  actionContainer: {
    width: '100%',
    gap: 16,
  },
  closeBtn: {
    backgroundColor: '#a855f7', // Purple
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: 'center',
    width: '100%',
  },
  closeBtnText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  temptedBtn: {
    flexDirection: 'row',
    backgroundColor: 'rgba(168, 85, 247, 0.1)',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.3)',
  },
  temptedBtnText: {
    color: '#A855F7',
    fontSize: 16,
    fontWeight: '700',
  },
  orText: {
    color: '#52525b',
    fontSize: 13,
    textAlign: 'center',
    marginVertical: 4,
  },
  grantRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    gap: 12,
  },
  grantBtn: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333333',
  },
  grantBtnText: {
    color: '#a3a3a3',
    fontSize: 16,
    fontWeight: '600',
  },
});
