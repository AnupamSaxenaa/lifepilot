import { useNavigation, useRoute } from '@react-navigation/native';
import { BrainCircuit } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackHandler, Image, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { generateAggressiveBlockMessage, generateMindfulIntervention } from '../lib/AIEngine';
import { getCurrentUserId } from '../lib/dataManager';
import { getSyncState } from '../lib/syncQueue';
import { Gamification } from '../utils/gamification';
import { addLogEntry, getApps, getEffectiveBlockingMode, getProfile, grantTempAllowance } from '../utils/mindfulLock';
import { Storage } from '../utils/storage';

const getTasksByDate = async (userId, targetDate) => {
  const allTasks = await Storage.get(`tasks_${userId}`) || [];
  const dateStr = targetDate.toISOString().split('T')[0];
  
  return (Array.isArray(allTasks) ? allTasks : []).filter(t => {
    if (t.is_deleted || t.status === 'completed') return false;
    if (t.planned_date && t.planned_date.startsWith(dateStr)) return true;
    if (t.due_date && t.due_date.startsWith(dateStr)) return true;
    if (t.recurrence_rule) return true;
    return false;
  });
};

export function BlockedAppScreen() {
  const { t } = useTranslation();
  const route = useRoute();
  const navigation = useNavigation();
  const { theme } = useTheme();
  const ACCENT = theme.accent;
  const ON_ACCENT = theme.onAccent || '#0B0B0D';
  const styles = useMemo(() => makeStyles(ACCENT, ON_ACCENT), [ACCENT, ON_ACCENT]);
  const blockedPkg = route.params?.app || route.params?.blocked_app;
  const fallbackName = blockedPkg || t('blockedApp.fallbackAppName');
  const fallbackMessage = blockedPkg
    ? t('blockedApp.coachFallbackMessage', { name: fallbackName })
    : t('blockedApp.noContextMessage');
  const [appId, setAppId] = useState(null);
  const [appName, setAppName] = useState(fallbackName);
  const [message, setMessage] = useState(fallbackMessage);
  const [isStrict, setIsStrict] = useState(true);
  const [grantCountdown, setGrantCountdown] = useState(10);

  // ── Replayed-block guard ───────────────────────────────────────────────────
  // The accessibility service opens this screen with FLAG_ACTIVITY_NEW_TASK, so
  // `lifepilot://blocked?...` becomes the BASE INTENT of LifePilot's task.
  // Android replays a task's base intent whenever the user reopens the app from
  // the launcher or recents, which dropped them back onto this screen instead of
  // their dashboard — the screen had already dismissed itself correctly, the
  // intent was simply being delivered again.
  //
  // Each block carries a `t` token. We remember the last token acted on and send
  // any repeat straight to the dashboard, so a replay is inert while a genuinely
  // new block still shows. Tokens without `t` (a stale native build) fall through
  // and display, which is the safe direction to fail.
  const blockToken = route.params?.t ? String(route.params.t) : null;
  const [replayChecked, setReplayChecked] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!blockToken) {
        if (active) setReplayChecked(true);
        return;
      }
      const seen = await Storage.get('mindful_last_block_token');
      if (!active) return;
      if (String(seen) === blockToken) {
        // Same block we already handled: this is a replayed base intent.
        navigation.reset({ index: 0, routes: [{ name: 'Dashboard' }] });
        return;
      }
      await Storage.set('mindful_last_block_token', blockToken);
      if (active) setReplayChecked(true);
    })().catch(() => {
      if (active) setReplayChecked(true);
    });
    return () => { active = false; };
  }, [blockToken, navigation]);

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
    let active = true;
    // Immediate fallback state was initialized during render; AI remains an
    // optional asynchronous enhancement.
    if (!blockedPkg) return () => { active = false; };

    (async () => {
      const userId = await getCurrentUserId();
      if (!userId || !active) return;

      let name = blockedPkg;
      const [apps, profile] = await Promise.all([getApps(userId), getProfile(userId)]);
      if (!active) return;
      const app = apps.find((item) => (
        item.packageName === blockedPkg || item.name.toLowerCase() === blockedPkg.toLowerCase()
      ));
      if (app) {
        name = app.name;
        setAppId(app.id);
        setAppName(name);
      }

      const strictMode = getEffectiveBlockingMode(profile) === 'strict';
      setIsStrict(strictMode);
      const todayTasks = await getTasksByDate(userId, new Date());
      if (!getSyncState().online) return;
      const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 1000));
      const generated = strictMode
        ? await Promise.race([generateAggressiveBlockMessage(name, todayTasks), timeout])
        : await Promise.race([generateMindfulIntervention(name, '', 'gentle', null, null), timeout]);
      if (!active || !generated) return;
      const nextMessage = strictMode ? generated : generated?.message;
      if (nextMessage) setMessage(nextMessage);
    })().catch((error) => {
      console.log('[BlockedApp] Optional AI message unavailable:', error?.message || error);
    });

    return () => { active = false; };
  }, [blockedPkg, t]);

  // Grant Countdown Timer
  useEffect(() => {
    if (!isStrict && grantCountdown > 0) {
      const timer = setTimeout(() => {
        setGrantCountdown(prev => prev - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [grantCountdown, isStrict]);

  const handleGrantAllowance = async (mins) => {
    const userId = await getCurrentUserId();
    if (userId && appId) {
      await grantTempAllowance(userId, appId, mins);
      await Gamification.addXP(userId, -20);
      await addLogEntry(userId, { appId, appName, action: 'granted', duration: mins });
    }
    
    // Clear the block screen from the nav stack so reopening LifePilot lands on
    // the dashboard instead of resuming on this block screen.
    navigation.reset({ index: 0, routes: [{ name: 'Dashboard' }] });

    // Exit lifepilot completely so it returns to the previously opened app (e.g. YouTube)
    if (Platform.OS === 'android') {
      BackHandler.exitApp();
    } else {
      navigation.goBack();
    }
  };

  const handleCloseApp = async () => {
    // Reward resisting the urge
    const userId = await getCurrentUserId();
    if (userId) {
      await Gamification.addXP(userId, 15);
      await addLogEntry(userId, { appId, appName: appName || 'App', action: 'closed' });
    }

    // Clear the block screen from the nav stack so reopening LifePilot lands on
    // the dashboard instead of resuming on this block screen.
    navigation.reset({ index: 0, routes: [{ name: 'Dashboard' }] });

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
      } catch (_error) {
        BackHandler.exitApp();
      }
    } else {
      navigation.goBack();
    }
  };

  // Hold the render until the replay check has run. Without this a reopened
  // LifePilot flashes the full block screen for a frame before bouncing to the
  // dashboard, which reads as the bug still being present.
  if (!replayChecked) return <SafeAreaView style={styles.container} />;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.gifContainer}>
          <Image source={require('../../assets/finalstop.gif')} style={styles.gifImage} />
        </View>
        
        <View style={styles.messageContainer}>
          <Text style={styles.typewriterText}>{message}</Text>
        </View>

        <View style={styles.actionContainer}>
            <TouchableOpacity style={styles.closeBtn} onPress={handleCloseApp}>
              <Text style={styles.closeBtnText}>{t('blockedApp.closingAppButton', { appName: appName || t('blockedApp.fallbackAppName') })}</Text>
            </TouchableOpacity>

            {/* Override options are only available in Coach mode.
                In Strict/Hard block mode there is NO way to override. */}
            {!isStrict ? (
              <>
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
                  <BrainCircuit color={ACCENT} size={20} style={{ marginRight: 8 }} />
                  <Text style={styles.temptedBtnText}>{t('blockedApp.temptedButton')}</Text>
                </TouchableOpacity>

                <Text style={styles.orText}>{t('blockedApp.orOverrideText')}</Text>

                <View style={styles.grantRow}>
                  <TouchableOpacity 
                    style={[styles.grantBtn, grantCountdown > 0 && { opacity: 0.5 }]} 
                    onPress={() => handleGrantAllowance(2)}
                    disabled={grantCountdown > 0}
                  >
                    <Text style={styles.grantBtnText}>{grantCountdown > 0 ? t('blockedApp.waitSeconds', { count: grantCountdown }) : t('blockedApp.min2Button')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.grantBtn, grantCountdown > 0 && { opacity: 0.5 }]} 
                    onPress={() => handleGrantAllowance(5)}
                    disabled={grantCountdown > 0}
                  >
                    <Text style={styles.grantBtnText}>{grantCountdown > 0 ? t('blockedApp.waitSeconds', { count: grantCountdown }) : t('blockedApp.min5Button')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.grantBtn, grantCountdown > 0 && { opacity: 0.5 }]} 
                    onPress={() => handleGrantAllowance(10)}
                    disabled={grantCountdown > 0}
                  >
                    <Text style={styles.grantBtnText}>{grantCountdown > 0 ? t('blockedApp.waitSeconds', { count: grantCountdown }) : t('blockedApp.min10Button')}</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <Text style={styles.strictNote}>
                {t('blockedApp.strictNoteText')}
              </Text>
            )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (ACCENT, ON_ACCENT) => StyleSheet.create({
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
    borderColor: ACCENT, // ring around it
  },
  gifImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  messageContainer: {
    width: '100%',
    minHeight: 120, // Shrunk from 180
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 24,
    padding: 20, // Shrunk from 24
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    marginBottom: 24, // Shrunk from 32
  },
  typewriterText: {
    color: '#ffffff',
    fontSize: 18, // Shrunk from 22
    lineHeight: 28, // Shrunk from 34
    fontWeight: '600',
  },
  cursor: {
    color: ACCENT,
    fontWeight: 'bold',
  },
  actionContainer: {
    width: '100%',
    gap: 16,
  },
  closeBtn: {
    backgroundColor: ACCENT,
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: 'center',
    width: '100%',
  },
  closeBtnText: {
    color: ON_ACCENT,
    fontSize: 18,
    fontWeight: '800',
  },
  temptedBtn: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  temptedBtnText: {
    color: ACCENT,
    fontSize: 16,
    fontWeight: '700',
  },
  orText: {
    color: '#52525b',
    fontSize: 13,
    textAlign: 'center',
    marginVertical: 4,
  },
  strictNote: {
    color: '#52525b',
    fontSize: 13,
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: 4,
    lineHeight: 19,
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
