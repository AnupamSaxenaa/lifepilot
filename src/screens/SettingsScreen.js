import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import {
  Camera, ChevronRight, ImagePlus, KeyRound, LogOut, Mail, Menu,
  Shield, Trash2, User, UserCog, X
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Modal, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassSidebar } from '../components/GlassSidebar';
import { deleteUserAccountData, loadProfile, updateProfile } from '../lib/dataManager';
import { supabase } from '../lib/supabase';
import { Storage } from '../utils/storage';

const THEME_COLOR = '#FFFFFF';
const DARK_BG = '#000000';
const CARD_BG = '#0A0A0A';
const BORDER_COLOR = '#1A1A1A';

const MAX_AVATAR_SIZE_MB = 2;
const MAX_AVATAR_SIZE_BYTES = MAX_AVATAR_SIZE_MB * 1024 * 1024;

export const SettingsScreen = ({ navigation }) => {
  const insets = useSafeAreaInsets();

  const [profile, setProfile] = useState(null);
  const [email, setEmail] = useState('');
  const [userId, setUserId] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [avatarUploading, setAvatarUploading] = useState(false);

  // ─── Modal States ─────────────────────────────────────
  const [showNameModal, setShowNameModal] = useState(false);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showAvatarOptions, setShowAvatarOptions] = useState(false);

  // ─── Form States ──────────────────────────────────────
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [formError, setFormError] = useState('');
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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setUserId(session.user.id);
      setEmail(session.user.email);

      // Load profile: cache first → Supabase background
      const cached = await loadProfile(session.user.id, (fresh) => {
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
    setShowAvatarOptions(false);

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Please allow access to your photo library.');
      return;
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
      Alert.alert('File too large', `Max avatar size is ${MAX_AVATAR_SIZE_MB}MB. Please choose a smaller image.`);
      return;
    }

    setAvatarUploading(true);

    try {
      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (!base64 || base64.length < 100) {
        Alert.alert('Error', 'Could not read the image file.');
        setAvatarUploading(false);
        return;
      }

      const approxBytes = (base64.length * 3) / 4;
      if (approxBytes > MAX_AVATAR_SIZE_BYTES) {
        Alert.alert('File too large', `Max avatar size is ${MAX_AVATAR_SIZE_MB}MB.`);
        setAvatarUploading(false);
        return;
      }

      const fileName = `${userId}/avatar.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('avatar')
        .upload(fileName, decode(base64), {
          contentType: 'image/jpeg',
          upsert: true,
        });

      if (uploadError) {
        console.log('Supabase upload error:', JSON.stringify(uploadError));
        Alert.alert('Upload failed', uploadError.message || 'Unknown storage error. Check that the "avatars" bucket exists and is public.');
        setAvatarUploading(false);
        return;
      }

      const { data: urlData } = supabase.storage
        .from('avatar')
        .getPublicUrl(fileName);

      const publicUrl = urlData.publicUrl + `?t=${Date.now()}`;

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', userId);

      if (updateError) {
        Alert.alert('Error', updateError.message);
      } else {
        const updated = { ...profile, avatar_url: publicUrl };
        setProfile(updated);
        Storage.set(`profile_${userId}`, updated);
        Alert.alert('Success', 'Avatar updated!');
      }
    } catch (e) {
      console.log('Avatar upload error:', e?.message || e);
      Alert.alert('Upload Error', e?.message || 'Something went wrong. Please try again.');
    }

    setAvatarUploading(false);
  };

  const handleRemoveAvatar = async () => {
    setShowAvatarOptions(false);
    setAvatarUploading(true);

    await supabase.storage.from('avatar').remove([`${userId}/avatar.jpg`, `${userId}/avatar.png`, `${userId}/avatar.jpeg`]);

    const seed = Math.random().toString(36).substring(7);
    await supabase.from('profiles').update({ avatar_url: null, avatar_seed: seed }).eq('id', userId);

    const updated = { ...profile, avatar_url: null, avatar_seed: seed };
    setProfile(updated);
    Storage.set(`profile_${userId}`, updated);
    setAvatarUploading(false);
    Alert.alert('Done', 'Avatar removed. A random avatar has been assigned.');
  };

  // ─── Change Display Name ──────────────────────────────
  const handleChangeName = async () => {
    if (!newDisplayName.trim()) { setFormError('Name cannot be empty'); return; }
    setFormLoading(true); setFormError('');
    try {
      const updated = await updateProfile(userId, profile, { display_name: newDisplayName.trim() });
      setProfile(updated);
      setFormLoading(false);
      setShowNameModal(false);
    } catch (e) {
      setFormError(e.message || 'Failed to update name');
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
    if (!username) { setFormError('Username cannot be empty'); return; }
    if (username.length < 3) { setFormError('Username must be at least 3 characters'); return; }
    if (!/^[a-z0-9._]+$/.test(username)) { setFormError('Only lowercase letters, numbers, dots and underscores'); return; }

    setFormLoading(true); setFormError('');

    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', username)
      .neq('id', userId)
      .maybeSingle();

    if (existing) { setFormError('Username is already taken'); setFormLoading(false); return; }

    try {
      const updated = await updateProfile(userId, profile, { username, username_changed_at: new Date().toISOString() });
      setProfile(updated);
      setFormLoading(false);
      setShowUsernameModal(false);
    } catch (e) {
      setFormError(e.message || 'Failed to update username');
      setFormLoading(false);
    }
  };

  // ─── Change Password (with OTP) ───────────────────────
  const handleRequestOtp = async () => {
    if (newPassword.length < 6) { setFormError('Password must be at least 6 characters'); return; }
    if (newPassword !== confirmPassword) { setFormError('Passwords do not match'); return; }

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
    if (otp.length < 6) { setFormError('Enter the 6-digit code from your email'); return; }

    setFormLoading(true); setFormError('');

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email,
      token: otp,
      type: 'email',
    });

    if (verifyError) {
      setFormError('Invalid or expired code. Please try again.');
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
    Alert.alert('Success', 'Password changed successfully!');
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
  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') { setFormError('Type DELETE to confirm'); return; }
    setFormLoading(true); setFormError('');

    await deleteUserAccountData(userId);
    await supabase.auth.signOut();
    await Storage.clear();
    navigation.replace('Onboarding');
  };

  // ─── Logout ───────────────────────────────────────────
  const handleLogout = async () => {
    navigation.reset({ index: 0, routes: [{ name: 'Onboarding' }] });
    supabase.auth.signOut();
  };

  if (loading) {
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
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Profile Header (Borderless, Centered) */}
        <View style={styles.profileHeader}>
          <TouchableOpacity onPress={() => setShowAvatarOptions(true)} style={styles.avatarWrap} disabled={avatarUploading}>
            {avatarUploading ? (
              <View style={[styles.avatar, { alignItems: 'center', justifyContent: 'center' }]}>
                <ActivityIndicator color="#fff" size="large" />
              </View>
            ) : (
              <Image source={getAvatarSource()} style={styles.avatar} />
            )}
            <View style={styles.cameraBadge}>
              <Camera color="#fff" size={14} />
            </View>
          </TouchableOpacity>
          <Text style={styles.profileName}>{profile?.display_name || 'User'}</Text>
          <Text style={styles.profileUsername}>@{profile?.username || 'username'}</Text>
          <Text style={styles.profileEmail}>{email}</Text>
        </View>

        {/* Group 1: Account */}
        <Text style={styles.sectionTitle}>ACCOUNT</Text>
        <View style={styles.settingGroup}>
          <SettingRow
            icon={User} iconColor="#3B82F6" label="Display Name" value={profile?.display_name}
            onPress={() => { setNewDisplayName(profile?.display_name || ''); setFormError(''); setShowNameModal(true); }}
          />
          <View style={styles.divider} />
          <SettingRow
            icon={UserCog} iconColor="#8B5CF6" label="Username" value={`@${profile?.username || 'not set'}`}
            onPress={() => {
              if (!canChangeUsername()) {
                Alert.alert('Too soon', `You can change your username again after ${getNextUsernameChangeDate()}`);
                return;
              }
              setNewUsername(profile?.username || ''); setFormError(''); setShowUsernameModal(true);
            }}
          />
          <View style={styles.divider} />
          <SettingRow
            icon={Mail} iconColor="#10B981" label="Email" value={email}
            onPress={() => Alert.alert('Email', 'Email cannot be changed from the app.')}
            isLast
          />
        </View>

        {/* Group 2: Security */}
        <Text style={styles.sectionTitle}>SECURITY</Text>
        <View style={styles.settingGroup}>
          <SettingRow
            icon={KeyRound} iconColor="#FFF" label="Change Password"
            onPress={() => { setNewPassword(''); setConfirmPassword(''); setOtp(''); setPasswordStep('input'); setFormError(''); setShowPasswordModal(true); }}
            isLast
          />
        </View>

        {/* Group 3: Danger Zone */}
        <Text style={[styles.sectionTitle, { color: '#EF4444' }]}>DANGER ZONE</Text>
        <View style={styles.settingGroup}>
          <SettingRow icon={LogOut} iconColor="#EF4444" label="Log Out" danger onPress={() => {
            Alert.alert('Log Out', 'Are you sure?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Log Out', style: 'destructive', onPress: handleLogout },
            ]);
          }} />
          <View style={styles.divider} />
          <SettingRow icon={Trash2} iconColor="#EF4444" label="Delete Account" danger
            onPress={() => { setDeleteConfirmText(''); setFormError(''); setShowDeleteModal(true); }}
            isLast
          />
        </View>

        <View style={{ height: 80 }} />
      </ScrollView>

      {/* ─── Avatar Options Modal ────────────────────── */}
      <BottomModal visible={showAvatarOptions} onClose={() => setShowAvatarOptions(false)} title="Profile Photo">
        <TouchableOpacity style={styles.avatarOption} onPress={handlePickAvatar}>
          <View style={[styles.settingIconWrap, { backgroundColor: '#3B82F620' }]}>
            <ImagePlus color="#3B82F6" size={20} />
          </View>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Upload Photo</Text>
            <Text style={styles.modalHint}>Max {MAX_AVATAR_SIZE_MB}MB · JPG, PNG</Text>
          </View>
        </TouchableOpacity>
        {profile?.avatar_url && (
          <TouchableOpacity style={styles.avatarOption} onPress={handleRemoveAvatar}>
            <View style={[styles.settingIconWrap, { backgroundColor: '#EF444420' }]}>
              <Trash2 color="#EF4444" size={20} />
            </View>
            <Text style={[styles.settingLabel, { color: '#EF4444' }]}>Remove Photo</Text>
          </TouchableOpacity>
        )}
      </BottomModal>

      {/* ─── Change Name Modal ───────────────────────── */}
      <BottomModal visible={showNameModal} onClose={() => setShowNameModal(false)} title="Change Display Name">
        <TextInput
          style={styles.modalInput} value={newDisplayName} onChangeText={setNewDisplayName}
          placeholder="Enter new name" placeholderTextColor="#666" autoFocus
        />
        {formError ? <Text style={styles.formError}>{formError}</Text> : null}
        <TouchableOpacity style={styles.modalBtn} onPress={handleChangeName} disabled={formLoading}>
          {formLoading ? <ActivityIndicator color="#000" /> : <Text style={styles.modalBtnText}>Save Changes</Text>}
        </TouchableOpacity>
      </BottomModal>

      {/* ─── Change Username Modal ───────────────────── */}
      <BottomModal visible={showUsernameModal} onClose={() => setShowUsernameModal(false)} title="Change Username">
        <Text style={styles.modalHint}>You can only change your username once every 30 days.</Text>
        <View style={styles.usernameInputRow}>
          <Text style={styles.usernamePrefix}>@</Text>
          <TextInput
            style={[styles.modalInput, { flex: 1, borderWidth: 0, backgroundColor: 'transparent', paddingLeft: 8 }]} value={newUsername}
            onChangeText={(t) => setNewUsername(t.toLowerCase().replace(/[^a-z0-9._]/g, ''))}
            placeholder="new_username" placeholderTextColor="#666" autoCapitalize="none" autoCorrect={false} autoFocus
          />
        </View>
        {formError ? <Text style={styles.formError}>{formError}</Text> : null}
        <TouchableOpacity style={styles.modalBtn} onPress={handleChangeUsername} disabled={formLoading}>
          {formLoading ? <ActivityIndicator color="#000" /> : <Text style={styles.modalBtnText}>Save Changes</Text>}
        </TouchableOpacity>
      </BottomModal>

      {/* ─── Change Password Modal ────────────────────── */}
      <BottomModal
        visible={showPasswordModal}
        onClose={() => { setShowPasswordModal(false); setPasswordStep('input'); }}
        title="Change Password"
      >
        {passwordStep === 'input' ? (
          <>
            <TextInput
              style={styles.modalInput} value={newPassword} onChangeText={setNewPassword}
              placeholder="New password" placeholderTextColor="#666" secureTextEntry autoFocus
            />
            <TextInput
              style={[styles.modalInput, { marginTop: 12 }]} value={confirmPassword} onChangeText={setConfirmPassword}
              placeholder="Repeat password" placeholderTextColor="#666" secureTextEntry
            />
            {formError ? <Text style={styles.formError}>{formError}</Text> : null}
            <TouchableOpacity style={styles.modalBtn} onPress={handleRequestOtp} disabled={formLoading}>
              {formLoading
                ? <ActivityIndicator color="#000" />
                : <Text style={styles.modalBtnText}>Send Verification Code</Text>}
            </TouchableOpacity>
            <Text style={styles.otpHint}>A 6-digit code will be sent to {email}</Text>
          </>
        ) : (
          <>
            <View style={styles.otpSentBanner}>
              <Mail color="#10B981" size={20} />
              <Text style={styles.otpSentText}>Code sent to {email}</Text>
            </View>
            <Text style={[styles.modalHint, { marginTop: 16 }]}>Enter the 6-digit verification code:</Text>
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
                : <Text style={[styles.modalBtnText, otp.length < 6 && { color: '#666' }]}>Verify & Change Password</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={handleResendOtp} disabled={otpTimer > 0} style={styles.resendBtn}>
              <Text style={[styles.resendText, otpTimer > 0 && { color: '#555' }]}>
                {otpTimer > 0 ? `Resend code in ${otpTimer}s` : 'Resend code'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setPasswordStep('input'); setFormError(''); }} style={{ marginTop: 12 }}>
              <Text style={styles.resendText}>← Back</Text>
            </TouchableOpacity>
          </>
        )}
      </BottomModal>

      {/* ─── Delete Account Modal ────────────────────── */}
      <BottomModal visible={showDeleteModal} onClose={() => setShowDeleteModal(false)} title="Delete Account">
        <View style={styles.deleteWarning}>
          <Shield color="#EF4444" size={28} />
          <Text style={styles.deleteWarningText}>
            This action is permanent and cannot be undone. All your tasks, profile data, and account will be permanently deleted.
          </Text>
        </View>
        <Text style={styles.modalHint}>Type DELETE to confirm:</Text>
        <TextInput
          style={[styles.modalInput, { borderColor: '#EF4444', color: '#EF4444' }]} value={deleteConfirmText}
          onChangeText={setDeleteConfirmText} placeholder="DELETE" placeholderTextColor="#EF444466"
          autoCapitalize="characters" autoFocus
        />
        {formError ? <Text style={styles.formError}>{formError}</Text> : null}
        <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#EF4444' }]} onPress={handleDeleteAccount} disabled={formLoading}>
          {formLoading ? <ActivityIndicator color="#fff" /> : <Text style={[styles.modalBtnText, { color: '#fff' }]}>Delete My Account</Text>}
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
    </View>
  );
};

// ─── Setting Row Component ────────────────────────────
const SettingRow = ({ icon: Icon, iconColor, label, value, onPress, danger, isLast }) => (
  <TouchableOpacity style={[styles.settingRow, isLast && { paddingBottom: 14 }]} onPress={onPress} activeOpacity={0.6}>
    <View style={[styles.settingIconWrap, { backgroundColor: (danger ? '#EF444420' : iconColor + '20') }]}>
      <Icon color={danger ? '#EF4444' : iconColor} size={18} />
    </View>
    <View style={styles.settingInfo}>
      <Text style={[styles.settingLabel, danger && { color: '#EF4444' }]}>{label}</Text>
      {value ? <Text style={styles.settingValue} numberOfLines={1}>{value}</Text> : null}
    </View>
    {!danger && <ChevronRight color="#444" size={20} />}
  </TouchableOpacity>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: DARK_BG,
  },
  iconButton: { padding: 6 },
  headerTitle: { color: THEME_COLOR, fontSize: 18, fontWeight: '700', letterSpacing: 0.5 },
  scroll: { paddingBottom: 60 },

  // Profile Header
  profileHeader: { alignItems: 'center', marginTop: 24, marginBottom: 36 },
  avatarWrap: { position: 'relative', marginBottom: 18 },
  avatar: { 
    width: 96, 
    height: 96, 
    borderRadius: 48, 
    backgroundColor: CARD_BG, 
    borderWidth: 3, 
    borderColor: BORDER_COLOR 
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: DARK_BG,
    shadowColor: "#3B82F6",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 5,
  },
  profileName: { 
    color: THEME_COLOR, 
    fontSize: 26, 
    fontWeight: '700', 
    marginBottom: 6,
    letterSpacing: 0.3 
  },
  profileUsername: { 
    color: '#888', 
    fontSize: 16, 
    fontWeight: '600', 
    marginBottom: 4 
  },
  profileEmail: { 
    color: '#555', 
    fontSize: 14, 
    fontWeight: '500' 
  },

  // Sections
  sectionTitle: { 
    color: '#666', 
    fontSize: 11, 
    fontWeight: '700', 
    letterSpacing: 1.2, 
    marginBottom: 12, 
    marginLeft: 24, 
    marginTop: 8,
    textTransform: 'uppercase' 
  },
  settingGroup: { 
    backgroundColor: CARD_BG, 
    borderRadius: 18, 
    marginHorizontal: 16, 
    marginBottom: 28,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
  },
  
  // Setting Rows
  settingRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingVertical: 16, 
    paddingRight: 16, 
    paddingLeft: 14 
  },
  settingIconWrap: { 
    width: 36, 
    height: 36, 
    borderRadius: 10, 
    alignItems: 'center', 
    justifyContent: 'center', 
    marginRight: 14 
  },
  settingInfo: { 
    flex: 1, 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between' 
  },
  settingLabel: { 
    color: THEME_COLOR, 
    fontSize: 16, 
    fontWeight: '600' 
  },
  settingValue: { 
    color: '#777', 
    fontSize: 15, 
    fontWeight: '500', 
    marginRight: 8 
  },
  divider: { 
    height: 1, 
    backgroundColor: BORDER_COLOR, 
    marginLeft: 64 
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
    color: '#EF4444', 
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
    backgroundColor: '#10B98118', 
    padding: 16, 
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#10B98130' 
  },
  otpSentText: { 
    color: '#10B981', 
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
    backgroundColor: '#EF444412', 
    padding: 18, 
    borderRadius: 14, 
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#EF444430' 
  },
  deleteWarningText: { 
    flex: 1, 
    color: '#EF4444', 
    fontSize: 14, 
    fontWeight: '600', 
    lineHeight: 22 
  },
});
