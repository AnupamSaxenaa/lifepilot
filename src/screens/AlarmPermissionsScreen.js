/**
 * LifePilot — Alarm Permissions & Reliability
 * ------------------------------------------------------------------
 * A dedicated overview of everything that affects whether alarms fire
 * reliably: notifications, full-screen intent, and battery optimization.
 * Each row shows current status and a one-tap fix, backed by
 * `reliabilityCheck()` (see features/alarm/scheduler/reliabilityCheck.js).
 */
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, BatteryLow, BatteryWarning, BellRing, CheckCircle2, MonitorSmartphone } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
    openDndAccessSettings,
    openExactAlarmSettings,
    openFullScreenIntentSettings,
    reliabilityCheck,
    requestBatteryExemption,
    requestNotificationPermission
} from '../features/alarm/scheduler/reliabilityCheck';

export const AlarmPermissionsScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const [status, setStatus] = useState({ notifications: null, fullScreenIntent: null, exactAlarm: null, batteryOptimized: null, issues: [] });

  const refresh = useCallback(async () => {
    const res = await reliabilityCheck();
    setStatus(res);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const rows = [
    {
      key: 'notifications',
      icon: BellRing,
      label: t('alarmPermissionsUi.notifications'),
      ok: status.notifications !== false,
      fix: requestNotificationPermission,
    },
    {
      key: 'fullScreenIntent',
      icon: MonitorSmartphone,
      label: t('alarmPermissionsUi.fullScreenAlarms'),
      ok: status.fullScreenIntent !== false,
      fix: openFullScreenIntentSettings,
    },
    {
      key: 'exactAlarm',
      icon: BellRing,
      label: t('alarmReliability.exact_alarm_disabled'),
      ok: status.exactAlarm !== false,
      fix: openExactAlarmSettings,
    },
    {
      key: 'batteryOptimized',
      icon: BatteryWarning,
      label: t('alarmPermissionsUi.batteryOptimization'),
      ok: status.batteryOptimized !== true,
      fix: requestBatteryExemption,
    },
    {
      key: 'lowBattery',
      icon: BatteryLow,
      label: t('alarmPermissionsUi.batteryLevel'),
      ok: status.lowBattery !== true,
      fix: async () => {}, // no direct fix — user needs to charge the device
    },
  ];

  const handleFix = async (row) => {
    await row.fix();
    setTimeout(refresh, 800);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft color="#FFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('alarmReliability.title')}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20 }}>
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <View key={row.key} style={styles.row}>
              <View style={styles.rowLeft}>
                <Icon color={row.ok ? '#34D399' : '#FBBF24'} size={22} />
                <View style={{ marginLeft: 14, flex: 1 }}>
                  <Text style={styles.rowLabel}>{row.label}</Text>
                  <Text style={[styles.rowStatus, { color: row.ok ? '#34D399' : '#FBBF24' }]}>
                    {row.ok ? t('common.ok') : t('alarmReliability.fix')}
                  </Text>
                </View>
              </View>
              {row.ok ? (
                <CheckCircle2 color="#34D399" size={20} />
              ) : row.key === 'lowBattery' ? (
                <BatteryLow color="#FBBF24" size={20} />
              ) : (
                <TouchableOpacity style={styles.fixBtn} onPress={() => handleFix(row)}>
                  <Text style={styles.fixBtnText}>{t('alarmReliability.fix')}</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}

        {status.issues.length === 0 && (
          <View style={styles.allGoodWrap}>
            <CheckCircle2 color="#34D399" size={36} />
            <Text style={styles.allGoodText}>{t('alarmPermissionsUi.allGood')}</Text>
          </View>
        )}

        {/* DND access can't be status-checked from JS (no Android API exposed
            via any installed module), so this is always offered as an action
            rather than a pass/fail row — degrades gracefully either way. */}
        <View style={styles.row}>
          <View style={styles.rowLeft}>
            <BellRing color="#FFFFFF" size={22} />
            <View style={{ marginLeft: 14, flex: 1 }}>
              <Text style={styles.rowLabel}>{t('alarmReliability.dndTitle')}</Text>
              <Text style={[styles.rowStatus, { color: '#A1A1AA', textTransform: 'none' }]}>{t('alarmReliability.dndSubtitle')}</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.fixBtn} onPress={openDndAccessSettings}>
            <Text style={styles.fixBtnText}>{t('alarmReliability.dndFix')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090B' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, gap: 12 },
  backBtn: { padding: 4 },
  headerTitle: { color: '#FFF', fontSize: 20, fontWeight: '700', flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#18181B', borderRadius: 16, padding: 16, marginBottom: 12 },
  rowLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  rowLabel: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  rowStatus: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  fixBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 14, backgroundColor: '#FBBF24' },
  fixBtnText: { color: '#000', fontWeight: '800', fontSize: 13 },
  allGoodWrap: { alignItems: 'center', paddingVertical: 40, gap: 14 },
  allGoodText: { color: '#A1A1AA', fontSize: 14, textAlign: 'center', paddingHorizontal: 30 },
});
