import {
    AlignLeft,
    Calendar,
    CheckCircle2,
    History,
    ListTree,
    Menu,
    RotateCcw,
    Search,
    Star
} from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
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
import { loadProfile, loadTasks } from '../lib/dataManager';
import { supabase } from '../lib/supabase';
import { syncToSupabase } from '../lib/syncQueue';

const THEME_COLOR = '#FFFFFF';

export const HistoryScreen = ({ navigation }) => {
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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setUserId(session.user.id);
      
      const [cachedProfile, cachedTasks] = await Promise.all([
        loadProfile(session.user.id, setProfile),
        loadTasks(session.user.id, (fresh) => {
          setTasks(fresh);
          setLoading(false);
        })
      ]);

      if (cachedProfile) setProfile(cachedProfile);
      if (cachedTasks) {
        setTasks(cachedTasks);
        setLoading(false);
      }
    };
    init();
  }, []);

  const handleRestoreTask = async (task) => {
    // ✅ FIX: Load fresh tasks, un-complete this specific task
    const latestTasks = await Storage.get(`tasks_${userId}`) || [];
    const updated = latestTasks.map(t =>
      t.id === task.id 
        ? { ...t, is_completed: false, completed_at: null }
        : t
    );
    
    await Storage.set(`tasks_${userId}`, updated);
    await Storage.set('last_local_write_time', Date.now().toString());
    
    syncToSupabase('tasks', 'update',
      { is_completed: false, completed_at: null },
      { column: 'id', value: task.id }
    );
    
    setTasks(updated);
  };

  const handleLogout = () => {
    navigation.reset({ index: 0, routes: [{ name: 'Onboarding' }] });
    supabase.auth.signOut();
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
      today: { title: 'Today', data: [] },
      yesterday: { title: 'Yesterday', data: [] },
      lastWeek: { title: 'Previous 7 Days', data: [] },
      thisMonth: { title: 'This Month', data: [] },
      older: { title: 'Older', data: [] }
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
  }, [tasks, searchQuery]);

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
          <CheckCircle2 color="#10B981" size={24} />
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
                <Calendar size={12} color={isOverdue ? '#EF4444' : '#888'} />
                <Text style={[styles.metaText, isOverdue && { color: '#EF4444' }]}>
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
          <Text style={styles.headerTitle}>History</Text>
          <View style={{ width: 44 }} />
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <View style={styles.searchBox}>
            <Search color="#666" size={20} />
            <TextInput 
              style={styles.searchInput}
              placeholder="Search history..."
              placeholderTextColor="#666"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCorrect={false}
            />
          </View>
        </View>

        {loading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={THEME_COLOR} />
          </View>
        ) : groupedTasks.length === 0 ? (
          <View style={styles.centerContainer}>
            <History color="#333" size={64} style={{ marginBottom: 16 }} />
            <Text style={styles.emptyText}>
              {searchQuery ? "No matching history found." : "Your history is empty."}
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
    backgroundColor: '#10B981',
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
