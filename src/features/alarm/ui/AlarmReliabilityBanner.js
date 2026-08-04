/**
 * LifePilot — AlarmReliabilityBanner
 * ------------------------------------------------------------------
 * Surfaces OS conditions that could stop alarms from firing (notifications
 * off, full-screen-intent blocked, battery optimization) and offers one-tap
 * fixes. Re-checks on mount and whenever the screen regains focus (e.g. after
 * the user returns from a system settings page). Renders nothing when all is
 * well, so it stays out of the way.
 */
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { AlertTriangle } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
    openExactAlarmSettings,
    openFullScreenIntentSettings,
    reliabilityCheck,
    requestBatteryExemption,
    requestNotificationPermission
} from '../scheduler/reliabilityCheck';

export const AlarmReliabilityBanner = () => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [issues, setIssues] = useState([]);

  const run = useCallback(async () => {
    const res = await reliabilityCheck();
    setIssues(res.issues || []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      run();
    }, [run]),
  );

  if (!issues.length) return null;

  const fixFor = async (issue) => {
    if (issue === 'notifications_disabled') await requestNotificationPermission();
    else if (issue === 'full_screen_intent_disabled') await openFullScreenIntentSettings();
    else if (issue === 'exact_alarm_disabled') await openExactAlarmSettings();
    else if (issue === 'battery_optimized') await requestBatteryExemption();
    // Re-check shortly after; focus effect will also re-run on return.
    setTimeout(run, 800);
  };

  return (
    <View style={styles.wrap}>
      <TouchableOpacity style={styles.headerRow} onPress={() => navigation.navigate('AlarmPermissions')} activeOpacity={0.7}>
        <AlertTriangle color="#FBBF24" size={16} />
        <Text style={styles.title}>{t('alarmReliability.title')}</Text>
      </TouchableOpacity>
      {issues.map((issue) => (
        <View key={issue} style={styles.issueRow}>
          <Text style={styles.issueText}>{t(`alarmReliability.${issue}`)}</Text>
          <TouchableOpacity style={styles.fixBtn} onPress={() => fixFor(issue)} activeOpacity={0.7}>
            <Text style={styles.fixTxt}>{t('alarmReliability.fix')}</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginHorizontal: 20, marginBottom: 12, padding: 14, borderRadius: 16, backgroundColor: 'rgba(251,191,36,0.08)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.25)' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  title: { color: '#FBBF24', fontSize: 14, fontWeight: '700' },
  issueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 6 },
  issueText: { color: '#D4D4D8', fontSize: 13, flex: 1, lineHeight: 18 },
  fixBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 14, backgroundColor: '#FBBF24' },
  fixTxt: { color: '#000', fontSize: 13, fontWeight: '800' },
});
