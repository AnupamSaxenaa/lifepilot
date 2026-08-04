import * as ImagePicker from 'expo-image-picker';
import {
    Bug,
    Camera,
    Clock,
    Lightbulb,
    Menu,
    MessageSquare,
    Send,
    TriangleAlert,
    X
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ActivityIndicator,
    Alert,
    Image,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassSidebar } from '../components/GlassSidebar';
import { useTheme } from '../context/ThemeContext';
import { loadProfile } from '../lib/dataManager';
import { FEEDBACK_SEVERITIES, loadFeedbackHistory, submitFeedback } from '../lib/feedback';
import { supabase } from '../lib/supabase';

const DARK_BG = '#000000';
const CARD_BG = '#0A0A0A';
const BORDER_COLOR = '#1A1A1A';
const MAX_SCREENSHOTS = 3;

const STATUS_META = {
  open: { color: '#FBBF24', labelKey: 'feedback.statusOpen' },
  in_progress: { color: '#60A5FA', labelKey: 'feedback.statusInProgress' },
  resolved: { color: '#34D399', labelKey: 'feedback.statusResolved' },
  wont_fix: { color: '#71717A', labelKey: 'feedback.statusWontFix' },
};

export const FeedbackScreen = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const ACCENT = useTheme().theme.accent;

  const [userId, setUserId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const [view, setView] = useState('form'); // 'form' | 'history'

  // ─── Form state ───────────────────────────────────────
  const [category, setCategory] = useState('bug');
  const [severity, setSeverity] = useState('medium');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [screenshots, setScreenshots] = useState([]); // local URIs
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // ─── History state ────────────────────────────────────
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const CATEGORIES = [
    { key: 'bug', icon: Bug, color: '#FB7185', labelKey: 'feedback.categoryBug' },
    { key: 'feature_request', icon: Lightbulb, color: '#60A5FA', labelKey: 'feedback.categoryFeature' },
    { key: 'general', icon: MessageSquare, color: '#A78BFA', labelKey: 'feedback.categoryGeneral' },
    { key: 'other', icon: MessageSquare, color: '#71717A', labelKey: 'feedback.categoryOther' },
  ];

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setUserId(session.user.id);

      const cachedProfile = await loadProfile(session.user.id, setProfile);
      if (cachedProfile) setProfile(cachedProfile);

      const cachedHistory = await loadFeedbackHistory(session.user.id, (fresh) => {
        setHistory(fresh);
        setHistoryLoading(false);
      });
      setHistory(cachedHistory);
      setHistoryLoading(false);
    };
    init();
  }, []);

  const handleLogout = async () => {
    navigation.reset({ index: 0, routes: [{ name: 'Onboarding' }] });
    supabase.auth.signOut();
  };

  const handlePickScreenshot = async () => {
    if (screenshots.length >= MAX_SCREENSHOTS) return;

    let perm = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    }
    if (perm.status !== 'granted') {
      Alert.alert(t('feedback.permissionRequiredTitle'), t('feedback.permissionRequiredMessage'));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (result.canceled) return;

    setScreenshots((prev) => [...prev, result.assets[0].uri].slice(0, MAX_SCREENSHOTS));
  };

  const handleRemoveScreenshot = (uri) => {
    setScreenshots((prev) => prev.filter((u) => u !== uri));
  };

  const resetForm = () => {
    setCategory('bug');
    setSeverity('medium');
    setSubject('');
    setMessage('');
    setContactEmail('');
    setScreenshots([]);
    setFormError('');
  };

  const handleSubmit = async () => {
    if (!userId) return;
    setFormError('');

    if (!subject.trim()) {
      setFormError(t('feedback.subjectRequiredError'));
      return;
    }
    if (!message.trim()) {
      setFormError(t('feedback.messageRequiredError'));
      return;
    }
    if (contactEmail.trim() && !/^\S+@\S+\.\S+$/.test(contactEmail.trim())) {
      setFormError(t('feedback.emailInvalidError'));
      return;
    }

    setSubmitting(true);
    const result = await submitFeedback(userId, {
      category,
      severity: category === 'bug' ? severity : undefined,
      subject,
      message,
      screenshotUris: screenshots,
      contactEmail,
    });
    setSubmitting(false);

    if (!result.success) {
      setFormError(t('feedback.submitFailedError'));
      return;
    }

    resetForm();

    // Refresh the local history view so the new submission shows up.
    const fresh = await loadFeedbackHistory(userId, setHistory);
    setHistory(fresh);

    Alert.alert(
      t('feedback.thankYouTitle'),
      result.offline ? t('feedback.submittedOfflineMessage') : t('feedback.submittedMessage'),
      [{ text: t('common.ok'), onPress: () => setView('history') }]
    );
  };

  const renderHistoryItem = (item) => {
    const meta = STATUS_META[item.status] || STATUS_META.open;
    const cat = CATEGORIES.find((c) => c.key === item.category) || CATEGORIES[3];
    const Icon = cat.icon;
    return (
      <View key={item.id} style={styles.historyCard}>
        <View style={styles.historyCardHeader}>
          <View style={[styles.historyIconWrap, { backgroundColor: cat.color + '20' }]}>
            <Icon color={cat.color} size={16} />
          </View>
          <Text style={styles.historySubject} numberOfLines={1}>{item.subject}</Text>
        </View>
        <Text style={styles.historyMessage} numberOfLines={2}>{item.message}</Text>
        <View style={styles.historyFooter}>
          <View style={[styles.statusPill, { backgroundColor: meta.color + '20' }]}>
            <View style={[styles.statusDot, { backgroundColor: meta.color }]} />
            <Text style={[styles.statusText, { color: meta.color }]}>{t(meta.labelKey)}</Text>
          </View>
          <Text style={styles.historyDate}>
            {new Date(item.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </Text>
        </View>
        {item.admin_notes ? (
          <View style={styles.adminNoteBox}>
            <Text style={styles.adminNoteLabel}>{t('feedback.developerReplyLabel')}</Text>
            <Text style={styles.adminNoteText}>{item.admin_notes}</Text>
          </View>
        ) : null}
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
        currentRoute="Feedback"
        handleLogout={handleLogout}
      />

      <View style={[styles.header, { paddingTop: Math.max(insets.top + 4, 24) }]}>
        <TouchableOpacity onPress={() => setIsSidebarOpen(true)} style={styles.iconButton}>
          <Menu color="#FFFFFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('feedback.headerTitle')}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Tab Switcher */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, view === 'form' && { backgroundColor: ACCENT + '20', borderColor: ACCENT }]}
          onPress={() => setView('form')}
        >
          <Text style={[styles.tabBtnText, view === 'form' && { color: ACCENT }]}>{t('feedback.tabNew')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, view === 'history' && { backgroundColor: ACCENT + '20', borderColor: ACCENT }]}
          onPress={() => setView('history')}
        >
          <Text style={[styles.tabBtnText, view === 'history' && { color: ACCENT }]}>
            {t('feedback.tabHistory')} {history.length > 0 ? `(${history.length})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {view === 'form' ? (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={insets.top}
        >
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            {/* Category picker */}
            <Text style={styles.sectionTitle}>{t('feedback.categoryLabel')}</Text>
            <View style={styles.categoryGrid}>
              {CATEGORIES.map((cat) => {
                const Icon = cat.icon;
                const selected = category === cat.key;
                return (
                  <TouchableOpacity
                    key={cat.key}
                    style={[
                      styles.categoryCard,
                      selected && { borderColor: cat.color, backgroundColor: cat.color + '15' },
                    ]}
                    onPress={() => setCategory(cat.key)}
                    activeOpacity={0.7}
                  >
                    <Icon color={selected ? cat.color : '#666'} size={22} />
                    <Text style={[styles.categoryLabel, selected && { color: '#fff' }]}>{t(cat.labelKey)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Severity picker (bug only) */}
            {category === 'bug' && (
              <>
                <Text style={styles.sectionTitle}>{t('feedback.severityLabel')}</Text>
                <View style={styles.severityRow}>
                  {FEEDBACK_SEVERITIES.map((s) => {
                    const selected = severity === s;
                    return (
                      <TouchableOpacity
                        key={s}
                        style={[styles.severityChip, selected && { backgroundColor: ACCENT, borderColor: ACCENT }]}
                        onPress={() => setSeverity(s)}
                      >
                        <Text style={[styles.severityChipText, selected && { color: '#000', fontWeight: '700' }]}>
                          {t(`feedback.severity_${s}`)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            {/* Subject */}
            <Text style={styles.sectionTitle}>{t('feedback.subjectLabel')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('feedback.subjectPlaceholder')}
              placeholderTextColor="#666"
              value={subject}
              onChangeText={setSubject}
              maxLength={200}
            />

            {/* Message */}
            <Text style={styles.sectionTitle}>{t('feedback.messageLabel')}</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder={
                category === 'bug' ? t('feedback.messagePlaceholderBug') : t('feedback.messagePlaceholderGeneral')
              }
              placeholderTextColor="#666"
              value={message}
              onChangeText={setMessage}
              multiline
              maxLength={4000}
              textAlignVertical="top"
            />
            <Text style={styles.charCount}>{message.length}/4000</Text>

            {/* Screenshots */}
            <Text style={styles.sectionTitle}>{t('feedback.screenshotsLabel')}</Text>
            <View style={styles.screenshotRow}>
              {screenshots.map((uri) => (
                <View key={uri} style={styles.screenshotThumbWrap}>
                  <Image source={{ uri }} style={styles.screenshotThumb} />
                  <TouchableOpacity style={styles.screenshotRemoveBtn} onPress={() => handleRemoveScreenshot(uri)}>
                    <X color="#fff" size={12} />
                  </TouchableOpacity>
                </View>
              ))}
              {screenshots.length < MAX_SCREENSHOTS && (
                <TouchableOpacity style={styles.addScreenshotBtn} onPress={handlePickScreenshot}>
                  <Camera color="#666" size={20} />
                  <Text style={styles.addScreenshotText}>{t('feedback.addScreenshot')}</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Contact email */}
            <Text style={styles.sectionTitle}>{t('feedback.contactEmailLabel')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('feedback.contactEmailPlaceholder')}
              placeholderTextColor="#666"
              value={contactEmail}
              onChangeText={setContactEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.hint}>{t('feedback.contactEmailHint')}</Text>

            {formError ? (
              <View style={styles.errorBox}>
                <TriangleAlert color="#A1A1AA" size={16} />
                <Text style={styles.errorText}>{formError}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: ACCENT }, submitting && { opacity: 0.7 }]}
              onPress={handleSubmit}
              disabled={submitting}
              activeOpacity={0.85}
            >
              {submitting ? (
                <ActivityIndicator color="#000" />
              ) : (
                <>
                  <Send color="#000" size={18} />
                  <Text style={styles.submitBtnText}>{t('feedback.submitButton')}</Text>
                </>
              )}
            </TouchableOpacity>

            <View style={{ height: 60 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {historyLoading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : history.length === 0 ? (
            <View style={styles.centerBox}>
              <Clock color="#333" size={48} style={{ marginBottom: 12 }} />
              <Text style={styles.emptyText}>{t('feedback.noHistoryText')}</Text>
            </View>
          ) : (
            history.map(renderHistoryItem)
          )}
          <View style={{ height: 60 }} />
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DARK_BG },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  iconButton: { padding: 8, width: 40 },
  headerTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },

  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 16,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
    alignItems: 'center',
  },
  tabBtnText: { color: '#888', fontWeight: '700', fontSize: 13 },

  scroll: { paddingHorizontal: 20, paddingBottom: 40 },

  sectionTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 10,
    marginTop: 18,
  },

  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  categoryCard: {
    width: '47%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
    backgroundColor: CARD_BG,
  },
  categoryLabel: { color: '#888', fontSize: 13, fontWeight: '600', flexShrink: 1 },

  severityRow: { flexDirection: 'row', gap: 8 },
  severityChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
    backgroundColor: CARD_BG,
    alignItems: 'center',
  },
  severityChipText: { color: '#888', fontSize: 12, fontWeight: '600' },

  input: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
    borderRadius: 14,
    padding: 14,
    color: '#fff',
    fontSize: 15,
  },
  textArea: { minHeight: 120 },
  charCount: { color: '#555', fontSize: 11, textAlign: 'right', marginTop: 4 },
  hint: { color: '#555', fontSize: 12, marginTop: 6 },

  screenshotRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  screenshotThumbWrap: { position: 'relative' },
  screenshotThumb: { width: 72, height: 72, borderRadius: 12, backgroundColor: '#111' },
  screenshotRemoveBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#A1A1AA',
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addScreenshotBtn: {
    width: 72,
    height: 72,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  addScreenshotText: { color: '#555', fontSize: 9, fontWeight: '600' },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#A1A1AA15',
    borderRadius: 10,
    padding: 12,
    marginTop: 16,
  },
  errorText: { color: '#A1A1AA', fontSize: 13, flex: 1 },

  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 24,
  },
  submitBtnText: { color: '#000', fontWeight: '800', fontSize: 15 },

  centerBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 80 },
  emptyText: { color: '#666', fontSize: 14, textAlign: 'center' },

  historyCard: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  historyCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  historyIconWrap: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  historySubject: { color: '#fff', fontSize: 15, fontWeight: '700', flex: 1 },
  historyMessage: { color: '#999', fontSize: 13, lineHeight: 18, marginBottom: 10 },
  historyFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: '700' },
  historyDate: { color: '#555', fontSize: 12 },
  adminNoteBox: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: BORDER_COLOR,
  },
  adminNoteLabel: { color: '#666', fontSize: 11, fontWeight: '700', marginBottom: 4, textTransform: 'uppercase' },
  adminNoteText: { color: '#ccc', fontSize: 13, lineHeight: 19 },
});
