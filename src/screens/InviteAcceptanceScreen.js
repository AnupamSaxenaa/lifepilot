import { ArrowLeft, CheckCircle2, CloudOff, Link2Off, UserX } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    StyleSheet,
    Text,
    TouchableOpacity,
    useWindowDimensions,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import * as Collaboration from '../lib/collaborationManager';
import { supabase } from '../lib/supabase';

const inviteProblem = (error) => {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  if (code === 'OFFLINE' || /internet|network|failed to fetch/.test(message)) {
    return { kind: 'offline', title: 'You’re offline', message: 'Connect to the internet, then try accepting again.' };
  }
  if (code === '42501' || /another user|another account|email does not match|different account/.test(message)) {
    return { kind: 'wrong-account', title: 'Different account required', message: 'This invitation belongs to a different LifePilot account.' };
  }
  if (code === '22023' || /expired|not pending|revoked|no longer active/.test(message)) {
    return { kind: 'expired', title: 'Invite unavailable', message: 'This invitation has expired or is no longer active.' };
  }
  if (code === 'P0002' || /not found|invalid token/.test(message)) {
    return { kind: 'invalid', title: 'Invite not found', message: 'This invitation link is invalid or no longer available.' };
  }
  return { kind: 'error', title: 'Couldn’t accept invite', message: 'Please try again in a moment.' };
};

const loginParams = (token) => ({ inviteToken: token, returnTo: 'InviteAcceptance' });

export const InviteAcceptanceScreen = ({ navigation, route }) => {
  const token = route?.params?.token;
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { theme } = useTheme();
  const mounted = useRef(true);
  const [userId, setUserId] = useState(null);
  const [status, setStatus] = useState(token ? 'checking' : 'invalid');
  const [problem, setProblem] = useState(token ? null : inviteProblem({ code: 'P0002' }));
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const checkSession = useCallback(async () => {
    if (!token) return;
    setStatus('checking');
    setProblem(null);
    try {
      // getSession reads Supabase's persisted auth session; no application table is queried.
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      const sessionUserId = data?.session?.user?.id || null;
      if (!mounted.current) return;
      if (!sessionUserId) {
        navigation.replace('Login', loginParams(token));
        return;
      }
      setUserId(sessionUserId);
      setStatus('ready');
    } catch (_error) {
      if (!mounted.current) return;
      setProblem({ kind: 'auth', title: 'Couldn’t check your account', message: 'Check your connection and try again.' });
      setStatus('error');
    }
  }, [navigation, token]);

  useEffect(() => {
    mounted.current = true;
    const timer = setTimeout(checkSession, 0);
    return () => {
      clearTimeout(timer);
      mounted.current = false;
    };
  }, [checkSession]);

  const acceptInvite = useCallback(async () => {
    if (!token || !userId || status === 'accepting') return;
    setStatus('accepting');
    setProblem(null);
    try {
      // This manager call is online-only and does not queue or persist invite secrets.
      const accepted = await Collaboration.acceptSpaceInvite(token);
      const fresh = await Collaboration.refreshCollaboration(userId);
      if (!mounted.current) return;

      const acceptedSpaceId = accepted?.space_id ?? accepted?.spaceId;
      const acceptedListId = accepted?.list_id ?? accepted?.listId;
      const sharedList = (fresh?.lists || []).find((list) => (
        acceptedListId != null && String(list?.id) === String(acceptedListId)
      )) || (fresh?.lists || []).find((list) => (
        acceptedSpaceId != null && String(list?.space_id) === String(acceptedSpaceId)
      ));
      const destination = sharedList
        ? {
            name: 'CustomList',
            params: {
              listId: sharedList.id,
              listName: sharedList.name || 'Shared list',
              userId,
              spaceId: sharedList.space_id ?? acceptedSpaceId,
            },
          }
        : { name: 'Dashboard' };
      navigation.reset({ index: 0, routes: [destination] });
    } catch (error) {
      if (!mounted.current) return;
      setProblem(inviteProblem(error));
      setStatus('error');
    }
  }, [navigation, status, token, userId]);

  const retry = problem?.kind === 'auth' ? checkSession : acceptInvite;
  const canRetry = ['offline', 'error', 'auth'].includes(problem?.kind);
  const isBusy = status === 'checking' || status === 'accepting';
  const Icon = problem?.kind === 'offline'
    ? CloudOff
    : problem?.kind === 'wrong-account'
      ? UserX
      : problem?.kind === 'expired' || problem?.kind === 'invalid'
        ? Link2Off
        : CheckCircle2;

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityLabel="Go back"
          accessibilityRole="button"
          hitSlop={12}
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <ArrowLeft color={theme.text} size={22} />
        </TouchableOpacity>
        <Text maxFontSizeMultiplier={1.5} style={styles.headerTitle}>Shared invitation</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.center}>
        <View style={[styles.card, { maxWidth: Math.min(440, width - 32) }]}>
          <View style={styles.iconWrap}>
            <Icon color={problem ? (theme.danger || theme.muted) : theme.accent} size={34} />
          </View>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.5} style={styles.title}>
            {problem?.title || 'Join a shared list'}
          </Text>
          <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.6} style={styles.message}>
            {problem?.message || 'Accept this invitation to collaborate in LifePilot.'}
          </Text>

          {isBusy ? (
            <View accessibilityLiveRegion="polite" style={styles.busyRow}>
              <ActivityIndicator color={theme.accent} size="small" />
              <Text maxFontSizeMultiplier={1.5} style={styles.busyText}>
                {status === 'checking' ? 'Checking your account…' : 'Accepting invitation…'}
              </Text>
            </View>
          ) : status === 'ready' || canRetry ? (
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.82}
              onPress={status === 'ready' ? acceptInvite : retry}
              style={styles.primaryButton}
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.primaryButtonText}>
                {status === 'ready' ? 'Accept invitation' : 'Try again'}
              </Text>
            </TouchableOpacity>
          ) : null}

          {problem?.kind === 'wrong-account' ? (
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => navigation.replace('Login', loginParams(token))}
              style={styles.secondaryButton}
            >
              <Text maxFontSizeMultiplier={1.5} style={styles.secondaryButtonText}>Sign in with another account</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  );
};

const makeStyles = (theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  header: { alignItems: 'center', flexDirection: 'row', height: 58, paddingHorizontal: 16 },
  backButton: { alignItems: 'center', borderColor: theme.hairline || theme.surface, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, height: 36, justifyContent: 'center', width: 36 },
  headerTitle: { color: theme.text, flex: 1, fontSize: 16, textAlign: 'center' },
  headerSpacer: { width: 36 },
  center: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 16 },
  card: { alignItems: 'center', backgroundColor: theme.surface, borderColor: theme.hairline || 'rgba(127,127,127,0.18)', borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 24, paddingVertical: 30, width: '100%' },
  iconWrap: { alignItems: 'center', backgroundColor: 'rgba(127,127,127,0.10)', borderRadius: 28, height: 56, justifyContent: 'center', marginBottom: 20, width: 56 },
  title: { color: theme.text, fontSize: 23, fontWeight: '600', textAlign: 'center' },
  message: { color: theme.muted, fontSize: 15, lineHeight: 22, marginTop: 10, maxWidth: 330, textAlign: 'center' },
  busyRow: { alignItems: 'center', flexDirection: 'row', gap: 10, marginTop: 26 },
  busyText: { color: theme.muted, fontSize: 14 },
  primaryButton: { alignItems: 'center', backgroundColor: theme.accent, borderRadius: 14, marginTop: 26, minHeight: 48, justifyContent: 'center', paddingHorizontal: 22, width: '100%' },
  primaryButtonText: { color: theme.onAccent || theme.bg, fontSize: 15, fontWeight: '600' },
  secondaryButton: { marginTop: 12, minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 },
  secondaryButtonText: { color: theme.text, fontSize: 14, textAlign: 'center' },
});

export default InviteAcceptanceScreen;