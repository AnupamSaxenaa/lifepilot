import { Bell, Calendar, CheckCircle2, Circle, FileText, GripVertical, ListChecks, Menu, MoreVertical, Plus, Repeat, Star, Trash2, X } from 'lucide-react-native';
import { useEffect, useRef, useState, useMemo } from 'react';
import { Share, StyleSheet, Text, TouchableOpacity, useColorScheme, View } from 'react-native';
import { NestableDraggableFlatList, NestableScrollContainer, ScaleDecorator } from 'react-native-draggable-flatlist';
import Animated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackgroundWrapper } from '../components/BackgroundWrapper';
import { GlassSidebar } from '../components/GlassSidebar';
import { ScribbleStrike } from '../components/ScribbleStrike';
import { loadProfile, loadTasks, reorderTasks, toggleTaskImportance } from '../lib/dataManager';
import { supabase } from '../lib/supabase';
import { syncToSupabase } from '../lib/syncQueue';
import { COLORS } from '../theme/theme';
import { Gamification } from '../utils/gamification';
import { Storage } from '../utils/storage';

const THEME_COLOR = '#FFFFFF';

const SkeletonTask = () => {
  const opacity = useSharedValue(0.3);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.7, { duration: 800, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[styles.taskCard, style, { backgroundColor: '#1A1A1A', borderColor: '#333' }]}>
      <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#333', marginRight: 12 }} />
      <View style={{ flex: 1, paddingRight: 8 }}>
        <View style={{ width: '60%', height: 16, borderRadius: 4, backgroundColor: '#333', marginBottom: 8 }} />
        <View style={{ width: '40%', height: 12, borderRadius: 4, backgroundColor: '#333' }} />
      </View>
    </Animated.View>
  );
};

export const StarredScreen = ({ navigation }) => {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? COLORS.dark : COLORS.light;
  const insets = useSafeAreaInsets();

  const [tasks, setTasks] = useState([]);
  const latestTasksRef = useRef([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [showMenu, setShowMenu] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [sortBy, setSortBy] = useState('custom'); // custom by default for drag & drop
  const [isSortLoaded, setIsSortLoaded] = useState(false);
  const [isCacheLoaded, setIsCacheLoaded] = useState(false);
  const [completingTaskIds, setCompletingTaskIds] = useState([]);

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setUserId(session.user.id);
      
      const [cachedProfile, cachedSort, cachedTasks] = await Promise.all([
        loadProfile(session.user.id, (fresh) => setProfile(fresh)),
        Storage.get('sortBy_starred'),
        loadTasks(session.user.id, (fresh) => {
          setTasks(fresh.filter(t => t.is_important));
          setLoading(false);
          setIsCacheLoaded(true);
        })
      ]);

      if (cachedProfile) setProfile(cachedProfile);
      if (cachedSort) setSortBy(cachedSort);
      setIsSortLoaded(true);
      
      if (cachedTasks) {
        setTasks(cachedTasks.filter(t => t.is_important));
        setLoading(false);
        setIsCacheLoaded(true);
      }
    };
    init();
  }, []);

  useEffect(() => {
    latestTasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    if (isSortLoaded) {
      Storage.set('sortBy_starred', sortBy);
    }
  }, [sortBy, isSortLoaded]);

  const toggleTask = async (taskId, currentStatus) => {
    if (!currentStatus) {
      // Completing task - show animation
      setCompletingTaskIds(prev => [...prev, taskId]);
      
      setTimeout(async () => {
        const completedAt = new Date().toISOString();
        const updated = tasks.map(t => 
          t.id === taskId ? { ...t, is_completed: true, completed_at: completedAt } : t
        );
        setTasks(updated);
        setCompletingTaskIds(prev => prev.filter(id => id !== taskId));
        
        if (userId) {
          // ✅ FIX: Load fresh tasks RIGHT NOW, not relying on stale closure
          const latestTasks = await Storage.get(`tasks_${userId}`) || [];
          const updatedAll = latestTasks.map(t =>
            t.id === taskId ? { ...t, is_completed: true, completed_at: completedAt } : t
          );
          
          await Storage.set(`tasks_${userId}`, updatedAll);
          await Storage.set('last_local_write_time', Date.now().toString());
          
          syncToSupabase('tasks', 'update',
            { is_completed: true, completed_at: completedAt },
            { column: 'id', value: taskId }
          );
          
          await Gamification.addXP(userId, 25);
        }
      }, 600);
    } else {
      // Un-completing task - instant
      const updated = tasks.map(t => 
        t.id === taskId ? { ...t, is_completed: false, completed_at: null } : t
      );
      setTasks(updated);
      
      if (userId) {
        // ✅ FIX: Load fresh tasks
        const latestTasks = await Storage.get(`tasks_${userId}`) || [];
        const updatedAll = latestTasks.map(t =>
          t.id === taskId ? { ...t, is_completed: false, completed_at: null } : t
        );
        
        await Storage.set(`tasks_${userId}`, updatedAll);
        await Storage.set('last_local_write_time', Date.now().toString());
        
        syncToSupabase('tasks', 'update',
          { is_completed: false, completed_at: null },
          { column: 'id', value: taskId }
        );
        
        await Gamification.addXP(userId, -25);
      }
    }
  };

  const toggleImportant = async (taskId, currentImportant) => {
    const updated = tasks.filter(t => t.id !== taskId);
    setTasks(updated);

    if (userId) {
      const allTasks = await Storage.get(`tasks_${userId}`);
      if (allTasks) {
        await toggleTaskImportance(userId, allTasks, taskId, currentImportant);
      }
    }
  };

  const deleteTaskHandler = async (taskId) => {
    const updated = tasks.filter(t => t.id !== taskId);
    setTasks(updated);
    
    if (userId) {
      const allTasks = await Storage.get(`tasks_${userId}`);
      if (allTasks) {
        const fullTasks = allTasks.filter(t => t.id !== taskId);
        await Storage.set(`tasks_${userId}`, fullTasks);
      }
    }
  };

  const shareList = async () => {
    setShowMenu(false);
    if (tasks.length === 0) return;
    
    const textList = getSortedTasks().map((t, i) => {
      let line = `${i + 1}. [${t.is_completed ? 'x' : ' '}] ${t.title}`;
      const extras = [];
      if (t.due_date) extras.push(`Due: ${new Date(t.due_date).toLocaleDateString()}`);
      if (t.reminder_time) extras.push(`Reminder: ${new Date(t.reminder_time).toLocaleTimeString()}`);
      if (extras.length > 0) line += ` (${extras.join(' | ')})`;
      return line;
    }).join('\n');
    
    const message = `★ My Starred Tasks:\n\n${textList}`;
    
    try {
      await Share.share({ message });
    } catch (error) {
      console.log('Error sharing:', error);
    }
  };

  const getSortedTasks = () => {
    const active = tasks.filter(t => !t.is_completed || completingTaskIds.includes(t.id));
    const done   = tasks.filter(t => t.is_completed && !completingTaskIds.includes(t.id));

    const sortGroup = (arr) => {
      const s = [...arr];
      switch (sortBy) {
        case 'due_date':
          s.sort((a, b) => {
            if (!a.due_date && !b.due_date) return 0;
            if (!a.due_date) return 1;
            if (!b.due_date) return -1;
            return new Date(a.due_date) - new Date(b.due_date);
          });
          break;
        case 'today':
          const todayStr = new Date().toDateString();
          s.sort((a, b) => {
            const aToday = (a.due_date && new Date(a.due_date).toDateString() === todayStr) ? 1 : 0;
            const bToday = (b.due_date && new Date(b.due_date).toDateString() === todayStr) ? 1 : 0;
            return bToday - aToday;
          });
          break;
        case 'alphabetical':
          s.sort((a, b) => a.title.localeCompare(b.title));
          break;
        case 'creation':
          s.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          break;
        case 'custom':
        default:
          s.sort((a, b) => {
            const indexA = a.starred_order_index ?? Infinity;
            const indexB = b.starred_order_index ?? Infinity;
            return indexA - indexB || new Date(b.created_at) - new Date(a.created_at);
          });
          break;
      }
      return s;
    };

    return [...sortGroup(active), ...sortGroup(done)];
  };

  // ⚡ PERFORMANCE: Memoize expensive sorting
  const getSortedActiveTasks = useMemo(() => {
    const active = tasks.filter(t => !t.is_completed || completingTaskIds.includes(t.id));
    const sortGroup = (arr) => {
      const s = [...arr];
      switch (sortBy) {
        case 'due_date':
          s.sort((a, b) => {
            if (!a.due_date && !b.due_date) return 0;
            if (!a.due_date) return 1;
            if (!b.due_date) return -1;
            return new Date(a.due_date) - new Date(b.due_date);
          });
          break;
        case 'today':
          const todayStr = new Date().toDateString();
          s.sort((a, b) => {
            const aToday = (a.due_date && new Date(a.due_date).toDateString() === todayStr) ? 1 : 0;
            const bToday = (b.due_date && new Date(b.due_date).toDateString() === todayStr) ? 1 : 0;
            return bToday - aToday;
          });
          break;
        case 'alphabetical':
          s.sort((a, b) => a.title.localeCompare(b.title));
          break;
        case 'creation':
          s.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          break;
        case 'custom':
        default:
          s.sort((a, b) => {
            const indexA = a.starred_order_index ?? Infinity;
            const indexB = b.starred_order_index ?? Infinity;
            return indexA - indexB || new Date(b.created_at) - new Date(a.created_at);
          });
          break;
      }
      return s;
    };
    return sortGroup(active);
  }, [tasks, sortBy, completingTaskIds]);

  const sortedActiveTasks = getSortedActiveTasks;
  const completedTasks = useMemo(() => 
    tasks.filter(t => t.is_completed && !completingTaskIds.includes(t.id)),
    [tasks, completingTaskIds]
  );

  const SORT_LABELS = {
    creation: 'Creation Date',
    due_date: 'By due date',
    today: 'Added to Today',
    alphabetical: 'A–Z',
    custom: null,
  };

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    
    return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    if (date.toDateString() === today.toDateString()) return `Today ${timeStr}`;
    if (date.toDateString() === tomorrow.toDateString()) return `Tomorrow ${timeStr}`;
    return `${date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ${timeStr}`;
  };

  return (
    <BackgroundWrapper>
      <GlassSidebar 
        isOpen={isSidebarOpen} 
        onClose={() => setIsSidebarOpen(false)} 
        profile={profile} 
        navigation={navigation}
        currentRoute="Starred"
        handleLogout={() => {
          navigation.reset({ index: 0, routes: [{ name: 'Onboarding' }] });
          supabase.auth.signOut();
        }}
      />
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setIsSidebarOpen(true)} style={styles.iconBtn}>
            <Menu color={THEME_COLOR} size={26} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowMenu(true)} style={styles.iconBtn}>
            <MoreVertical color={THEME_COLOR} size={26} />
          </TouchableOpacity>
        </View>

        {/* Title + active sort badge */}
        <View style={styles.titleContainer}>
          <Text style={styles.headerTitle}>STARRED</Text>
          <View style={styles.titleRow}>
            {SORT_LABELS[sortBy] && (
              <View style={styles.sortBadge}>
                <Text style={styles.sortBadgeText}>{SORT_LABELS[sortBy]}</Text>
                <TouchableOpacity onPress={() => setSortBy('custom')} style={{ marginLeft: 4 }}>
                  <X color="#aaa" size={11} />
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>

        {/* 3-Dots Menu Overlay */}
        {showMenu && (
          <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setShowMenu(false)}>
            <View style={[styles.menuCard, { top: Math.max(insets.top, 20) + 50 }]}>
              <Text style={styles.menuSectionTitle}>Sort By</Text>
              
              <TouchableOpacity style={styles.menuItem} onPress={() => { setSortBy('custom'); setShowMenu(false); }}>
                <Text style={[styles.menuText, sortBy === 'custom' && { color: THEME_COLOR, fontWeight: 'bold' }]}>Custom Order (Drag)</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.menuItem} onPress={() => { setSortBy('due_date'); setShowMenu(false); }}>
                <Text style={[styles.menuText, sortBy === 'due_date' && { color: THEME_COLOR, fontWeight: 'bold' }]}>Due Date</Text>
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.menuItem} onPress={() => { setSortBy('today'); setShowMenu(false); }}>
                <Text style={[styles.menuText, sortBy === 'today' && { color: THEME_COLOR, fontWeight: 'bold' }]}>Added to Today</Text>
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.menuItem} onPress={() => { setSortBy('alphabetical'); setShowMenu(false); }}>
                <Text style={[styles.menuText, sortBy === 'alphabetical' && { color: THEME_COLOR, fontWeight: 'bold' }]}>Alphabetically</Text>
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.menuItem} onPress={() => { setSortBy('creation'); setShowMenu(false); }}>
                <Text style={[styles.menuText, sortBy === 'creation' && { color: THEME_COLOR, fontWeight: 'bold' }]}>Creation Date</Text>
              </TouchableOpacity>
              
              <View style={styles.divider} />
              
              <TouchableOpacity style={styles.menuItem} onPress={shareList}>
                <Text style={styles.menuText}>Print List / Send Copy</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        )}

        {/* List */}
        {!isCacheLoaded ? (
          <View style={{ marginTop: 16, paddingHorizontal: 16 }}>
            <SkeletonTask />
            <SkeletonTask />
            <SkeletonTask />
            <SkeletonTask />
          </View>
        ) : sortedActiveTasks.length === 0 && completedTasks.length === 0 ? (
          <View style={styles.emptyState}>
            <Star color="#444" size={60} style={{ marginBottom: 16 }} />
            <Text style={styles.emptyText}>No starred tasks yet.</Text>
            <Text style={styles.emptySub}>Star a task to see it here.</Text>
          </View>
        ) : (
          <NestableScrollContainer style={{ flex: 1 }}>
            {sortedActiveTasks.length > 0 && (
              <NestableDraggableFlatList
                data={sortedActiveTasks}
                keyExtractor={(item) => item.id}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scroll}
                keyboardShouldPersistTaps="handled"
                onContainerLayout={() => {}}
                removeClippedSubviews={true}
                maxToRenderPerBatch={10}
                updateCellsBatchingPeriod={50}
                initialNumToRender={10}
                windowSize={5}
                onDragEnd={({ data }) => {
                  // Defer state update until after drag animation completes to prevent jitter
                  requestAnimationFrame(() => {
                    if (sortBy !== 'custom') setSortBy('custom');
                    
                    const orderMap = new Map(data.map((t, i) => [t.id, i]));
                    
                    const mergedTasks = latestTasksRef.current.map(t => 
                      orderMap.has(t.id) ? { ...t, starred_order_index: orderMap.get(t.id) } : t
                    );
                    
                    setTasks(mergedTasks);
                    
                    // Background sync via SyncQueue
                    const changedTasks = data.map((t, i) => ({ id: t.id, starred_order_index: i }));
                    reorderTasks(userId, mergedTasks, changedTasks, 'starred_order_index');
                  });
                }}
                renderItem={({ item: task, drag, isActive }) => {
                  const hasSubtasks = task.subtasks && task.subtasks.length > 0;
                  const hasNotes = task.notes && task.notes.trim().length > 0;
                  const hasMeta = task.due_date || task.reminder_time || task.repeat_rule || hasSubtasks || hasNotes;
                  const isOverdue = task.due_date && new Date(task.due_date) < todayStart && !task.is_completed;
                  const completedSubs = hasSubtasks ? task.subtasks.filter(s => s.is_completed).length : 0;
                  const totalSubs = hasSubtasks ? task.subtasks.length : 0;
                  
                  return (
                    <ScaleDecorator>
                      <TouchableOpacity
                        activeOpacity={0.75}
                        onPress={() => navigation.navigate('TaskDetail', { task, userId })}
                        onLongPress={drag}
                        disabled={isActive}
                        style={[
                          styles.taskCard,
                          isActive && { backgroundColor: 'rgba(255,255,255,0.08)', elevation: 12 }
                        ]}
                      >
                        <View style={[
                          styles.cardIndicator,
                          isOverdue ? { backgroundColor: '#EF4444' } : { backgroundColor: '#FFFFFF' }
                        ]} />

                        {/* Left: drag handle + checkbox */}
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          {!completingTaskIds.includes(task.id) && (
                            <TouchableOpacity onPressIn={drag} style={{ padding: 4, marginRight: 2 }}>
                              <GripVertical color="#444" size={20} />
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity 
                            onPress={() => toggleTask(task.id, task.is_completed)} 
                            disabled={completingTaskIds.includes(task.id)}
                            style={[
                              styles.checkbox,
                              completingTaskIds.includes(task.id) && { marginLeft: 28 }
                            ]}
                          >
                            {completingTaskIds.includes(task.id) ? (
                              <CheckCircle2 color="#10B981" size={24} />
                            ) : (
                              <Circle color={theme.text} size={24} />
                            )}
                          </TouchableOpacity>
                        </View>

                        {/* Title & Meta */}
                        <View style={styles.taskContent}>
                          <ScribbleStrike isCompleted={completingTaskIds.includes(task.id)} shouldAnimate={completingTaskIds.includes(task.id)} color={theme.textMuted}>
                            <Text
                              style={[
                                styles.taskTitle,
                                completingTaskIds.includes(task.id) && styles.taskCompletedText,
                              ]}
                            >
                              {task.title}
                            </Text>
                          </ScribbleStrike>
                          
                          {hasMeta && (
                            <View style={styles.taskMetaRow}>
                              {task.due_date && (
                                <View style={styles.metaPill}>
                                  <Calendar color={isOverdue ? '#EF4444' : '#888'} size={11} />
                                  <Text style={[styles.metaLabel, isOverdue && { color: '#EF4444' }]}>
                                    {formatDate(task.due_date)}
                                  </Text>
                                </View>
                              )}
                              {task.reminder_time && (
                                <View style={styles.metaPill}>
                                  <Bell color="#888" size={11} />
                                  <Text style={styles.metaLabel}>
                                    {formatDateTime(task.reminder_time)}
                                  </Text>
                                </View>
                              )}
                              {task.repeat_rule && (
                                <View style={styles.metaPill}>
                                  <Repeat color="#888" size={11} />
                                  <Text style={styles.metaLabel}>
                                    {task.repeat_rule}
                                  </Text>
                                </View>
                              )}
                              {hasSubtasks && (
                                <View style={styles.metaPill}>
                                  <ListChecks color="#888" size={11} />
                                  <Text style={styles.metaLabel}>
                                    {completedSubs}/{totalSubs}
                                  </Text>
                                </View>
                              )}
                              {hasNotes && (
                                <View style={[styles.metaPill, { paddingHorizontal: 6 }]}>
                                  <FileText color="#888" size={11} />
                                </View>
                              )}
                            </View>
                          )}
                        </View>

                        {/* Right: star + delete */}
                        <View style={styles.taskActions}>
                          <TouchableOpacity onPress={() => toggleImportant(task.id, task.is_important)} style={styles.iconButtonSmall}>
                            <Star color="#FFFFFF" fill="#FFFFFF" size={18} />
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => deleteTaskHandler(task.id)} style={styles.iconButtonSmall}>
                            <Trash2 color="#444" size={18} />
                          </TouchableOpacity>
                        </View>
                      </TouchableOpacity>
                    </ScaleDecorator>
                  );
                }}
              />
            )}

            {/* Completed Tasks */}
            {completedTasks.length > 0 && (
              <View style={{ paddingHorizontal: 16, paddingBottom: 100, paddingTop: sortedActiveTasks.length > 0 ? 0 : 10 }}>
                <Text style={styles.completedHeaderText}>Completed ({completedTasks.length})</Text>
                {completedTasks.map(task => {
                  const hasSubtasks = task.subtasks && task.subtasks.length > 0;
                  const hasNotes = task.notes && task.notes.trim().length > 0;
                  const hasMeta = task.due_date || task.reminder_time || task.repeat_rule || hasSubtasks || hasNotes;
                  const completedSubs = hasSubtasks ? task.subtasks.filter(s => s.is_completed).length : 0;
                  const totalSubs = hasSubtasks ? task.subtasks.length : 0;
                  
                  return (
                    <Animated.View key={task.id} entering={FadeIn.duration(300)}>
                      <TouchableOpacity
                        activeOpacity={0.75}
                        onPress={() => navigation.navigate('TaskDetail', { task, userId })}
                        style={[styles.taskCard, styles.taskCardCompleted]}
                      >
                        <View style={[styles.cardIndicator, { backgroundColor: '#10B981' }]} />
                        <TouchableOpacity
                          onPress={() => toggleTask(task.id, task.is_completed)}
                          style={[styles.checkbox, { marginLeft: 28 }]}
                        >
                          <CheckCircle2 color="#10B981" size={24} />
                        </TouchableOpacity>

                        <View style={styles.taskContent}>
                          <Text style={[styles.taskTitle, styles.taskCompletedText]}>
                            {task.title}
                          </Text>
                          {hasMeta && (
                            <View style={styles.taskMetaRow}>
                              {task.due_date && (
                                <View style={styles.metaPill}>
                                  <Calendar color="#888" size={11} />
                                  <Text style={styles.metaLabel}>{formatDate(task.due_date)}</Text>
                                </View>
                              )}
                              {hasSubtasks && (
                                <View style={styles.metaPill}>
                                  <ListChecks color="#888" size={11} />
                                  <Text style={styles.metaLabel}>{completedSubs}/{totalSubs}</Text>
                                </View>
                              )}
                              {hasNotes && (
                                <View style={[styles.metaPill, { paddingHorizontal: 6 }]}>
                                  <FileText color="#888" size={11} />
                                </View>
                              )}
                            </View>
                          )}
                        </View>
                        <View style={styles.taskActions}>
                          <TouchableOpacity onPress={() => toggleImportant(task.id, task.is_important)} style={styles.iconButtonSmall}>
                            <Star color="#FFFFFF" fill="#FFFFFF" size={18} />
                          </TouchableOpacity>
                        </View>
                      </TouchableOpacity>
                    </Animated.View>
                  );
                })}
              </View>
            )}
          </NestableScrollContainer>
        )}

        {/* FAB */}
        <TouchableOpacity style={styles.fab} onPress={() => {
          navigation.navigate('Today'); 
        }}>
          <Plus color="#000" size={30} />
        </TouchableOpacity>

      </SafeAreaView>
    </BackgroundWrapper>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sortBadge: {
    flexDirection: 'row', 
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 10, 
    paddingVertical: 4, 
    borderRadius: 16,
    marginTop: 4,
  },
  sortBadgeText: { 
    color: '#FFFFFF', 
    fontSize: 11, 
    fontWeight: '600' 
  },
  iconBtn: { padding: 8 },
  titleContainer: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 34,
    fontWeight: '800',
    color: THEME_COLOR,
    letterSpacing: -0.5,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 20,
  },
  emptyState: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  emptyText: { fontSize: 18, color: '#fff', fontWeight: '600' },
  emptySub: { fontSize: 14, color: '#888', marginTop: 8 },
  
  // Task Card
  taskCard: {
    backgroundColor: 'rgba(20, 20, 22, 0.85)',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingLeft: 10,
    paddingRight: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  cardIndicator: {
    width: 3.5,
    height: 20,
    borderRadius: 2,
    marginRight: 6,
    backgroundColor: 'transparent',
  },
  taskCardCompleted: {
    opacity: 0.45,
    backgroundColor: 'rgba(20, 20, 22, 0.45)',
    borderColor: 'transparent',
  },
  checkbox: { 
    marginRight: 12,
    marginTop: 0,
  },
  emptyCircle: {
    width: 20, 
    height: 20, 
    borderRadius: 10, 
    borderWidth: 2,
  },
  taskContent: { 
    flex: 1, 
    paddingRight: 8 
  },
  taskTitle: { 
    fontSize: 15, 
    fontWeight: '500', 
    lineHeight: 20,
    color: '#FFFFFF' 
  },
  taskCompletedText: { 
    color: '#888888' 
  },

  // Meta Row (inline, single line)
  taskMetaRow: {
    flexDirection: 'row', 
    alignItems: 'center', 
    flexWrap: 'wrap',
    marginTop: 4, 
    gap: 6,
  },
  metaPill: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#1A1A1C',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    gap: 4,
  },
  metaLabel: { 
    fontSize: 11, 
    fontWeight: '500',
    color: '#888',
  },

  taskActions: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 12,
    marginTop: 2,
  },
  iconButtonSmall: { 
    padding: 4,
  },

  completedHeaderText: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 12,
    marginTop: 8,
  },

  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: THEME_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: THEME_COLOR,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },

  menuOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 50,
  },
  menuCard: {
    position: 'absolute', right: 16,
    backgroundColor: '#1A1A1A', borderRadius: 16, padding: 8,
    width: 220, borderWidth: 1, borderColor: '#333',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 10, elevation: 15,
  },
  menuSectionTitle: { fontSize: 12, color: '#666', fontWeight: 'bold', paddingHorizontal: 12, paddingVertical: 8, textTransform: 'uppercase' },
  menuItem: { paddingVertical: 12, paddingHorizontal: 12 },
  menuText: { fontSize: 15, color: '#FFF' },
  divider: { height: 1, backgroundColor: '#333', marginVertical: 4 },
});
