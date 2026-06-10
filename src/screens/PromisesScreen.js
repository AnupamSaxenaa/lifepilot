import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackgroundWrapper } from '../components/BackgroundWrapper';
import { GlassSidebar } from '../components/GlassSidebar';
import { Menu, Plus, Trash2 } from 'lucide-react-native';
import { Storage } from '../utils/storage';
import { supabase } from '../lib/supabase';
import { loadProfile } from '../lib/dataManager';

export const PromisesScreen = ({ navigation }) => {
  const [isEnabled, setIsEnabled] = useState(true);
  const [promises, setPromises] = useState([]);
  const [newPromise, setNewPromise] = useState('');
  const [userId, setUserId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const loadConfig = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      
      const uid = session.user.id;
      setUserId(uid);

      const cachedProfile = await loadProfile(uid, (fresh) => setProfile(fresh));
      if (cachedProfile) setProfile(cachedProfile);

      const config = await Storage.get(`promisesConfig_${uid}`);
      if (config) {
        setIsEnabled(config.enabled ?? true);
        setPromises(config.promises || []);
      } else {
        // Default promise if empty
        const defaultPromise = "I promise to respect myself and stay focused on my goals today.";
        setPromises([defaultPromise]);
        await Storage.set(`promisesConfig_${uid}`, { enabled: true, promises: [defaultPromise] });
      }
    };
    loadConfig();
  }, []);

  const saveConfig = async (enabled, list) => {
    if (!userId) return;
    await Storage.set(`promisesConfig_${userId}`, { enabled, promises: list });
  };

  const toggleSwitch = () => {
    const nextState = !isEnabled;
    setIsEnabled(nextState);
    saveConfig(nextState, promises);
  };

  const addPromise = () => {
    if (newPromise.trim().length === 0) return;
    const updated = [...promises, newPromise.trim()];
    setPromises(updated);
    saveConfig(isEnabled, updated);
    setNewPromise('');
  };

  const removePromise = (index) => {
    const updated = promises.filter((_, i) => i !== index);
    setPromises(updated);
    saveConfig(isEnabled, updated);
  };

  return (
    <BackgroundWrapper>
      <GlassSidebar 
        isOpen={isSidebarOpen} 
        onClose={() => setIsSidebarOpen(false)} 
        profile={profile} 
        navigation={navigation}
        currentRoute="Promises"
        handleLogout={() => {
          navigation.reset({ index: 0, routes: [{ name: 'Onboarding' }] });
          supabase.auth.signOut();
        }}
      />
      <View style={[styles.container, { paddingTop: Math.max(insets.top, 20) }]}>
        <View style={styles.titleContainer}>
          <TouchableOpacity onPress={() => setIsSidebarOpen(true)} style={styles.iconBtn}>
            <Menu color="#fff" size={28} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>PROMISES</Text>
        </View>

        <ScrollView contentContainerStyle={styles.scroll}>
          
          <View style={styles.toggleCard}>
            <View style={styles.toggleRow}>
              <View>
                <Text style={styles.toggleTitle}>Enable Daily Popup</Text>
                <Text style={styles.toggleSub}>Show a random promise every morning</Text>
              </View>
              <Switch
                trackColor={{ false: "#333", true: "#ffffff" }}
                thumbColor={isEnabled ? "#000" : "#888"}
                onValueChange={toggleSwitch}
                value={isEnabled}
              />
            </View>
          </View>

          <View style={styles.addSection}>
            <Text style={styles.sectionTitle}>Add New Promise</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                placeholder="I promise to..."
                placeholderTextColor="#666"
                value={newPromise}
                onChangeText={setNewPromise}
                multiline
              />
              <TouchableOpacity style={styles.addBtn} onPress={addPromise}>
                <Plus color="#000" size={24} />
              </TouchableOpacity>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Your Promises</Text>
          {promises.length === 0 && (
            <Text style={styles.emptyText}>{"You haven't added any promises yet."}</Text>
          )}
          
          {promises.map((item, index) => (
            <View key={index} style={styles.promiseCard}>
              <Text style={styles.promiseText}>{item}</Text>
              <TouchableOpacity style={styles.deleteBtn} onPress={() => removePromise(index)}>
                <Trash2 color="#ef4444" size={20} />
              </TouchableOpacity>
            </View>
          ))}
          
        </ScrollView>
      </View>
    </BackgroundWrapper>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  iconBtn: { 
    padding: 8,
    marginRight: 12,
    marginLeft: -8,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
  },
  headerTitle: {
    fontSize: 34,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.5,
  },
  scroll: {
    paddingHorizontal: 24,
    paddingBottom: 100,
  },
  toggleCard: {
    paddingVertical: 20,
    marginBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)'
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  toggleSub: {
    color: '#888',
    fontSize: 13,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  addSection: {
    marginBottom: 30,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  input: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16,
    padding: 16,
    color: '#fff',
    fontSize: 16,
    minHeight: 60,
  },
  addBtn: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  promiseCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 16,
    marginBottom: 12,
  },
  promiseText: {
    color: '#ccc',
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    marginRight: 16,
  },
  deleteBtn: {
    padding: 8,
  },
  emptyText: {
    color: '#666',
    fontStyle: 'italic',
  }
});
