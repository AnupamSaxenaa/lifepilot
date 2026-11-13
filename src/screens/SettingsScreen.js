import DateTimePicker from '@react-native-community/datetimepicker';
import { decode } from 'base64-arraybuffer';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as Updates from 'expo-updates';
import { Calendar, Camera, CheckCircle2, ChevronRight, CloudOff, EyeOff, Globe, ImagePlus, KeyRound, LayoutGrid, LogOut, Mail, Menu, MessageSquare, RefreshCw, Rocket, Shield, Sparkles, Trash2, Trophy, User, UserCog, X, Zap } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ActivityIndicator, Alert,
    Image, Modal, Platform, ScrollView,
    StyleSheet, Switch,
    Text, TextInput, TouchableOpacity, View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassSidebar } from '../components/GlassSidebar';
import { JasperTribute } from '../components/JasperTribute';
import { LanguagePickerModal } from '../components/LanguagePickerModal';
import { MarketplaceButton } from '../components/MarketplaceButton';
import { HUSTLERS_ENABLED, PLAYSTORE_MODE } from '../config/flags';
import { useTheme } from '../context/ThemeContext';
import { getCurrentLanguage, setAppLanguage } from '../i18n';
import { SUPPORTED_LANGUAGES } from '../i18n/languages';
import { isRewardedAdAvailable } from '../lib/adRewards';
import { deleteUserAccountData, getCurrentUserId, loadProfile, signOutCurrentUser, updateProfile } from '../lib/dataManager';
import { supabase } from '../lib/supabase';
import {
    clearConflict,
    clearDeadLetters,
    drainSyncQueue,
    getConflicts,
    getDeadLetters,
    getPendingCount,
    subscribeSyncState
} from '../lib/syncQueue';
import { Storage } from '../utils/storage';
import { UpdateManager } from '../utils/updateManager';

const THEME_COLOR = '#FFFFFF';
const DARK_BG = '#000000';
const CARD_BG = '#0A0A0A';
const BORDER_COLOR = '#1A1A1A';

const MAX_AVATAR_SIZE_MB = 2;
const MAX_AVATAR_SIZE_BYTES = MAX_AVATAR_SIZE_MB * 1024 * 1024;

const readAccountSyncStatus = async (userId) => {
  if (!userId) return { pending: 0, deadLetters: [], conflicts: [] };
  const scope = { actorUserId: String(userId), includeUnscoped: true };
  const [pending, deadLetters, conflicts] = await Promise.all([
    getPendingCount(scope),
    getDeadLetters(scope),
    getConflicts(scope),
  ]);
  return { pending, deadLetters, conflicts };
};

// Deterministic snowflake icon (no lucide dependency) for the Streak Freeze toggle
const SnowIcon = ({ size = 18 }) => (
  <Text style={{ fontSize: size, lineHeight: size + 2 }}>❄️</Text>
);

export const SettingsScreen = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const ACCENT = useTheme().theme.accent;
  const ON_ACCENT = useTheme().theme.onAccent || '#0B0B0D';
  const { t } = useTranslation();
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [currentLanguage, setCurrentLanguage] = useState(getCurrentLanguage());

  const currentLanguageInfo = SUPPORTED_LANGUAGES.find((l) => l.code === currentLanguage) || SUPPORTED_LANGUAGES[0];

  const handleSelectLanguage = async (code) => {
    setShowLanguageModal(false);
    if (code === currentLanguage) return;
    const { needsReload } = await setAppLanguage(code);
    setCurrentLanguage(code);
    // Persist locally first; dataManager durably queues cross-device sync.
    if (userId) {
      updateProfile(userId, profile || { id: userId }, { preferred_language: code })
        .then((updated) => setProfile(updated))
        .catch(() => {});
    }
    if (needsReload) {
      // RTL direction changed (e.g. switching to/from Arabic/Urdu) — RN can't
      // re-flip layout direction without a full reload.
      Alert.alert(
        t('settings.selectLanguage'),
        t('settings.rtlReloadMessage'),
        [{ text: t('common.ok'), onPress: () => Updates.reloadAsync().catch(() => {}) }]
      );
    }
  };

  const [profile, setProfile] = useState(null);
  const [email, setEmail] = useState('');
  const [userId, setUserId] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [streakFreezeEnabled, setStreakFreezeEnabled] = useState(false);
  const [leaderboardOptIn, setLeaderboardOptIn] = useState(false);
  const [ghostMode, setGhostMode] = useState(false);

  // ─── Modal States ─────────────────────────────────────
  const [showNameModal, setShowNameModal] = useState(false);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showAvatarOptions, setShowAvatarOptions] = useState(false);
  const [showDobModal, setShowDobModal] = useState(false);

  // ─── Form States ──────────────────────────────────────
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newDob, setNewDob] = useState(new Date());
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [formError, setFormError] = useState('');

  // ─── Sync Status ──────────────────────────────────────
  // Sync state is live and account-scoped. Legacy unscoped entries are included
  // for the current account so older offline work can still drain, while entries
  // explicitly owned by another account never create a permanent false warning.
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [deadLetterCount, setDeadLetterCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const [syncConnectivity, setSyncConnectivity] = useState({
    online: false,
    connectivityKnown: false,
  });
  const [syncing, setSyncing] = useState(false);
  const syncIssueCount = deadLetterCount + conflictCount;

  const applySyncStatus = (status) => {
    setPendingSyncCount(status.pending);
    setDeadLetterCount(status.deadLetters.length);
    setConflictCount(status.conflicts.length);
  };

  const refreshSyncStatus = async () => {
    const status = await readAccountSyncStatus(userId);
    applySyncStatus(status);
    return status;
  };

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribeSyncState((state) => {
      if (cancelled) return;
      setSyncConnectivity({
        online: state.online === true,
        connectivityKnown: state.connectivityKnown === true,
      });
      readAccountSyncStatus(userId).then((status) => {
        if (!cancelled) {
          setPendingSyncCount(status.pending);
          setDeadLetterCount(status.deadLetters.length);
          setConflictCount(status.conflicts.length);
        }
      }).catch(() => {});
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [userId]);

  const clearCurrentSyncIssues = async () => {
    if (!userId) return;
    const scope = { actorUserId: String(userId), includeUnscoped: true };
    const conflicts = await getConflicts(scope);
    await Promise.all([
      clearDeadLetters(scope),
      ...conflicts.map((conflict) => clearConflict(conflict.id)),
    ]);
    await refreshSyncStatus();
  };

  const handleViewSyncIssues = async (knownStatus = null) => {
    const status = knownStatus || await refreshSyncStatus();
    const issueCount = status.deadLetters.length + status.conflicts.length;
    if (issueCount === 0) {
      Alert.alert(t('settings.allSyncedTitle'), t('settings.allSyncedMessage'));
      return;
    }
    Alert.alert(
      t('settings.syncIssuesTitle'),
      t(issueCount === 1 ? 'settings.syncIssuesMessage_one' : 'settings.syncIssuesMessage_other', { count: issueCount }),
      [
        { text: t('settings.dismiss'), style: 'cancel' },
        {
          text: t('settings.clearLog'),
          style: 'destructive',
          onPress: () => { clearCurrentSyncIssues().catch(() => {}); },
        },
      ],
    );
  };

  const handleSyncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await drainSyncQueue();
      const status = await refreshSyncStatus();
      if (result.offline) {
        Alert.alert(
          t('settings.syncPausedTitle', { defaultValue: 'Sync paused' }),
          t('settings.syncOfflineMessage', { defaultValue: 'LifePilot cannot verify an internet connection yet. Your changes are safe on this device and will sync automatically when you reconnect.' }),
        );
      } else if (status.pending > 0) {
        Alert.alert(
          t('settings.syncPendingTitle', { defaultValue: 'Still waiting to sync' }),
          t('settings.syncPendingMessage', {
            count: status.pending,
            defaultValue: '{{count}} change is still safely queued. The server could not accept it yet; LifePilot will retry automatically.',
          }),
        );
      } else if (status.deadLetters.length + status.conflicts.length > 0) {
        await handleViewSyncIssues(status);
      } else {
        Alert.alert(t('settings.allSyncedTitle'), t('settings.allSyncedMessage'));
      }
    } catch (error) {
      Alert.alert(
        t('settings.syncIssuesTitle'),
        error?.message || t('settings.syncRetryFailed', { defaultValue: 'Sync could not finish. Your changes remain safely queued.' }),
      );
    } finally {
      setSyncing(false);
    }
  };

  // ─── OTA Update States ────────────────────────────────
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [formLoading, setFormLoading] = useState(false);

  // ─── Password OTP States ──────────────────────────────
  const [passwordStep, setPasswordStep] = useState('input'); // 'input' | 'otp_sent' | 'verify'
  const [otp, setOtp] = useState('');
  const [otpTimer, setOtpTimer] = useState(0);

  // ─── Avatar URL ───────────────────────────────────────
  const getAvatarSource = () => {
    if (profile?.avatar_url) {
      return { uri: profile.avatar_url };
    }
    const seed = profile?.avatar_seed || profile?.username || 'fallback';
    return { uri: `https://api.dicebear.com/7.x/adventurer/png?seed=${seed}&backgroundColor=b6e3f4,c0aede,d1d4f9` };
  };

  // ─── Init ─────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      const resolvedUserId = await getCurrentUserId();
      if (!resolvedUserId) return;
      setUserId(resolvedUserId);

      // Email is needed for online account operations, but resolving it must
      // not delay cached settings/profile rendering while offline.
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user?.id === resolvedUserId) setEmail(session.user.email || '');
      }).catch(() => {});

      // Load the opt-in streak-protection preference. Missing means OFF, so XP
      // cannot be deducted until the user explicitly enables the setting.
      const [boardPref, ghostPref] = await Promise.all([
        Storage.get(`leaderboard_opt_in_${resolvedUserId}`),
        Storage.get(`ghost_mode_${resolvedUserId}`),
      ]);
      setLeaderboardOptIn(boardPref === true || boardPref === 'true');
      setGhostMode(ghostPref === true || ghostPref === 'true');

      const freezePref = await Storage.get(`streak_freeze_enabled_${resolvedUserId}`);
      setStreakFreezeEnabled(freezePref === true || freezePref === 'true');

      // Load profile: cache first → Supabase background
      // Force fresh load to ensure avatar_url is current (especially after reinstall)
      const cached = await loadProfile(resolvedUserId, (fresh) => {
        setProfile(fresh);
        setLoading(false);
      });
      if (cached) { setProfile(cached); setLoading(false); }

      setLoading(false);
    };
    init();
  }, []);

  // ─── OTP Countdown Timer ──────────────────────────────
  useEffect(() => {
    if (otpTimer <= 0) return;
    const interval = setInterval(() => {
      setOtpTimer(prev => prev - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [otpTimer]);

  // ─── Avatar Upload ────────────────────────────────────
  const handlePickAvatar = async () => {
    // ── Android: no permission request, deliberately ──
    // We used to request READ_MEDIA_IMAGES (or READ_EXTERNAL_STORAGE below
    // API 33), which grants access to the WHOLE photo library. Google's Photo
    // and Video Permissions policy expects the system photo picker instead,
    // which returns just the single image the user taps and needs no permission
    // at all. `launchImageLibraryAsync` uses that picker, so asking for the
    // broad permission was both unnecessary and a policy problem — the store
    // build now blocks READ_MEDIA_IMAGES outright.
    //
    // iOS still uses its own permission model, so it keeps the request.
    if (Platform.OS !== 'android') {
      let perm = await ImagePicker.getMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      }
      if (perm.status !== 'granted') {
        Alert.alert(t('settings.permissionRequiredTitle'), t('settings.permissionRequiredMessage'));
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (result.canceled) return;

    const asset = result.assets[0];

    // Check file size if available
    if (asset.fileSize && asset.fileSize > MAX_AVATAR_SIZE_BYTES) {
      Alert.alert(t('settings.fileTooLargeTitle'), t('settings.fileTooLargeMessage', { size: MAX_AVATAR_SIZE_MB }));
      return;
    }

    setAvatarUploading(true);

    try {
      const mimeType = asset.mimeType || (asset.uri.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
      const ext = mimeType === 'image/png' ? 'png' : 'jpg';

      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (!base64 || base64.length < 100) {
        Alert.alert(t('settings.errorTitle'), t('settings.errorReadImage'));
        setAvatarUploading(false);
        return;
      }

      const approxBytes = (base64.length * 3) / 4;
      if (approxBytes > MAX_AVATAR_SIZE_BYTES) {
        Alert.alert(t('settings.fileTooLargeTitle'), t('settings.fileTooLargeMessageShort', { size: MAX_AVATAR_SIZE_MB }));
        setAvatarUploading(false);
        return;
      }

      const fileName = `${userId}/avatar.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('avatar')
        .upload(fileName, decode(base64), {
          contentType: mimeType,
          upsert: true,
        });

      if (uploadError) {
        console.log('Supabase upload error:', JSON.stringify(uploadError));
        Alert.alert(t('settings.uploadFailedTitle'), uploadError.message || t('settings.uploadFailedMessage'));
        setAvatarUploading(false);
        return;
      }

      const { data: urlData } = supabase.storage
        .from('avatar')
        .getPublicUrl(fileName);

      const publicUrl = `${urlData.publicUrl}?v=${base64.length}`;

      const updated = await updateProfile(userId, profile, { avatar_url: publicUrl });
      setProfile(updated);
      Alert.alert(t('settings.successTitle'), t('settings.avatarUpdated'));
    } catch (e) {
      console.log('Avatar upload error:', e?.message || e);
      Alert.alert(t('settings.uploadErrorTitle'), e?.message || t('settings.uploadErrorMessage'));
    }

    setAvatarUploading(false);
  };

  const handleRemoveAvatar = async () => {
    setShowAvatarOptions(false);
    setAvatarUploading(true);

    const seed = `${userId}-avatar`;
    const updated = await updateProfile(userId, profile, { avatar_url: null, avatar_seed: seed });
    setProfile(updated);
    setAvatarUploading(false);
    Alert.alert(t('settings.doneTitle'), t('settings.avatarRemoved'));

    // Blob cleanup is best-effort and online-only; the visible profile change
    // is already cached and durably queued above.
    supabase.storage
      .from('avatar')
      .remove([`${userId}/avatar.jpg`, `${userId}/avatar.png`, `${userId}/avatar.jpeg`])
      .catch(() => {});
  };

  // ─── Check for OTA Updates ────────────────────────────
  const handleCheckForUpdates = async () => {
    if (!UpdateManager.isEnabled()) {
      Alert.alert(t('settings.updatesTitle'), t('settings.updatesProductionOnly'));
      return;
    }

    setCheckingUpdate(true);
    setUpdateInfo(null);

    try {
      const { isAvailable, isRollBack } = await UpdateManager.checkForUpdates();

      if (isAvailable || isRollBack) {
        Alert.alert(
          t('settings.updateAvailableTitle'),
          t('settings.updateAvailableMessage'),
          [
            { text: t('settings.later'), style: 'cancel', onPress: () => setCheckingUpdate(false) },
            {
              text: t('settings.updateNow'),
              onPress: async () => {
                // Download the new bundle, then reload into it. Unlike the old
                // flow, download and apply are explicit steps so a failed
                // download never silently pretends to succeed.
                const dl = await UpdateManager.downloadUpdate();
                if (dl.success && (dl.isNew || dl.isRollBack)) {
                  await UpdateManager.applyUpdate(); // reloads the app
                } else {
                  setCheckingUpdate(false);
                  Alert.alert(t('settings.updatesTitle'), t('settings.updateDownloadedMessage'));
                }
              },
            },
          ]
        );
      } else {
        setCheckingUpdate(false);
        Alert.alert(t('settings.noUpdatesTitle'), t('settings.noUpdatesMessage'));
      }
    } catch (error) {
      setCheckingUpdate(false);
      Alert.alert(t('settings.errorTitle'), t('settings.updateCheckFailedMessage'));
    }
  };

  // ─── Change Display Name ──────────────────────────────
  const handleChangeName = async () => {
    if (!newDisplayName.trim()) { setFormError(t('settings.nameEmptyError')); return; }
    setFormLoading(true); setFormError('');
    try {
      const updated = await updateProfile(userId, profile, { display_name: newDisplayName.trim() });
      setProfile(updated);
      setFormLoading(false);
      setShowNameModal(false);
    } catch (e) {
      setFormError(e.message || t('settings.nameUpdateFailedError'));
      setFormLoading(false);
    }
  };

  // ─── Change DOB ───────────────────────────────────────
  const handleChangeDob = async () => {
    setFormLoading(true); setFormError('');
    try {
      const updated = await updateProfile(userId, profile, { dob: newDob.toISOString().split('T')[0] });
      setProfile(updated);
      setFormLoading(false);
      setShowDobModal(false);
    } catch (e) {
      setFormError(e.message || t('settings.dobUpdateFailedError'));
      setFormLoading(false);
    }
  };

  // ─── Change Username ──────────────────────────────────
  const canChangeUsername = () => {
    if (!profile?.username_changed_at) return true;
    const lastChanged = new Date(profile.username_changed_at);
    const now = new Date();
    const diffDays = (now - lastChanged) / (1000 * 60 * 60 * 24);
    return diffDays >= 30;
  };

  const getNextUsernameChangeDate = () => {
    if (!profile?.username_changed_at) return null;
    const next = new Date(profile.username_changed_at);
    next.setDate(next.getDate() + 30);
    return next.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const handleChangeUsername = async () => {
    const username = newUsername.trim().toLowerCase();
    if (!username) { setFormError(t('settings.usernameEmptyError')); return; }
    if (username.length < 3) { setFormError(t('settings.usernameLengthError')); return; }
    if (!/^[a-z0-9._]+$/.test(username)) { setFormError(t('settings.usernameCharsError')); return; }

    setFormLoading(true); setFormError('');

    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', username)
      .neq('id', userId)
      .maybeSingle();

    if (existing) { setFormError(t('settings.usernameTakenError')); setFormLoading(false); return; }

    try {
      const updated = await updateProfile(userId, profile, { username, username_changed_at: new Date().toISOString() });
      setProfile(updated);
      setFormLoading(false);
      setShowUsernameModal(false);
    } catch (e) {
      setFormError(e.message || t('settings.usernameUpdateFailedError'));
      setFormLoading(false);
    }
  };

  // ─── Change Password (with OTP) ───────────────────────
  const handleRequestOtp = async () => {
    if (newPassword.length < 6) { setFormError(t('settings.passwordLengthError')); return; }
    if (newPassword !== confirmPassword) { setFormError(t('settings.passwordMismatchError')); return; }

    setFormLoading(true); setFormError('');

    const { error } = await supabase.auth.signInWithOtp({
      email: email,
    });

    if (error) {
      setFormError(error.message);
      setFormLoading(false);
      return;
    }

    setPasswordStep('verify');
    setOtpTimer(30);
    setFormLoading(false);
  };

  const handleVerifyOtpAndChangePassword = async () => {
    if (otp.length < 6) { setFormError(t('settings.otpEnterCodeError')); return; }

    setFormLoading(true); setFormError('');

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email,
      token: otp,
      type: 'email',
    });

    if (verifyError) {
      setFormError(t('settings.otpInvalidError'));
      setFormLoading(false);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });

    if (updateError) {
      setFormError(updateError.message);
      setFormLoading(false);
      return;
    }

    setFormLoading(false);
    setShowPasswordModal(false);
    setPasswordStep('input');
    setNewPassword(''); setConfirmPassword(''); setOtp('');
    Alert.alert(t('settings.successTitle'), t('settings.passwordChangedMessage'));
  };

  const handleResendOtp = async () => {
    if (otpTimer > 0) return;
    setFormLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) { setFormError(error.message); }
    else { setOtpTimer(30); setFormError(''); }
    setFormLoading(false);
  };

  // ─── Delete Account ───────────────────────────────────
  // Deletion is server-side and irreversible. If it fails we must keep the user
  // signed in and say so — the old flow signed out and navigated away regardless,
  // which told people their account was gone while it was still live.
  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') { setFormError(t('settings.deleteConfirmError')); return; }
    setFormLoading(true); setFormError('');

    try {
      await deleteUserAccountData(userId);
    } catch (error) {
      setFormLoading(false);
      setFormError(
        error?.message === 'not_authenticated'
          ? t('settings.deleteSignedOutError')
          : t('settings.deleteFailedError'),
      );
      return;
    }

    // The account is definitely gone at this point. Local cleanup is best-effort:
    // it must never be able to strand the user on a screen for an account that no
    // longer exists, which is exactly what a missing Storage.clear() used to do.
    try {
      await supabase.auth.signOut();
    } catch (_e) { /* session is already invalid server-side */ }
    try {
      await Storage.clear();
    } catch (_e) { /* stale local cache is harmless next launch */ }

    setFormLoading(false);
    setShowDeleteModal(false);
    navigation.reset({ index: 0, routes: [{ name: 'Onboarding' }] });
  };

  // ─── Hustlers privacy (opt-in ranking + ghost mode) ───
  // Both default OFF. A global leaderboard exposes your username, photo and
  // activity to strangers, so appearing there is a deliberate choice, and the
  // RLS policy in 0017 enforces it server-side too — not just in this UI.
  const handleToggleLeaderboard = async (value) => {
    setLeaderboardOptIn(value);
    if (!userId) return;
    await Storage.set(`leaderboard_opt_in_${userId}`, Boolean(value));
    // updateProfile is (userId, currentProfile, fields). Passing the fields as
    // the 2nd argument silently sent `undefined` to the server, so the opt-in
    // never persisted and the user stayed off the leaderboard.
    updateProfile(userId, profile, { leaderboard_opted_in: Boolean(value) }).catch(() => {});
  };

  const handleToggleGhost = async (value) => {
    setGhostMode(value);
    if (!userId) return;
    await Storage.set(`ghost_mode_${userId}`, Boolean(value));
    updateProfile(userId, profile, { ghost_mode: Boolean(value) }).catch(() => {});
  };

  // ─── Streak Freeze Toggle ─────────────────────────────
  const handleToggleStreakFreeze = async (value) => {
    // Optimistic UI first, then persist the local offline preference.
    setStreakFreezeEnabled(value);
    if (userId) {
      await Storage.set(`streak_freeze_enabled_${userId}`, Boolean(value));
    }
  };

  // ─── Logout ───────────────────────────────────────────
  const handleLogout = async () => {
    try {
      await signOutCurrentUser();
      navigation.reset({ index: 0, routes: [{ name: 'Onboarding' }] });
    } catch (error) {
      Alert.alert(
        t('common.error', { defaultValue: 'Could not sign out' }),
        error?.message || t('common.tryAgain', { defaultValue: 'Please try again.' }),
      );
    }
  };

  // Only ever spin when there is genuinely nothing cached to show. Replacing the
  // whole screen with a spinner on every visit violated the offline-first rule
  // that cached data must paint immediately.
  if (loading && !profile) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top + 4, 24) }]}>
        <TouchableOpacity onPress={() => setIsSidebarOpen(true)} style={styles.iconButton}>
          <Menu color="#FFFFFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('settings.headerTitle')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* ── Identity: avatar beside the details instead of a tall centred
              stack, so the first screenful reaches actual settings. ── */}
        <TouchableOpacity
          style={styles.profileHeader}
          activeOpacity={0.8}
          onPress={() => setShowAvatarOptions(true)}
          disabled={avatarUploading}
          accessibilityRole="button"
          accessibilityLabel={t('settings.profilePhotoTitle')}
        >
          <View style={styles.avatarWrap}>
            {avatarUploading ? (
              <View style={[styles.avatar, styles.avatarLoading]}>
                <ActivityIndicator color="#fff" size="small" />
              </View>
            ) : (
              <Image source={getAvatarSource()} style={styles.avatar} />
            )}
            <View style={[styles.cameraBadge, { backgroundColor: ACCENT }]}>
              <Camera color={ON_ACCENT} size={11} />
            </View>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName} numberOfLines={1}>
              {profile?.display_name || t('settings.defaultUserName')}
            </Text>
            <Text style={styles.profileUsername} numberOfLines={1}>
              @{profile?.username || t('settings.defaultUsername')}
            </Text>
            <Text style={styles.profileEmail} numberOfLines={1}>{email}</Text>
          </View>
        </TouchableOpacity>

        {/* Upgrade to Pro banner — hidden while PLAYSTORE_MODE is off */}
        {PLAYSTORE_MODE && (
          <TouchableOpacity
            style={[styles.proBanner, { borderColor: `${ACCENT}55` }]}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Paywall')}
          >
            <Zap color={ACCENT} size={17} />
            <View style={{ flex: 1 }}>
              <Text style={styles.proBannerTitle}>LifePilot Pro</Text>
              <Text style={styles.proBannerSub}>{t('settings.proBannerSub', { defaultValue: 'Unlock everything' })}</Text>
            </View>
            <ChevronRight color={ACCENT} size={17} />
          </TouchableOpacity>
        )}

        {/* ── AI credits ──
              Reachable when EITHER purchases or rewarded ads are available.
              This was gated on PLAYSTORE_MODE alone, which hid the FREE
              "watch an ad for credits" feature behind billing readiness even
              though the two are unrelated — the screen existed but nothing in
              the app could reach it. Purchase packs are gated separately,
              inside CreditStoreScreen. ── */}
        {(PLAYSTORE_MODE || isRewardedAdAvailable()) && (
          <>
            <SettingsSection label={t('settings.sectionAiCredits')} />
            <View style={styles.settingGroup}>
              <SettingRow
                icon={Zap}
                iconColor="#FFFFFF"
                label={t('settings.creditStoreLabel')}
                value={PLAYSTORE_MODE
                  ? t('settings.creditStoreValue')
                  : t('settings.creditStoreValueFree')}
                onPress={() => navigation.navigate('CreditStore')}
                isLast
              />
            </View>
          </>
        )}

        {/* ── Account ── */}
        <SettingsSection label={t('settings.sectionAccount')} />
        <View style={styles.settingGroup}>
          <SettingRow
            icon={User} iconColor="#FFFFFF" label={t('settings.displayNameLabel')} value={profile?.display_name}
            onPress={() => { setNewDisplayName(profile?.display_name || ''); setFormError(''); setShowNameModal(true); }}
          />
          <View style={styles.divider} />
          <SettingRow
            icon={UserCog} iconColor="#FFFFFF" label={t('settings.usernameLabel')} value={`@${profile?.username || t('settings.usernameNotSet')}`}
            onPress={() => {
              if (!canChangeUsername()) {
                Alert.alert(t('settings.tooSoonTitle'), t('settings.tooSoonMessage', { date: getNextUsernameChangeDate() }));
                return;
              }
              setNewUsername(profile?.username || ''); setFormError(''); setShowUsernameModal(true);
            }}
          />
          <View style={styles.divider} />
          <SettingRow
            icon={Calendar} iconColor="#FFFFFF" label={t('settings.dobLabel')} value={profile?.dob ? new Date(profile.dob).toLocaleDateString() : t('settings.dobNotSet')}
            onPress={() => {
              setNewDob(profile?.dob ? new Date(profile.dob) : new Date());
              setFormError('');
              setShowDobModal(true);
            }}
          />
          <SettingRow
            icon={Mail} iconColor="#FFFFFF" label={t('settings.emailLabel')} value={email}
            onPress={() => Alert.alert(t('settings.emailTitle'), t('settings.emailCannotChange'))}
          />
          <SettingRow
            icon={KeyRound} iconColor="#FFFFFF" label={t('settings.changePasswordLabel')}
            onPress={() => { setNewPassword(''); setConfirmPassword(''); setOtp(''); setPasswordStep('input'); setFormError(''); setShowPasswordModal(true); }}
            isLast
          />
        </View>

        {/* ── Appearance: the marketplace is the personalisation surface ── */}
        <SettingsSection label={t('settings.sectionPersonalization')} />
        <MarketplaceButton onPress={() => navigation.navigate('Marketplace', { userId: profile?.id })} />
        <Text style={styles.prefHint}>{t('settings.marketplaceHint')}</Text>

        {/* ── Preferences ── */}
        <SettingsSection label={t('settings.sectionPreferences')} />
        <View style={styles.settingGroup}>
          <SettingRow
            icon={Globe}
            iconColor="#FFFFFF"
            label={t('settings.language')}
            value={currentLanguageInfo.nativeLabel}
            onPress={() => setShowLanguageModal(true)}
          />
          <SettingRow
            icon={LayoutGrid}
            iconColor="#FFFFFF"
            label={t('widgetSettings.settingsEntryLabel')}
            onPress={() => navigation.navigate('WidgetSettings')}
          />
          <SettingRow
            icon={SnowIcon}
            iconColor="#FFFFFF"
            label={t('settings.autoStreakFreezeLabel')}
            rightComponent={
              <Switch
                value={streakFreezeEnabled}
                onValueChange={handleToggleStreakFreeze}
                trackColor={{ false: '#27272a', true: ACCENT + '55' }}
                thumbColor={streakFreezeEnabled ? ACCENT : '#52525b'}
              />
            }
            isLast
          />
        </View>
        <Text style={styles.prefHint}>
          {streakFreezeEnabled
            ? t('settings.streakFreezeSafeHint', {
              defaultValue: 'Costs exactly 500 safe XP per missed day and activates only when the whole gap is affordable. Your level and stones never drop.',
            })
            : t('settings.streakFreezeOffHint')}
        </Text>

        {HUSTLERS_ENABLED ? (
          <>
            <SettingsSection label={t('settings.sectionHustlers', { defaultValue: 'Hustlers' })} />
            <View style={styles.settingGroup}>
              <SettingRow
                icon={Trophy}
                iconColor="#FFFFFF"
                label={t('settings.leaderboardOptInLabel', { defaultValue: 'Appear on global ranking' })}
                rightComponent={(
                  <Switch
                    value={leaderboardOptIn}
                    onValueChange={handleToggleLeaderboard}
                    trackColor={{ false: '#27272a', true: ACCENT + '55' }}
                    thumbColor={leaderboardOptIn ? ACCENT : '#52525b'}
                  />
                )}
              />
              <SettingRow
                icon={EyeOff}
                iconColor="#FFFFFF"
                label={t('settings.ghostModeLabel', { defaultValue: 'Ghost mode' })}
                rightComponent={(
                  <Switch
                    value={ghostMode}
                    onValueChange={handleToggleGhost}
                    trackColor={{ false: '#27272a', true: ACCENT + '55' }}
                    thumbColor={ghostMode ? ACCENT : '#52525b'}
                  />
                )}
                isLast
              />
            </View>
            <Text style={styles.prefHint}>
              {ghostMode
                ? t('settings.ghostModeOnHint', { defaultValue: 'Hidden from the global ranking. Your hustlers can still see your stats.' })
                : leaderboardOptIn
                  ? t('settings.leaderboardOnHint', { defaultValue: 'Your name, photo and hours are visible to everyone on the ranking.' })
                  : t('settings.leaderboardOffHint', { defaultValue: 'You are off the global ranking. Only accepted hustlers can see your stats.' })}
            </Text>
          </>
        ) : null}

        {/* ── System: device-level state and maintenance ── */}
        <SettingsSection label={t('settings.sectionSystem', { defaultValue: 'System' })} />
        <View style={styles.settingGroup}>
          <SettingRow
            icon={pendingSyncCount > 0 || syncIssueCount > 0 ? CloudOff : CheckCircle2}
            iconColor={syncIssueCount > 0 ? '#FB7185' : (pendingSyncCount > 0 ? '#FBBF24' : '#34D399')}
            valueColor={syncIssueCount > 0 ? '#FB7185' : (pendingSyncCount > 0 ? '#FBBF24' : '#34D399')}
            label={t('settings.syncStatusLabel')}
            value={
              syncIssueCount > 0
                ? t('settings.syncFailedToSave', { count: syncIssueCount })
                : pendingSyncCount > 0
                  ? `${t('settings.syncWaitingToSync', { count: pendingSyncCount })}${syncConnectivity.connectivityKnown && !syncConnectivity.online
                    ? ` · ${t('common.offline', { defaultValue: 'Offline' })}`
                    : ''}`
                  : t('settings.syncAllSaved')
            }
            onPress={pendingSyncCount > 0
              ? handleSyncNow
              : () => { handleViewSyncIssues().catch(() => {}); }}
            rightComponent={syncing ? <ActivityIndicator size="small" color={ACCENT} /> : undefined}
          />
          <SettingRow
            icon={RefreshCw}
            iconColor="#FFFFFF"
            label={t('settings.checkForUpdatesLabel')}
            onPress={handleCheckForUpdates}
            rightComponent={checkingUpdate ? <ActivityIndicator size="small" color={ACCENT} /> : undefined}
          />
          <SettingRow
            icon={Shield}
            iconColor="#FFFFFF"
            label={t('settings.permissionsHubLabel')}
            onPress={() => navigation.navigate('Permissions')}
            isLast
          />
        </View>

        {/* ── Support ── */}
        <SettingsSection label={t('settings.sectionSupport', { defaultValue: 'Support' })} />
        <View style={styles.settingGroup}>
          <SettingRow
            icon={MessageSquare}
            iconColor="#FFFFFF"
            label={t('settings.feedbackLabel')}
            onPress={() => navigation.navigate('Feedback')}
          />
          {/* Paired deliberately: What's New is the record of this build, What's
              Coming is the roadmap. Sitting together they read as one "where the
              app is going" pair rather than two unrelated rows. */}
          <SettingRow
            icon={Sparkles}
            iconColor="#FFFFFF"
            label={t('settings.whatsNewLabel', { defaultValue: "What's New" })}
            value={Constants.expoConfig?.version}
            onPress={() => navigation.navigate('WhatsNew')}
          />
          <SettingRow
            icon={Rocket}
            iconColor="#FFFFFF"
            label={t('settings.comingSoonLabel')}
            onPress={() => navigation.navigate('ComingSoon')}
            isLast
          />
        </View>

        {/* ── Danger zone ── */}
        <SettingsSection label={t('settings.sectionDangerZone')} tone="#FB7185" />
        <View style={styles.settingGroup}>
          <SettingRow icon={LogOut} iconColor="#FB7185" label={t('settings.logOutLabel')} danger onPress={() => {
            Alert.alert(t('settings.logOutConfirmTitle'), t('settings.logOutConfirmMessage'), [
              { text: t('settings.cancel'), style: 'cancel' },
              { text: t('settings.logOutLabel'), style: 'destructive', onPress: handleLogout },
            ]);
          }} />
          <SettingRow icon={Trash2} iconColor="#FB7185" label={t('settings.deleteAccountLabel')} danger
            onPress={() => { setDeleteConfirmText(''); setFormError(''); setShowDeleteModal(true); }}
            isLast
          />
        </View>

        {/* ─── Brand footer: wordmark, version, dedication ─── */}
        <View style={styles.brandFooter}>
          <Text style={styles.brandWordmark}>
            <Text style={styles.brandDouble}>double</Text>
            <Text style={[styles.brandThree, { color: ACCENT }]}>three</Text>
          </Text>
          <Text style={styles.brandVersion}>
            {t('settings.brandVersion', { version: Constants.expoConfig?.version || '1.0.0' })}
          </Text>
          <Text style={[styles.brandJasper, { color: ACCENT }]}>
            {t('settings.brandJasper')}
          </Text>
        </View>

        {/* Flush to the bottom edge: no wrapper padding, no trailing spacer, so
            scrolling to the end lands on the artwork instead of black space. */}
        <JasperTribute />
      </ScrollView>

      {/* ─── Avatar Options Modal ────────────────────── */}
      <BottomModal visible={showAvatarOptions} onClose={() => setShowAvatarOptions(false)} title={t('settings.profilePhotoTitle')}>
        <TouchableOpacity style={styles.avatarOption} onPress={handlePickAvatar}>
          <View style={[styles.settingIconWrap, { backgroundColor: '#9CA3AF20' }]}>
            <ImagePlus color="#9CA3AF" size={20} />
          </View>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>{t('settings.uploadPhoto')}</Text>
            <Text style={styles.modalHint}>{t('settings.maxSizeHint', { size: MAX_AVATAR_SIZE_MB })}</Text>
          </View>
        </TouchableOpacity>
        {profile?.avatar_url && (
          <TouchableOpacity style={styles.avatarOption} onPress={handleRemoveAvatar}>
            <View style={[styles.settingIconWrap, { backgroundColor: '#A1A1AA20' }]}>
              <Trash2 color="#A1A1AA" size={20} />
            </View>
            <Text style={[styles.settingLabel, { color: '#A1A1AA' }]}>{t('settings.removePhoto')}</Text>
          </TouchableOpacity>
        )}
      </BottomModal>

      {/* ─── Change Name Modal ───────────────────────── */}
      <BottomModal visible={showNameModal} onClose={() => setShowNameModal(false)} title={t('settings.changeDisplayNameTitle')}>
        <TextInput
          style={styles.modalInput} value={newDisplayName} onChangeText={setNewDisplayName}
          placeholder={t('settings.enterNewNamePlaceholder')} placeholderTextColor="#666" autoFocus
        />
        {formError ? <Text style={styles.formError}>{formError}</Text> : null}
        <TouchableOpacity style={styles.modalBtn} onPress={handleChangeName} disabled={formLoading}>
          {formLoading ? <ActivityIndicator color="#000" /> : <Text style={styles.modalBtnText}>{t('settings.saveChanges')}</Text>}
        </TouchableOpacity>
      </BottomModal>

      {/* ─── Change DOB ───────────────────────── */}
      {Platform.OS === 'android' && showDobModal && (
        <DateTimePicker
          value={newDob}
          mode="date"
          display="default"
          maximumDate={new Date()}
          onChange={(event, selectedDate) => {
            setShowDobModal(false);
            if (event.type === 'set' && selectedDate) {
              setNewDob(selectedDate);
              // Run update async without blocking the UI thread
              updateProfile(userId, profile, { dob: selectedDate.toISOString().split('T')[0] })
                .then(updated => setProfile(updated))
                .catch(e => Alert.alert(t('settings.errorTitle'), e.message || t('settings.dobUpdateFailedError')));
            }
          }}
        />
      )}

      {Platform.OS === 'ios' && (
        <BottomModal visible={showDobModal} onClose={() => setShowDobModal(false)} title={t('settings.updateDobTitle')}>
          <View style={{ alignItems: 'center', marginBottom: 20 }}>
            <DateTimePicker
              value={newDob}
              mode="date"
              display="spinner"
              maximumDate={new Date()}
              onChange={(event, selectedDate) => {
                if (selectedDate) setNewDob(selectedDate);
              }}
              textColor={THEME_COLOR}
            />
          </View>
          {formError ? <Text style={styles.formError}>{formError}</Text> : null}
          <TouchableOpacity style={styles.modalBtn} onPress={handleChangeDob} disabled={formLoading}>
            {formLoading ? <ActivityIndicator color="#000" /> : <Text style={styles.modalBtnText}>{t('settings.saveChanges')}</Text>}
          </TouchableOpacity>
        </BottomModal>
      )}

      {/* ─── Change Username Modal ───────────────────── */}
      <BottomModal visible={showUsernameModal} onClose={() => setShowUsernameModal(false)} title={t('settings.changeUsernameTitle')}>
        <Text style={styles.modalHint}>{t('settings.usernameChangeLimitHint')}</Text>
        <View style={styles.usernameInputRow}>
          <Text style={styles.usernamePrefix}>@</Text>
          <TextInput
            style={[styles.modalInput, { flex: 1, borderWidth: 0, backgroundColor: 'transparent', paddingLeft: 8 }]} value={newUsername}
            onChangeText={(text) => setNewUsername(text.toLowerCase().replace(/[^a-z0-9._]/g, ''))}
            placeholder={t('settings.newUsernamePlaceholder')} placeholderTextColor="#666" autoCapitalize="none" autoCorrect={false} autoFocus
          />
        </View>
        {formError ? <Text style={styles.formError}>{formError}</Text> : null}
        <TouchableOpacity style={styles.modalBtn} onPress={handleChangeUsername} disabled={formLoading}>
          {formLoading ? <ActivityIndicator color="#000" /> : <Text style={styles.modalBtnText}>{t('settings.saveChanges')}</Text>}
        </TouchableOpacity>
      </BottomModal>

      {/* ─── Change Password Modal ────────────────────── */}
      <BottomModal
        visible={showPasswordModal}
        onClose={() => { setShowPasswordModal(false); setPasswordStep('input'); }}
        title={t('settings.changePasswordTitle')}
      >
        {passwordStep === 'input' ? (
          <>
            <TextInput
              style={styles.modalInput} value={newPassword} onChangeText={setNewPassword}
              placeholder={t('settings.newPasswordPlaceholder')} placeholderTextColor="#666" secureTextEntry autoFocus
            />
            <TextInput
              style={[styles.modalInput, { marginTop: 12 }]} value={confirmPassword} onChangeText={setConfirmPassword}
              placeholder={t('settings.repeatPasswordPlaceholder')} placeholderTextColor="#666" secureTextEntry
            />
            {formError ? <Text style={styles.formError}>{formError}</Text> : null}
            <TouchableOpacity style={styles.modalBtn} onPress={handleRequestOtp} disabled={formLoading}>
              {formLoading
                ? <ActivityIndicator color="#000" />
                : <Text style={styles.modalBtnText}>{t('settings.sendVerificationCode')}</Text>}
            </TouchableOpacity>
            <Text style={styles.otpHint}>{t('settings.otpSentHint', { email })}</Text>
          </>
        ) : (
          <>
            <View style={styles.otpSentBanner}>
              <Mail color="#34D399" size={20} />
              <Text style={styles.otpSentText}>{t('settings.codeSentTo', { email })}</Text>
            </View>
            <Text style={[styles.modalHint, { marginTop: 16 }]}>{t('settings.enterVerificationCode')}</Text>
            <TextInput
              style={[styles.modalInput, styles.otpInput]} value={otp} onChangeText={setOtp}
              placeholder="000000" placeholderTextColor="#444" keyboardType="number-pad"
              maxLength={6} autoFocus textAlign="center"
            />
            {formError ? <Text style={styles.formError}>{formError}</Text> : null}
            <TouchableOpacity
              style={[styles.modalBtn, otp.length < 6 && { backgroundColor: '#333' }]}
              onPress={handleVerifyOtpAndChangePassword}
              disabled={formLoading || otp.length < 6}
            >
              {formLoading
                ? <ActivityIndicator color="#000" />
                : <Text style={[styles.modalBtnText, otp.length < 6 && { color: '#666' }]}>{t('settings.verifyAndChangePassword')}</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={handleResendOtp} disabled={otpTimer > 0} style={styles.resendBtn}>
              <Text style={[styles.resendText, otpTimer > 0 && { color: '#555' }]}>
                {otpTimer > 0 ? t('settings.resendCodeIn', { seconds: otpTimer }) : t('settings.resendCode')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setPasswordStep('input'); setFormError(''); }} style={{ marginTop: 12 }}>
              <Text style={styles.resendText}>{t('settings.backButton')}</Text>
            </TouchableOpacity>
          </>
        )}
      </BottomModal>

      {/* ─── Delete Account Modal ────────────────────── */}
      <BottomModal visible={showDeleteModal} onClose={() => setShowDeleteModal(false)} title={t('settings.deleteAccountTitle')}>
        <View style={styles.deleteWarning}>
          <Shield color="#FB7185" size={28} />
          <Text style={styles.deleteWarningText}>
            {t('settings.deleteAccountWarning')}
          </Text>
        </View>
        <Text style={styles.modalHint}>{t('settings.typeDeleteToConfirm')}</Text>
        <TextInput
          style={[styles.modalInput, { borderColor: '#FB7185', color: '#FB7185' }]} value={deleteConfirmText}
          onChangeText={setDeleteConfirmText} placeholder="DELETE" placeholderTextColor="#FB718566"
          autoCapitalize="characters" autoFocus
        />
        {formError ? <Text style={styles.formError}>{formError}</Text> : null}
        <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#FB7185' }]} onPress={handleDeleteAccount} disabled={formLoading}>
          {formLoading ? <ActivityIndicator color="#fff" /> : <Text style={[styles.modalBtnText, { color: '#fff' }]}>{t('settings.deleteMyAccount')}</Text>}
        </TouchableOpacity>
      </BottomModal>

      <GlassSidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        profile={profile}
        handleLogout={handleLogout}
        navigation={navigation}
        currentRoute="Settings"
      />

      <LanguagePickerModal
        isVisible={showLanguageModal}
        onClose={() => setShowLanguageModal(false)}
        currentCode={currentLanguage}
        onSelect={handleSelectLanguage}
      />
    </View>
  );
};

// ─── Setting Row Component ────────────────────────────
// Bare icon, label, and a right-aligned value. The old filled icon tile on
// every row made long lists read as a wall of coloured chips; the icon now
// carries the accent on its own and the value sits inline.
const SettingRow = ({ icon: Icon, iconColor, valueColor, label, value, onPress, danger, isLast, rightComponent }) => {
  const accent = useTheme().theme.accent;
  const tint = (!iconColor || iconColor === '#FFFFFF') ? accent : iconColor;
  const dangerColor = '#FB7185';
  return (
    <TouchableOpacity
      style={[styles.settingRow, !isLast && styles.settingRowDivided]}
      onPress={onPress}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityValue={value ? { text: String(value) } : undefined}
    >
      <Icon color={danger ? dangerColor : tint} size={18} />
      <Text style={[styles.settingLabel, danger && { color: dangerColor }]} numberOfLines={1}>
        {label}
      </Text>
      {value ? (
        <Text
          style={[styles.settingValue, valueColor && { color: valueColor }]}
          numberOfLines={1}
        >
          {value}
        </Text>
      ) : null}
      {rightComponent || (!danger && <ChevronRight color="#3F3F46" size={17} />)}
    </TouchableOpacity>
  );
};

/** Tracked micro-caption used to separate groups of rows. */
const SettingsSection = ({ label, tone }) => (
  <Text style={[styles.sectionTitle, tone && { color: tone }]}>{label}</Text>
);

// ─── Bottom Sheet Modal ───────────────────────────────
const BottomModal = ({ visible, onClose, title, children }) => (
  <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={styles.modalOverlay}>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
      <View style={styles.modalContent}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{title}</Text>
          <TouchableOpacity onPress={onClose} style={styles.modalCloseIcon}>
            <X color="#888" size={22} />
          </TouchableOpacity>
        </View>
        {children}
      </View>
    </View>
  </Modal>
);

// ─── Styles ─────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DARK_BG },

  // ─── Brand Footer ───
  brandFooter: {
    alignItems: 'center',
    paddingVertical: 26,
    marginTop: 16,
  },
  brandWordmark: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  brandDouble: {
    color: '#71717A',
  },
  brandThree: {
    color: '#FFFFFF',
  },
  brandVersion: {
    color: '#3F3F46',
    fontSize: 10,
    fontWeight: '400',
    letterSpacing: 0.4,
    marginTop: 5,
  },
  brandJasperSpacer: { height: 10 },
  brandJasper: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '400',
    fontStyle: 'italic',
    marginTop: 8,
    opacity: 0.7,
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: DARK_BG,
  },
  iconButton: { padding: 6 },
  headerTitle: { color: THEME_COLOR, fontSize: 15, fontWeight: '500', letterSpacing: 0.2 },
  scroll: { paddingBottom: 0 },

  // ── Identity row ──
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    marginTop: 8,
    marginBottom: 26,
  },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: CARD_BG,
  },
  avatarLoading: { alignItems: 'center', justifyContent: 'center' },
  cameraBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: DARK_BG,
  },
  profileInfo: { flex: 1 },
  profileName: {
    color: THEME_COLOR,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '400',
    letterSpacing: -0.2,
  },
  profileUsername: {
    color: '#8A8A93',
    fontSize: 13,
    fontWeight: '400',
    marginTop: 2,
  },
  profileEmail: {
    color: '#55555C',
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },

  proBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginHorizontal: 20,
    marginBottom: 10,
  },
  proBannerTitle: {
    color: '#FAFAFA',
    fontSize: 14,
    fontWeight: '500',
  },
  proBannerSub: {
    color: '#71717A',
    fontSize: 11.5,
    marginTop: 2,
    fontWeight: '400',
  },
  prefHint: {
    color: '#55555C',
    fontSize: 11.5,
    fontWeight: '400',
    paddingHorizontal: 20,
    marginTop: 8,
    lineHeight: 16,
  },

  // ── Sections ──
  sectionTitle: {
    color: '#5F5F66',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.3,
    marginBottom: 6,
    marginLeft: 20,
    marginTop: 26,
    textTransform: 'uppercase',
  },
  // Rows sit on the page separated by hairlines rather than inside a bordered
  // card, so a long settings list stops reading as a stack of heavy boxes.
  settingGroup: {
    paddingHorizontal: 20,
  },

  // ── Rows ──
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 52,
    paddingVertical: 13,
  },
  settingRowDivided: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER_COLOR,
  },
  settingLabel: {
    flex: 1,
    color: THEME_COLOR,
    fontSize: 14.5,
    fontWeight: '400',
  },
  settingValue: {
    color: '#77777F',
    fontSize: 13,
    fontWeight: '400',
    maxWidth: '45%',
    textAlign: 'right',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: BORDER_COLOR,
  },

  // Avatar Options
  avatarOption: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingVertical: 16, 
    paddingHorizontal: 6 
  },

  // Modal
  modalOverlay: { 
    flex: 1, 
    backgroundColor: 'rgba(0,0,0,0.85)', 
    justifyContent: 'flex-end' 
  },
  modalContent: {
    backgroundColor: CARD_BG,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 28,
    borderTopWidth: 1,
    borderTopColor: BORDER_COLOR,
  },
  modalHandle: { 
    width: 36, 
    height: 4, 
    borderRadius: 2, 
    backgroundColor: '#333', 
    alignSelf: 'center', 
    marginBottom: 24 
  },
  modalHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 24 
  },
  modalTitle: { 
    color: THEME_COLOR, 
    fontSize: 22, 
    fontWeight: '700',
    letterSpacing: 0.3 
  },
  modalCloseIcon: { 
    backgroundColor: BORDER_COLOR, 
    padding: 8, 
    borderRadius: 20 
  },
  modalHint: { 
    color: '#777', 
    fontSize: 14, 
    fontWeight: '500', 
    marginBottom: 14,
    lineHeight: 20 
  },
  modalInput: {
    backgroundColor: DARK_BG,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 16,
    color: THEME_COLOR,
    fontSize: 16,
    fontWeight: '500',
    borderWidth: 1.5,
    borderColor: BORDER_COLOR,
  },
  modalBtn: { 
    alignItems: 'center', 
    paddingVertical: 18, 
    borderRadius: 16, 
    marginTop: 24, 
    backgroundColor: THEME_COLOR,
    shadowColor: THEME_COLOR,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  modalBtnText: { 
    color: DARK_BG, 
    fontSize: 17, 
    fontWeight: '700',
    letterSpacing: 0.3 
  },
  formError: {
    color: '#FB7185',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 10,
    marginLeft: 4
  },

  // Username
  usernameInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: DARK_BG,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: BORDER_COLOR,
    paddingLeft: 18
  },
  usernamePrefix: {
    color: '#777',
    fontSize: 18,
    fontWeight: '600'
  },

  // OTP / Password
  otpHint: {
    color: '#666',
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 18,
    lineHeight: 20
  },
  otpSentBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#34D39918',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#34D39930'
  },
  otpSentText: {
    color: '#34D399',
    fontSize: 15,
    fontWeight: '600',
    flex: 1
  },
  otpInput: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: 12,
    paddingVertical: 22,
    textAlign: 'center'
  },
  resendBtn: {
    alignItems: 'center',
    marginTop: 20
  },
  resendText: {
    color: '#888',
    fontSize: 15,
    fontWeight: '600'
  },

  // Delete
  deleteWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: '#FB718512',
    padding: 18,
    borderRadius: 14,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#FB718530'
  },
  deleteWarningText: {
    flex: 1,
    color: '#FB7185',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 22
  },
});
