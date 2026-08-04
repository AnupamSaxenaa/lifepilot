import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Switch, Modal, TextInput, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus, ArrowLeft, Trash2, Check, MoonStar, Clock } from 'lucide-react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { supabase } from '../lib/supabase';
import { loadAlarms, addAlarm, updateAlarm, deleteAlarm } from '../lib/dataManager';
import { Storage } from '../utils/storage';
import * as IntentLauncher from 'expo-intent-launcher';
import notifee from '@notifee/react-native';
import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { syncAlarmsToNotifications } from '../utils/AlarmManager';

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export const AlarmListScreen = ({ navigation }) => {
  const [userId, setUserId] = useState(null);
  const [alarms, setAlarms] = useState([]);
  const [sortOrder, setSortOrder] = useState('time'); // 'time', 'active'

  
  const [isModalVisible, setModalVisible] = useState(false);
  const [editingAlarm, setEditingAlarm] = useState(null);
  
  // Modal State
  const [selectedTime, setSelectedTime] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [selectedDays, setSelectedDays] = useState([false, false, false, false, false, false, false]);
  const [title, setTitle] = useState('Alarm');
  const [vibrate, setVibrate] = useState(true);
  const [soundUri, setSoundUri] = useState('default');
  const [soundName, setSoundName] = useState('Default Radar');

  // User Settings
  const [use24HourFormat, setUse24HourFormat] = useState(false);

  // Empty State Animation
  const [snoozeAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(snoozeAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(snoozeAnim, { toValue: 0, duration: 2000, useNativeDriver: true })
      ])
    ).start();
  }, []);

  useEffect(() => {
    const init = async () => {
      const formatSetting = await Storage.get('time_format_24');
      if (formatSetting === 'true') setUse24HourFormat(true);

      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        setUserId(session.user.id);
        const fetchedAlarms = await loadAlarms(session.user.id, setAlarms);
        setAlarms(fetchedAlarms);
      }
    };
    init();
  }, []);

  useEffect(() => {
    const checkPermissions = async () => {
      if (Platform.OS === 'android') {
        const settings = await notifee.getNotificationSettings();
        if (settings.android?.canUseFullScreenIntent === false) {
          try {
            await IntentLauncher.startActivityAsync(
              IntentLauncher.ActivityAction.MANAGE_APP_USE_FULL_SCREEN_INTENT
            );
          } catch (e) {
            console.log('IntentLauncher error:', e);
          }
        }
      }
    };
    checkPermissions();
  }, []);

  const toggleTimeFormat = async () => {
    const newFormat = !use24HourFormat;
    setUse24HourFormat(newFormat);
    await Storage.set('time_format_24', newFormat ? 'true' : 'false');
  };

  useEffect(() => {
    if (alarms && alarms.length >= 0) {
      syncAlarmsToNotifications(alarms);
    }
  }, [alarms]);

  const sortedAlarms = [...alarms].sort((a, b) => {
    if (sortOrder === 'time') {
      return a.time.localeCompare(b.time);
    } else if (sortOrder === 'active') {
      return (b.is_active === a.is_active) ? a.time.localeCompare(b.time) : (b.is_active ? 1 : -1);
    }
    return 0;
  });


  const handleSave = async () => {
    if (!userId) return;
    
    const h = selectedTime.getHours().toString().padStart(2, '0');
    const m = selectedTime.getMinutes().toString().padStart(2, '0');
    const timeStr = `${h}:${m}`;
    
    if (editingAlarm) {
      const updated = await updateAlarm(userId, alarms, editingAlarm.id, {
        time: timeStr,
        title,
        days_of_week: selectedDays,
        vibrate,
        sound_uri: soundUri,
        sound_name: soundName,
        is_active: true
      });
      setAlarms(updated);
    } else {
      const updated = await addAlarm(userId, alarms, {
        time: timeStr,
        title,
        days_of_week: selectedDays,
        vibrate,
        sound_uri: soundUri,
        sound_name: soundName,
        sound: true,
        is_active: true
      });
      setAlarms(updated);
    }
    setModalVisible(false);
  };

  const handleDelete = async () => {
    if (!editingAlarm || !userId) return;
    const updated = await deleteAlarm(userId, alarms, editingAlarm.id);
    setAlarms(updated);
    setModalVisible(false);
  };

  const openNewAlarmModal = () => {
    setEditingAlarm(null);
    const d = new Date();
    d.setHours(6, 0, 0, 0); // Default to 06:00 AM
    setSelectedTime(d);
    setSelectedDays([false, false, false, false, false, false, false]);
    setTitle('Alarm');
    setVibrate(true);
    setSoundUri('default');
    setSoundName('Default Radar');
    setModalVisible(true);
  };

  const openEditAlarmModal = (alarm) => {
    setEditingAlarm(alarm);
    
    const [hours, minutes] = alarm.time.split(':');
    const d = new Date();
    d.setHours(parseInt(hours, 10));
    d.setMinutes(parseInt(minutes, 10));
    
    setSelectedTime(d);
    setSelectedDays(alarm.days_of_week || [false, false, false, false, false, false, false]);
    setTitle(alarm.title || 'Alarm');
    setVibrate(alarm.vibrate ?? true);
    setSoundUri(alarm.sound_uri || 'default');
    setSoundName(alarm.sound_name || 'Default Radar');
    setModalVisible(true);
  };

  const toggleAlarmActive = async (alarmId, currentActive) => {
    if (!userId) return;
    // Optimistic UI
    setAlarms(prev => prev.map(a => a.id === alarmId ? { ...a, is_active: !currentActive } : a));
    // Save to DB
    const updated = await updateAlarm(userId, alarms, alarmId, { is_active: !currentActive });
    setAlarms(updated);
  };

  const formatTimeDisplay = (time24) => {
    if (!time24) return '';
    const [hStr, mStr] = time24.split(':');
    let h = parseInt(hStr, 10);
    const m = mStr ? mStr.padStart(2, '0') : '00';
    
    if (use24HourFormat) {
      return `${h.toString().padStart(2, '0')}:${m}`;
    } else {
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12;
      if (h === 0) h = 12;
      return `${h}:${m} ${ampm}`;
    }
  };

  const pickCustomSound = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setSoundUri(result.assets[0].uri);
        setSoundName(result.assets[0].name);
      }
    } catch (error) {
      console.log('Error picking audio:', error);
    }
  };

  const renderAlarmCard = ({ item }) => {
    const activeDaysText = item.days_of_week && item.days_of_week.some(d => d) 
      ? DAYS.filter((_, i) => item.days_of_week[i]).join(', ')
      : 'Not scheduled';

    return (
      <TouchableOpacity 
        style={[styles.card, !item.is_active && styles.cardInactive]}
        activeOpacity={0.8}
        onPress={() => openEditAlarmModal(item)}
      >
        <View style={styles.cardHeader}>
          <Text style={[styles.daysText, !item.is_active && styles.textInactive]}>
            {activeDaysText} {item.title && ` • ${item.title}`}
          </Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={[styles.timeText, !item.is_active && styles.textInactive]}>
            {formatTimeDisplay(item.time)}
          </Text>
          <Switch 
            value={item.is_active} 
            onValueChange={() => toggleAlarmActive(item.id, item.is_active)}
            trackColor={{ false: '#333', true: '#A78BFA' }}
            thumbColor="#FFF"
          />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft color="#FFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Alarms</Text>
        
        <TouchableOpacity onPress={toggleTimeFormat} style={styles.formatToggle}>
          <Text style={styles.formatToggleText}>{use24HourFormat ? '24H' : '12H'}</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          onPress={() => setSortOrder(prev => prev === 'time' ? 'active' : 'time')} 
          style={[styles.formatToggle, { marginLeft: 8 }]}
        >
          <Text style={styles.formatToggleText}>Sort: {sortOrder === 'time' ? 'Time' : 'Active'}</Text>
        </TouchableOpacity>

      </View>

      {alarms.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Animated.View style={{ 
            transform: [{ 
              translateY: snoozeAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -15] }) 
            }] 
          }}>
            <MoonStar color="#3F3F46" size={64} />
          </Animated.View>
          <Text style={styles.emptyText}>No alarms at this moment</Text>
        </View>
      ) : (
        <FlatList
          data={sortedAlarms}
          keyExtractor={item => item.id}
          renderItem={renderAlarmCard}

          contentContainerStyle={styles.listContainer}
          showsVerticalScrollIndicator={false}
        />
      )}

      <TouchableOpacity style={styles.fab} onPress={openNewAlarmModal} activeOpacity={0.8}>
        <Plus color="#FFF" size={32} />
      </TouchableOpacity>

      {/* Edit/Create Modal */}
      <Modal visible={isModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalVisible(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setModalVisible(false)} style={{ paddingVertical: 10 }}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSave} style={{ paddingVertical: 10 }}>
              <Text style={styles.modalSave}>Schedule Alarm</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity 
            style={styles.timeDisplayBtn} 
            onPress={() => setShowPicker(true)}
          >
            <Text style={styles.timeDisplayTxt}>
              {formatTimeDisplay(`${selectedTime.getHours()}:${selectedTime.getMinutes()}`)}
            </Text>
          </TouchableOpacity>

          {showPicker && (
            <DateTimePicker
              value={selectedTime}
              mode="time"
              is24Hour={use24HourFormat}
              onChange={(e, date) => {
                setShowPicker(false);
                if (e.type === 'set' && date) {
                  setSelectedTime(date);
                }
              }}
              textColor="#FFF"
            />
          )}

          <View style={styles.daysRow}>
            {DAYS.map((day, i) => (
              <TouchableOpacity 
                key={i} 
                style={[styles.dayCircle, selectedDays[i] && styles.dayCircleActive]}
                onPress={() => {
                  const newDays = [...selectedDays];
                  newDays[i] = !newDays[i];
                  setSelectedDays(newDays);
                }}
              >
                <Text style={[styles.dayText, selectedDays[i] && styles.dayTextActive]}>{day}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.settingsGroup}>
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Alarm name</Text>
              <TextInput 
                style={styles.settingInput} 
                value={title} 
                onChangeText={setTitle} 
                placeholder="Alarm" 
                placeholderTextColor="#666" 
                maxLength={20}
              />
            </View>
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Sound</Text>
              <TouchableOpacity onPress={pickCustomSound}>
                <Text style={styles.settingInput} numberOfLines={1} ellipsizeMode="middle">
                  {soundName.length > 15 ? soundName.substring(0,15) + '...' : soundName}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Vibrate</Text>
              <Switch 
                value={vibrate} 
                onValueChange={setVibrate}
                trackColor={{ false: '#333', true: '#A78BFA' }}
                thumbColor="#FFF"
              />
            </View>
          </View>

          {editingAlarm && (
            <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
              <Trash2 color="#FF453A" size={20} />
              <Text style={styles.deleteText}>Delete</Text>
            </TouchableOpacity>
          )}

        </SafeAreaView>
      </Modal>

    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090B' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  backBtn: { padding: 8, marginLeft: -8 },
  headerTitle: { fontSize: 24, fontWeight: '600', color: '#FFF' },
  formatToggle: { backgroundColor: '#27272A', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  formatToggleText: { color: '#A78BFA', fontWeight: '600', fontSize: 12 },
  listContainer: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 100 },
  card: { backgroundColor: '#18181B', borderRadius: 24, padding: 20, marginBottom: 16 },
  cardInactive: { opacity: 0.6 },
  cardHeader: { marginBottom: 12 },
  daysText: { color: '#A1A1AA', fontSize: 14, fontWeight: '500' },
  cardBody: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  timeText: { fontSize: 48, fontWeight: '300', color: '#FFF' },
  textInactive: { color: '#71717A' },
  fab: { position: 'absolute', bottom: 32, alignSelf: 'center', backgroundColor: '#3F3F46', width: 64, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5 },
  
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 100 },
  emptyText: { color: '#71717A', fontSize: 18, marginTop: 20, fontWeight: '500' },

  modalContainer: { flex: 1, backgroundColor: '#09090B', paddingHorizontal: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 20 },
  modalCancel: { color: '#A1A1AA', fontSize: 18 },
  modalSave: { color: '#A78BFA', fontSize: 18, fontWeight: '600' },
  
  timeDisplayBtn: { alignSelf: 'center', marginVertical: 40 },
  timeDisplayTxt: { fontSize: 72, fontWeight: '300', color: '#FFF' },
  
  daysRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 30 },
  dayCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#18181B', justifyContent: 'center', alignItems: 'center' },
  dayCircleActive: { backgroundColor: '#A78BFA' },
  dayText: { color: '#FFF', fontSize: 16, fontWeight: '500' },
  dayTextActive: { color: '#000', fontWeight: '700' },
  
  settingsGroup: { backgroundColor: '#18181B', borderRadius: 16, padding: 16, marginTop: 20 },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  settingLabel: { color: '#FFF', fontSize: 16 },
  settingInput: { color: '#A78BFA', fontSize: 16, textAlign: 'right', minWidth: 100 },
  
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 40, padding: 16, backgroundColor: 'rgba(255, 69, 58, 0.1)', borderRadius: 16 },
  deleteText: { color: '#FF453A', fontSize: 16, fontWeight: '600' }
});
