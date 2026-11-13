import * as Clipboard from 'expo-clipboard';
import {
  Clock3, Copy, Link2, Send, Share2, Trash2, UserMinus, UserRoundPlus,
  UserRoundX, X,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share,
  StyleSheet, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { buildInviteShareUrl } from '../../config/env';
import { useTheme } from '../../context/ThemeContext';
import {
  archiveSpace,
  changeSpaceMemberRole,
  createSpace,
  inviteSpaceMember,
  leaveSpace,
  linkListToSpace,
  loadSpaceInvites,
  removeSpaceMember,
  revokeSpaceInvite,
  transferSpaceOwnership,
} from '../../lib/collaborationManager';
import { MemberRow, getMemberName } from './MemberRow';
import { RolePicker } from './RolePicker';

const EXPIRIES = [
  { label: '1 day', days: 1 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
];
const idFor = (member) => member?.user_id || member?.id;
const errorMessage = (error) => error?.message || 'This online collaboration action failed.';
const idsMatch = (left, right) => left != null && right != null && String(left) === String(right);
const getInviteTarget = (invite) => {
  const username = invite?.username || invite?.invitee_username;
  if (username) return `@${username}`;
  return invite?.invitee_email || 'Invited account';
};
const formatInviteExpiry = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Expiry unavailable';
  return `Expires ${date.toLocaleString([], {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  })}`;
};

export const ShareListSheet = ({
  visible,
  onClose,
  userId,
  list,
  space,
  members = [],
  onChanged,
}) => {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  // This sheet predates the app's i18n and its copy is still hardcoded English.
  // The three destructive confirmations below are translated first: they are the
  // ones that irreversibly remove access, so they are the worst place to show a
  // user text they cannot read. The remaining notices and error strings in this
  // file are still English and want the same treatment.
  const { t } = useTranslation();
  const initialSpaceId = space?.id || list?.space_id || null;
  const [effectiveSpaceId, setEffectiveSpaceId] = useState(initialSpaceId);
  const [target, setTarget] = useState('');
  const [role, setRole] = useState('editor');
  const [expiry, setExpiry] = useState(7);
  const [inviteToken, setInviteToken] = useState(null);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [revokingInviteId, setRevokingInviteId] = useState(null);
  const [roleTarget, setRoleTarget] = useState(null);
  const [rolePickerVisible, setRolePickerVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const currentMember = members.find((member) => idsMatch(idFor(member), userId));
  const isPersonalList = !initialSpaceId;
  // Only the authoritative member directory grants owner controls. created_by
  // identifies the original creator and does not change after ownership transfer.
  const isOwner = isPersonalList || currentMember?.role === 'owner';
  const canInvite = Boolean(userId && list?.id && isOwner);
  const secureLink = inviteToken ? buildInviteShareUrl(inviteToken) : '';
  const visiblePendingInvites = pendingInvites.filter((invite) => invite?.status === 'pending');
  const border = theme.hairline || '#2A2A2E';
  const destructive = theme.danger || '#FF453A';

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      if (visible) {
        setEffectiveSpaceId(initialSpaceId);
        return;
      }
      setInviteToken(null);
      setPendingInvites([]);
      setRevokingInviteId(null);
      setRoleTarget(null);
      setRolePickerVisible(false);
      setError('');
      setNotice('');
    });
    return () => { active = false; };
  }, [initialSpaceId, visible]);

  useEffect(() => {
    let active = true;
    if (!visible || !userId || !effectiveSpaceId || !isOwner) {
      Promise.resolve().then(() => {
        if (active) setPendingInvites([]);
      });
      return () => { active = false; };
    }

    loadSpaceInvites(userId, effectiveSpaceId, (fresh) => {
      if (active) setPendingInvites(fresh);
    }).then((cached) => {
      if (active) setPendingInvites(cached);
    }).catch(() => {});

    return () => { active = false; };
  }, [effectiveSpaceId, isOwner, userId, visible]);

  const close = () => {
    setInviteToken(null);
    setPendingInvites([]);
    setRevokingInviteId(null);
    setTarget('');
    setError('');
    setNotice('');
    setRoleTarget(null);
    setRolePickerVisible(false);
    onClose?.();
  };

  const notifyChanged = async (result) => {
    await onChanged?.(result);
  };

  const createAndLinkSpace = async () => {
    if (effectiveSpaceId) return effectiveSpaceId;
    if (!list?.id) throw new Error('A saved personal list is required before sharing.');
    const created = await createSpace(list.name || 'Shared list');
    const createdSpaceId = created?.space_id || created?.id;
    if (!createdSpaceId) throw new Error('The shared space was created without an identifier.');
    await linkListToSpace(
      createdSpaceId,
      list.id,
      list.collaboration_version ?? list.version ?? 1,
    );
    setEffectiveSpaceId(createdSpaceId);
    await notifyChanged({
      type: 'list-linked',
      space_id: createdSpaceId,
      list_id: list.id,
    });
    return createdSpaceId;
  };

  const createInvitation = async () => {
    const cleanTarget = target.trim();
    const validTarget = cleanTarget.startsWith('@')
      ? cleanTarget.length > 1
      : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanTarget);
    if (!validTarget) {
      setError('Enter an exact @username or a valid email address.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    setInviteToken(null);
    try {
      const spaceId = await createAndLinkSpace();
      const result = await inviteSpaceMember(spaceId, cleanTarget, role, {
        expiresAt: new Date(Date.now() + expiry * 86400000).toISOString(),
        userId,
      });
      const rawToken = typeof result?.token === 'string' ? result.token : null;
      const shareUrl = rawToken ? buildInviteShareUrl(rawToken) : '';
      setInviteToken(rawToken);
      setTarget('');
      if (rawToken && !shareUrl) {
        setError('Invitation created, but the secure HTTPS invite page is not configured.');
      }
      setNotice(shareUrl
        ? 'Secure invite link ready. Copy or share it before closing.'
        : 'Invitation created. The one-time link is no longer available for this retry.');
      const cachedInvites = await loadSpaceInvites(userId, spaceId, setPendingInvites);
      setPendingInvites(cachedInvites);
      // Deliberately omit the raw token from callbacks, caches, logs, and analytics.
      await notifyChanged({
        type: 'invitation-created',
        invite_id: result?.invite_id,
        space_id: result?.space_id || spaceId,
        role: result?.role || role,
        expires_at: result?.expires_at,
        replayed: result?.replayed,
      });
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!secureLink) return;
    try {
      await Clipboard.setStringAsync(secureLink);
      setNotice('Secure invite link copied.');
    } catch (_error) {
      setError('The invite link could not be copied.');
    }
  };

  const shareLink = async () => {
    if (!secureLink) return;
    try {
      await Share.share({
        title: `Share ${list?.name || space?.name || 'list'}`,
        message: `Join ${list?.name || space?.name || 'this shared list'} in LifePilot: ${secureLink}`,
        url: secureLink,
      });
    } catch (_error) {
      setError('The native share sheet could not be opened.');
    }
  };

  const confirmRevokeInvite = (invite) => {
    const inviteTarget = getInviteTarget(invite);
    Alert.alert(
      'Revoke invitation?',
      `${inviteTarget} will no longer be able to accept this invitation.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            setRevokingInviteId(invite.id);
            setError('');
            setNotice('');
            try {
              const result = await revokeSpaceInvite(invite.id, invite.version || 1, {
                userId,
                spaceId: effectiveSpaceId,
              });
              setPendingInvites((current) => current.filter((item) => !idsMatch(item.id, invite.id)));
              setNotice(`Invitation for ${inviteTarget} revoked.`);
              await notifyChanged({
                type: 'invitation-revoked',
                invite_id: invite.id,
                space_id: effectiveSpaceId,
                version: result?.version,
              });
            } catch (actionError) {
              setError(errorMessage(actionError));
            } finally {
              setRevokingInviteId(null);
            }
          },
        },
      ],
    );
  };

  const runAdminAction = async (action, successMessage, shouldClose = false) => {
    setBusy(true);
    setError('');
    try {
      const result = await action();
      await notifyChanged(result);
      setNotice(successMessage);
      if (shouldClose) close();
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setBusy(false);
    }
  };

  const selectRole = async (nextRole) => {
    if (!roleTarget) {
      setRole(nextRole);
      return;
    }
    const selectedMember = roleTarget;
    setRoleTarget(null);
    await runAdminAction(
      () => changeSpaceMemberRole(
        effectiveSpaceId,
        idFor(selectedMember),
        nextRole,
        selectedMember.version || 1,
      ),
      `${getMemberName(selectedMember)} is now a ${nextRole}.`,
    );
  };

  const openMemberActions = (member) => {
    const name = getMemberName(member);
    Alert.alert(name, 'Choose a member action.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Transfer ownership',
        onPress: () => Alert.alert(
          'Transfer ownership?',
          `${name} will become the owner and you will become an editor.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Transfer',
              onPress: () => runAdminAction(
                () => transferSpaceOwnership(
                  effectiveSpaceId,
                  idFor(member),
                  space?.version || 1,
                  member.version || 1,
                ),
                `Ownership transferred to ${name}.`,
              ),
            },
          ],
        ),
      },
      {
        text: 'Remove member',
        style: 'destructive',
        onPress: () => Alert.alert(
          t('shareList.removeMemberTitle', { defaultValue: 'Remove member?' }),
          t('shareList.removeMemberMessage', {
            name,
            defaultValue: '{{name}} will lose access to this shared space.',
          }),
          [
            { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
            {
              text: t('shareList.removeMemberConfirm', { defaultValue: 'Remove' }),
              style: 'destructive',
              onPress: () => runAdminAction(
                () => removeSpaceMember(effectiveSpaceId, idFor(member), member.version || 1),
                t('shareList.removeMemberDone', { name, defaultValue: '{{name}} was removed.' }),
              ),
            },
          ],
        ),
      },
    ]);
  };

  const confirmLeave = () => Alert.alert(
    t('shareList.leaveTitle', { defaultValue: 'Leave shared space?' }),
    t('shareList.leaveMessage', { defaultValue: 'You will lose access to its shared lists and tasks.' }),
    [
      { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
      {
        text: t('shareList.leaveConfirm', { defaultValue: 'Leave' }),
        style: 'destructive',
        onPress: () => runAdminAction(
          () => leaveSpace(effectiveSpaceId, currentMember?.version || 1),
          t('shareList.leaveDone', { defaultValue: 'You left the shared space.' }),
          true,
        ),
      },
    ],
  );

  // Wording note: the RPC is a soft delete — it stamps `archived_at` and retains
  // the rows — so this must not promise permanent deletion. But "Archive shared
  // space" described the mechanism rather than the outcome, which is why owners
  // looking for a way to delete a shared list did not recognise this as it. The
  // copy now leads with the effect the user cares about (everyone loses access)
  // and is explicit that the app cannot undo it, which is true.
  const confirmArchive = () => Alert.alert(
    t('shareList.deleteSpaceTitle', { defaultValue: 'Delete this shared list?' }),
    t('shareList.deleteSpaceMessage', {
      defaultValue: 'Everyone loses access to its lists and tasks. This cannot be undone from the app.',
    }),
    [
      { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
      {
        text: t('shareList.deleteSpaceConfirm', { defaultValue: 'Delete' }),
        style: 'destructive',
        onPress: () => runAdminAction(
          () => archiveSpace(effectiveSpaceId, space?.version || 1),
          t('shareList.deleteSpaceDone', { defaultValue: 'Shared list deleted.' }),
          true,
        ),
      },
    ],
  );

  const narrowAndroid = Platform.OS === 'android' && width < 420;
  const sheetHeight = Math.min(
    height - Math.max(insets.top, 8),
    narrowAndroid ? height * 0.96 : height * 0.9,
    820,
  );
  const inviteDisabled = !canInvite || busy || !target.trim();

  return (
    <Modal
      visible={Boolean(visible)}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={close}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close sharing"
          style={StyleSheet.absoluteFill}
          onPress={close}
        />
        <View style={[
          styles.sheet,
          {
            width: Math.min(width, 680),
            height: sheetHeight,
            backgroundColor: theme.bg,
            borderColor: border,
          },
        ]}>
          <View style={[styles.header, { borderBottomColor: border }]}>
            <View style={styles.headerCopy}>
              <Text numberOfLines={1} maxFontSizeMultiplier={1.6} style={[styles.title, { color: theme.text }]}>
                {effectiveSpaceId ? 'People & access' : `Share ${list?.name || space?.name || 'list'}`}
              </Text>
              <Text numberOfLines={1} maxFontSizeMultiplier={1.6} style={[styles.subtitle, { color: theme.muted }]}>
                {effectiveSpaceId ? (space?.name || list?.name || 'Shared space') : 'Personal list'} · {members.length} member{members.length === 1 ? '' : 's'}
              </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close people and access" onPress={close} style={styles.iconButton}>
              <X size={21} color={theme.muted} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            {effectiveSpaceId ? (
              <>
                <Text maxFontSizeMultiplier={1.6} style={[styles.sectionTitle, { color: theme.text }]}>Members</Text>
                <Text maxFontSizeMultiplier={1.6} style={[styles.help, { color: theme.muted }]}>Everyone in this shared space can view this directory and each person&apos;s role.</Text>
                {members.length ? members.map((member) => (
                  <MemberRow
                    key={String(idFor(member))}
                    member={member}
                    isCurrentUser={idsMatch(idFor(member), userId)}
                    canManage={isOwner && !idsMatch(idFor(member), userId)}
                    disabled={busy}
                    onRolePress={(selectedMember) => {
                      setRoleTarget(selectedMember);
                      setRolePickerVisible(true);
                    }}
                    onActionsPress={openMemberActions}
                  />
                )) : (
                  <Text maxFontSizeMultiplier={1.6} style={[styles.empty, { color: theme.muted }]}>Member details are not available yet. Cached details will appear here as soon as they are available.</Text>
                )}

                <View style={[styles.separator, { backgroundColor: border }]} />
                <Text maxFontSizeMultiplier={1.6} style={[styles.sectionTitle, { color: theme.text }]}>What each role can do</Text>
                <View style={styles.controls} accessibilityRole="summary">
                  <Text maxFontSizeMultiplier={1.6} style={[styles.help, { color: theme.muted }]}><Text style={{ color: theme.text, fontWeight: '500' }}>Owner</Text> — manages people, invitations, roles, ownership, and space settings.</Text>
                  <Text maxFontSizeMultiplier={1.6} style={[styles.help, { color: theme.muted }]}><Text style={{ color: theme.text, fontWeight: '500' }}>Editor</Text> — can add and update shared lists, tasks, and comments.</Text>
                  <Text maxFontSizeMultiplier={1.6} style={[styles.help, { color: theme.muted }]}><Text style={{ color: theme.text, fontWeight: '500' }}>Viewer</Text> — can view shared work without changing it.</Text>
                </View>

                {currentMember && !isOwner ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={t('shareList.leaveAction', { defaultValue: 'Leave shared space' })} disabled={busy} onPress={confirmLeave} style={styles.destructiveAction}>
                    <UserMinus size={17} color={destructive} />
                    <Text maxFontSizeMultiplier={1.5} style={[styles.destructiveText, { color: destructive }]}>
                      {t('shareList.leaveAction', { defaultValue: 'Leave shared space' })}
                    </Text>
                  </Pressable>
                ) : null}
                {!isOwner && error ? <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.6} style={[styles.message, { color: theme.text }]}>{error}</Text> : null}
                {!isOwner && notice ? <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.6} style={[styles.message, { color: theme.muted }]}>{notice}</Text> : null}
                {isOwner ? <View style={[styles.separator, { backgroundColor: border }]} /> : null}
              </>
            ) : null}

            {isOwner ? (
              <>
                <Text maxFontSizeMultiplier={1.6} style={[styles.sectionTitle, { color: theme.text }]}>Invite someone</Text>
            <Text maxFontSizeMultiplier={1.6} style={[styles.help, { color: theme.muted }]}>
              {isPersonalList
                ? 'The first invitation creates an online shared space and links this personal list.'
                : 'Use an exact @username or email. Sharing administration is online only.'}
            </Text>
            <TextInput
              value={target}
              onChangeText={setTarget}
              editable={canInvite && !busy}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="@username or email"
              placeholderTextColor={theme.muted}
              accessibilityLabel="Invite username or email"
              maxFontSizeMultiplier={1.6}
              style={[styles.input, { color: theme.text, backgroundColor: theme.surface, borderColor: border }]}
            />

            <View style={styles.controls}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Invite role: ${role}`}
                disabled={!canInvite || busy}
                onPress={() => {
                  setRoleTarget(null);
                  setRolePickerVisible(true);
                }}
                style={[styles.control, { borderColor: border, opacity: canInvite ? 1 : 0.45 }]}
              >
                <Text maxFontSizeMultiplier={1.5} style={[styles.controlText, { color: theme.text }]}>Role · {role}</Text>
              </Pressable>
              <View style={styles.expiries}>
                {EXPIRIES.map((item) => {
                  const selected = expiry === item.days;
                  return (
                    <Pressable
                      key={item.days}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected, disabled: !canInvite || busy }}
                      accessibilityLabel={`Invite expires in ${item.label}`}
                      disabled={!canInvite || busy}
                      onPress={() => setExpiry(item.days)}
                      style={[
                        styles.expiry,
                        {
                          borderColor: selected ? theme.text : border,
                          backgroundColor: selected ? theme.fill : 'transparent',
                        },
                      ]}
                    >
                      <Text maxFontSizeMultiplier={1.5} style={[styles.expiryText, { color: selected ? theme.text : theme.muted }]}>{item.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {!canInvite && (
              <Text maxFontSizeMultiplier={1.6} style={[styles.permission, { color: theme.muted }]}>
                Only the space owner can create invitations.
              </Text>
            )}

            {secureLink ? (
              <View style={[styles.linkBox, { borderColor: border, backgroundColor: theme.surface }]}>
                <View style={styles.linkHeading}>
                  <Link2 size={17} color={theme.muted} />
                  <Text maxFontSizeMultiplier={1.5} style={[styles.linkLabel, { color: theme.text }]}>One-time invite link</Text>
                </View>
                <Text maxFontSizeMultiplier={1.5} style={[styles.linkHelp, { color: theme.muted }]}>
                  This secret is held only until this sheet closes.
                </Text>
                <View style={styles.linkActions}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Copy one-time invite link" onPress={copyLink} style={[styles.secondaryButton, { borderColor: border }]}>
                    <Copy size={17} color={theme.text} />
                    <Text maxFontSizeMultiplier={1.5} style={[styles.secondaryText, { color: theme.text }]}>Copy</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Share one-time invite link" onPress={shareLink} style={[styles.secondaryButton, { borderColor: border }]}>
                    <Share2 size={17} color={theme.text} />
                    <Text maxFontSizeMultiplier={1.5} style={[styles.secondaryText, { color: theme.text }]}>Share</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {error ? <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.6} style={[styles.message, { color: theme.text }]}>{error}</Text> : null}
            {notice ? <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.6} style={[styles.message, { color: theme.muted }]}>{notice}</Text> : null}

            {effectiveSpaceId && isOwner ? (
              <>
                <View style={[styles.separator, { backgroundColor: border }]} />
                <Text maxFontSizeMultiplier={1.6} style={[styles.sectionTitle, { color: theme.text }]}>Pending invitations</Text>
                <Text maxFontSizeMultiplier={1.6} style={[styles.help, { color: theme.muted }]}>Cached details appear instantly. Creating or revoking an invitation requires internet.</Text>
                {visiblePendingInvites.length ? visiblePendingInvites.map((invite) => {
                  const inviteTarget = getInviteTarget(invite);
                  const isRevoking = idsMatch(revokingInviteId, invite.id);
                  return (
                    <View key={String(invite.id)} style={[styles.inviteRow, { borderColor: border, backgroundColor: theme.surface }]}>
                      <View style={styles.inviteDetails}>
                        <Text numberOfLines={1} maxFontSizeMultiplier={1.5} style={[styles.inviteTarget, { color: theme.text }]}>{inviteTarget}</Text>
                        <View style={styles.inviteMetaRow}>
                          <Clock3 size={13} color={theme.muted} />
                          <Text maxFontSizeMultiplier={1.5} style={[styles.inviteMeta, { color: theme.muted }]}>{formatInviteExpiry(invite.expires_at)} · {invite.role || 'editor'}</Text>
                        </View>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Revoke invitation for ${inviteTarget}`}
                        accessibilityState={{ disabled: isRevoking, busy: isRevoking }}
                        disabled={isRevoking}
                        onPress={() => confirmRevokeInvite(invite)}
                        style={({ pressed }) => [styles.revokeButton, { borderColor: border, opacity: pressed || isRevoking ? 0.45 : 1 }]}
                      >
                        <UserRoundX size={15} color={destructive} />
                        <Text maxFontSizeMultiplier={1.5} style={[styles.revokeText, { color: destructive }]}>{isRevoking ? 'Revoking…' : 'Revoke'}</Text>
                      </Pressable>
                    </View>
                  );
                }) : (
                  <Text maxFontSizeMultiplier={1.6} style={[styles.pendingEmpty, { color: theme.muted }]}>No pending invitations.</Text>
                )}
              </>
            ) : null}

                {/* Trash2, not Archive: the icon was reinforcing the same
                    mechanism-first wording that stopped owners recognising this
                    as the way to delete a shared list. */}
                {effectiveSpaceId && isOwner ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('shareList.deleteSpaceAction', { defaultValue: 'Delete shared list' })}
                    disabled={busy}
                    onPress={confirmArchive}
                    style={styles.destructiveAction}
                  >
                    <Trash2 size={17} color={destructive} />
                    <Text maxFontSizeMultiplier={1.5} style={[styles.destructiveText, { color: destructive }]}>
                      {t('shareList.deleteSpaceAction', { defaultValue: 'Delete shared list' })}
                    </Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}
          </ScrollView>

          {isOwner ? (
            <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12), borderTopColor: border, backgroundColor: theme.bg }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isPersonalList && !effectiveSpaceId ? 'Create shared space and invitation' : 'Create invitation'}
                accessibilityState={{ disabled: inviteDisabled, busy }}
                disabled={inviteDisabled}
                onPress={createInvitation}
                style={({ pressed }) => [styles.inviteButton, { backgroundColor: theme.text, opacity: pressed || inviteDisabled ? 0.45 : 1 }]}
              >
                {busy ? <Send size={18} color={theme.bg} /> : <UserRoundPlus size={18} color={theme.bg} />}
                <Text maxFontSizeMultiplier={1.5} style={[styles.inviteText, { color: theme.bg }]}>{busy ? 'Working…' : 'Create invitation'}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <RolePicker
          visible={rolePickerVisible}
          onClose={() => {
            setRolePickerVisible(false);
            setRoleTarget(null);
          }}
          value={roleTarget?.role || role}
          onSelect={selectRole}
          disabled={busy}
          title={roleTarget ? `Role for ${getMemberName(roleTarget)}` : 'Invite role'}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.58)' },
  sheet: { maxWidth: 680, borderWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: 'hidden' },
  header: { minHeight: 78, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center' },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 18, fontWeight: '400' },
  subtitle: { marginTop: 3, fontSize: 12, fontWeight: '300' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 28 },
  sectionTitle: { fontSize: 15, fontWeight: '500' },
  help: { marginTop: 6, fontSize: 12, lineHeight: 18, fontWeight: '300' },
  input: { minHeight: 50, marginTop: 14, paddingHorizontal: 14, borderWidth: 1, borderRadius: 13, fontSize: 15, fontWeight: '300' },
  controls: { marginTop: 10, gap: 10 },
  control: { minHeight: 44, paddingHorizontal: 13, borderWidth: 1, borderRadius: 12, justifyContent: 'center' },
  controlText: { fontSize: 13, textTransform: 'capitalize', fontWeight: '400' },
  expiries: { flexDirection: 'row', gap: 8 },
  expiry: { minHeight: 44, flex: 1, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  expiryText: { fontSize: 11, fontWeight: '400' },
  permission: { marginTop: 10, fontSize: 12, fontWeight: '300' },
  linkBox: { marginTop: 14, padding: 14, borderWidth: 1, borderRadius: 14 },
  linkHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  linkLabel: { fontSize: 13, fontWeight: '400' },
  linkHelp: { marginTop: 8, fontSize: 11, lineHeight: 16, fontWeight: '300' },
  linkActions: { marginTop: 12, flexDirection: 'row', gap: 9 },
  secondaryButton: { minHeight: 44, flex: 1, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  secondaryText: { fontSize: 13, fontWeight: '400' },
  message: { marginTop: 12, fontSize: 12, lineHeight: 18, fontWeight: '300' },
  separator: { height: StyleSheet.hairlineWidth, marginVertical: 22 },
  inviteRow: { minHeight: 72, marginTop: 10, padding: 12, borderWidth: 1, borderRadius: 13, flexDirection: 'row', alignItems: 'center', gap: 10 },
  inviteDetails: { flex: 1, minWidth: 0 },
  inviteTarget: { fontSize: 13, fontWeight: '400' },
  inviteMetaRow: { marginTop: 7, flexDirection: 'row', alignItems: 'center', gap: 6 },
  inviteMeta: { flex: 1, fontSize: 11, lineHeight: 15, fontWeight: '300', textTransform: 'capitalize' },
  revokeButton: { minHeight: 38, paddingHorizontal: 10, borderWidth: 1, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  revokeText: { fontSize: 11, fontWeight: '400' },
  pendingEmpty: { paddingTop: 14, fontSize: 13, fontWeight: '300' },
  empty: { paddingVertical: 24, fontSize: 13, fontWeight: '300' },
  destructiveAction: { minHeight: 48, marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  destructiveText: { fontSize: 13, fontWeight: '400' },
  footer: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  inviteButton: { minHeight: 50, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  inviteText: { fontSize: 14, fontWeight: '500' },
});

export default ShareListSheet;