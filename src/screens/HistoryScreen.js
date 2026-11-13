import {
    AlignLeft,
    Calendar,
    CheckCircle2,
    History,
    ListTree,
    Menu,
    RotateCcw,
    Search,
    Star,
    Trash2
} from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ActivityIndicator,
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    useColorScheme,
    View
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassSidebar } from '../components/GlassSidebar';
import { clearCompletedTasks, getCurrentUserId, loadProfile, loadTasks, toggleTaskCompletion } from '../lib/dataManager';
import { supabase } from '../lib/supabase';
import { Gamification } from '../utils/gamification';

const THEME_COLOR = '#FFFFFF';

export const HistoryScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();

  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const init = async () => {
      const resolvedUserId = await getCurrentUserId();
      if (!resolvedUserId) return;
      setUserId(resolvedUserId);
      
      const [cachedProfile, cachedTasks] = await Promise.all([
        loadProfile(resolvedUserId, setProfile),
        loadTasks(resolvedUserId, (fresh) => {
          setTasks(Array.isArray(fresh) ? fresh : []);
          setLoading(false);
        })
      ]);

      if (cachedProfile) setProfile(cachedProfile);
      if (Array.isArray(cachedTasks)) {
        setTasks(cachedTasks);
        setLoading(false);
      }
    };
    init();
  }, []);

  const handleRestoreTask = async (task) => {
    const updated = await toggleTaskCompletion(userId, tasks, task.id, true);
    setTasks(updated);

    // Restoring a task un-completes it, so the XP granted for completing it must
    // come back out. Without this, completing and restoring in a loop minted
    // unlimited XP — `toggleTaskCompletion` only moves completion state and
    // never touches gamification.
    //
    // Deduct the EXACT amount that was awarded (stored on the task at
    // completion time), not a recomputed value: if the task's priority changed
    // in between, recomputing would refund the wrong figure and drift the total.
    if (!userId) return;
    const awarded = task?.xp_awarded != null
      ? Number(task.xp_awarded)
      : Gamification.xpForTask(task);
    if (Number.isFinite(awarded) && awarded > 0) {
      // addXP clamps at zero, decrements today's task count, emits the XP toast,
      // and queues the daily-rollup delta, so the leaderboard follows too.
      await Gamification.addXP(userId, -awarded);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigation.reset({ index: 0, routes: [{ name: 'Onboarding' }] });
  };

  const handleClearHistory = () => {
    Alert.alert(t('history.clearHistoryTitle'), t('history.clearHistoryMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('history.deleteButton'), style: 'destructive', onPress: async () => {
        setTasks((current) => current.filter((task) => !task.is_completed));
        const updated = await clearCompletedTasks(userId, tasks);
        setTasks(updated);
      }}
    ]);
  };

  // ─── Timeline Grouping Logic ─────────────────────────────
  const groupedTasks = useMemo(() => {
    if (!tasks) return [];
    
    // 1. Filter only completed tasks
    let completed = tasks.filter(t => t.is_completed);
    
    // 2. Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      completed = completed.filter(t => 
        (t.title && t.title.toLowerCase().includes(q)) || 
        (t.notes && t.notes.toLowerCase().includes(q))
      );
    }

    // 3. Sort by completed_at descending (newest first)
    completed.sort((a, b) => {
      const dateA = a.completed_at ? new Date(a.completed_at) : new Date(0);
      const dateB = b.completed_at ? new Date(b.completed_at) : new Date(0);
      return dateB - dateA;
    });

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const groups = {
      today: { title: t('history.groupToday'), data: [] },
      yesterday: { title: t('history.groupYesterday'), data: [] },
      lastWeek: { title: t('history.groupLastWeek'), data: [] },
      thisMonth: { title: t('history.groupThisMonth'), data: [] },
      older: { title: t('history.groupOlder'), data: [] }
    };

    completed.forEach(task => {
      const cDate = task.completed_at ? new Date(task.completed_at) : new Date(task.created_at);
      const startOfDay = new Date(cDate.getFullYear(), cDate.getMonth(), cDate.getDate());

      if (startOfDay.getTime() === today.getTime()) {
        groups.today.data.push(task);
      } else if (startOfDay.getTime() === yesterday.getTime()) {
        groups.yesterday.data.push(task);
      } else if (startOfDay >= lastWeek) {
        groups.lastWeek.data.push(task);
      } else if (startOfDay >= thisMonth) {
        groups.thisMonth.data.push(task);
      } else {
        groups.older.data.push(task);
      }
    });

    return [
      groups.today,
      groups.yesterday,
      groups.lastWeek,
      groups.thisMonth,
      groups.older
    ].filter(g => g.data.length > 0);
  }, [tasks, searchQuery, t]);

  const renderTask = (task) => {
    const hasSubtasks = task.subtasks && task.subtasks.length > 0;
    const completedSubtasks = hasSubtasks ? task.subtasks.filter(s => s.is_completed).length : 0;
    const isOverdue = task.due_date && new Date(task.due_date) < new Date(new Date().setHours(0,0,0,0));

    return (
      <View key={task.id} style={styles.taskCard}>
        <TouchableOpacity 
          style={styles.checkboxContainer} 
          onPress={() => handleRestoreTask(task)}
          activeOpacity={0.6}
        >
          <CheckCircle2 color="#34D399" size={24} />
          <View style={styles.restoreIconContainer}>
            <RotateCcw color="#000" size={12} />
          </View>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.taskContent}
          onPress={() => navigation.navigate('TaskDetail', { task })}
          activeOpacity={0.7}
        >
          <Text style={styles.taskTitle}>{task.title}</Text>
          
          <View style={styles.metaContainer}>
            {task.is_important && (
              <View style={styles.metaPill}>
                <Star size={12} color={THEME_COLOR} />
              </View>
            )}
            {task.due_date && (
              <View style={styles.metaPill}>
                <Calendar size={12} color={isOverdue ? '#FB7185' : '#888'} />
                <Text style={[styles.metaText, isOverdue && { color: '#FB7185' }]}>
                  {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </Text>
              </View>
            )}
            {hasSubtasks && (
              <View style={styles.metaPill}>
                <ListTree size={12} color="#888" />
                <Text style={styles.metaText}>{completedSubtasks}/{task.subtasks.length}</Text>
              </View>
            )}
            {task.notes && (
              <View style={styles.metaPill}>
                <AlignLeft size={12} color="#888" />
              </View>
            )}
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <GlassSidebar 
        isOpen={isSidebarOpen} 
        onClose={() => setIsSidebarOpen(false)} 
        profile={profile} 
        navigation={navigation}
        currentRoute="History"
        handleLogout={handleLogout}
      />
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setIsSidebarOpen(true)} style={styles.iconBtn}>
            <Menu color={THEME_COLOR} size={26} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('history.headerTitle')}</Text>
          <TouchableOpacity onPress={handleClearHistory} style={styles.iconBtn}>
            <Trash2 color="#FB7185" size={24} />
          </TouchableOpacity>
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <View style={styles.searchBox}>
            <Search color="#666" size={20} />
            <TextInput 
              style={styles.searchInput}
              placeholder={t('history.searchPlaceholder')}
              placeholderTextColor="#666"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCorrect={false}
            />
          </View>
        </View>

        {/* Spin only with nothing cached to show; otherwise cached history
            paints immediately instead of flashing a spinner on every visit. */}
        {loading && tasks.length === 0 ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={THEME_COLOR} />
          </View>
        ) : groupedTasks.length === 0 ? (
          <View style={styles.centerContainer}>
            <History color="#333" size={64} style={{ marginBottom: 16 }} />
            <Text style={styles.emptyText}>
              {searchQuery ? t('history.emptyNoMatch') : t('history.emptyNoHistory')}
            </Text>
          </View>
        ) : (
          <ScrollView 
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {groupedTasks.map((group) => (
              <View key={group.title} style={styles.groupContainer}>
                <View style={styles.groupHeader}>
                  <Text style={styles.groupTitle}>{group.title}</Text>
                  <View style={styles.groupBadge}>
                    <Text style={styles.groupBadgeText}>{group.data.length}</Text>
                  </View>
                </View>
                {group.data.map(renderTask)}
              </View>
            ))}
            <View style={{ height: 80 }} />
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  iconBtn: { padding: 8, marginLeft: -8 },
  headerTitle: { color: THEME_COLOR, fontSize: 18, fontWeight: '700', letterSpacing: 0.5 },
  
  searchContainer: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161618',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 48,
    borderWidth: 1,
    borderColor: '#2A2A2C',
  },
  searchInput: {
    flex: 1,
    color: '#FFF',
    fontSize: 16,
    marginLeft: 10,
  },

  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
  },

  scrollContent: {
    paddingHorizontal: 20,
  },
  
  groupContainer: {
    marginBottom: 32,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  groupTitle: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
  groupBadge: {
    backgroundColor: '#1C1C1E',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginLeft: 8,
  },
  groupBadgeText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '700',
  },

  taskCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#000000',
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1C1C1E',
  },
  checkboxContainer: {
    position: 'relative',
    marginRight: 14,
    marginTop: 2,
  },
  restoreIconContainer: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    backgroundColor: '#34D399',
    borderRadius: 10,
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#000',
  },
  taskContent: {
    flex: 1,
  },
  taskTitle: {
    color: '#888', // Grayed out since it's completed
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 6,
    textDecorationLine: 'line-through',
  },
  metaContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1C',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 6,
  },
  metaText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '500',
  },
});
