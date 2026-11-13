import { AlertCircle, Check, Clock3, Pencil, Send, Trash2, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import {
    addTaskComment,
    deleteTaskComment,
    editTaskComment,
    loadTaskComments,
} from '../../lib/collaborationManager';
import { getMemberHandle, getMemberName } from './MemberRow';

const EMPTY_COMMENTS = Object.freeze([]);
const MENTION_PATTERN = /(^|[^A-Za-z0-9_])(@[A-Za-z0-9_.-]{3,32})/g;
const idFor = (value) => value?.user_id || value?.id;
const visibleComments = (items) => (Array.isArray(items) ? items : []).filter((item) => !item?._deleted && !item?.deleted_at);
const mentionMatches = (body) => [...String(body || '').matchAll(MENTION_PATTERN)];
const mentionHandles = (body) => [...new Set(mentionMatches(body).map((match) => match[2].toLowerCase()))];
const commentParts = (body) => {
  const text = String(body || '');
  const parts = [];
  let cursor = 0;
  mentionMatches(text).forEach((match) => {
    const handleStart = match.index + match[1].length;
    if (handleStart > cursor) parts.push({ text: text.slice(cursor, handleStart), mention: false });
    parts.push({ text: match[2], mention: true });
    cursor = handleStart + match[2].length;
  });
  if (cursor < text.length) parts.push({ text: text.slice(cursor), mention: false });
  return parts.length ? parts : [{ text, mention: false }];
};
const formatTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export const CommentThread = ({
  userId,
  taskId,
  comments = EMPTY_COMMENTS,
  members = [],
  onCommentsChange,
  readOnly = false,
}) => {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const externallyManaged = comments !== EMPTY_COMMENTS;
  const [localComments, setLocalComments] = useState(() => visibleComments(comments));
  const commentsRef = useRef(localComments);
  const [body, setBody] = useState('');
  const [editing, setEditing] = useState(null);
  const [savingText, setSavingText] = useState('');
  const [error, setError] = useState('');
  const memberMap = useMemo(
    () => new Map(members.map((member) => [String(idFor(member)), member])),
    [members],
  );
  const activeHandles = useMemo(() => new Set(
    members.map((member) => getMemberHandle(member).toLowerCase()).filter((handle) => handle.startsWith('@')),
  ), [members]);
  const border = theme.hairline || '#2A2A2E';
  const destructive = theme.danger || '#FF453A';

  const publish = useCallback((nextOrUpdater) => {
    const next = visibleComments(typeof nextOrUpdater === 'function'
      ? nextOrUpdater(commentsRef.current)
      : nextOrUpdater);
    commentsRef.current = next;
    setLocalComments(next);
    onCommentsChange?.(next);
  }, [onCommentsChange]);

  useEffect(() => {
    if (!externallyManaged) return undefined;
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      const next = visibleComments(comments);
      commentsRef.current = next;
      setLocalComments(next);
    });
    return () => { active = false; };
  }, [comments, externallyManaged]);

  useEffect(() => {
    if (externallyManaged) return undefined;
    let active = true;
    if (!userId || taskId == null) {
      Promise.resolve().then(() => {
        if (!active) return;
        commentsRef.current = [];
        setLocalComments([]);
      });
      return () => { active = false; };
    }
    loadTaskComments(userId, taskId, (fresh) => {
      if (active) publish(fresh);
    }).then((cached) => {
      if (active) {
        publish(cached);
        setError('');
      }
    }).catch(() => {
      if (active) setError('Comments could not be loaded. Cached comments remain available.');
    });
    return () => { active = false; };
  }, [externallyManaged, publish, taskId, userId]);

  const submit = async () => {
    const text = body.trim();
    if (!text || readOnly || !userId || taskId == null || savingText) return;
    const unknownMentions = mentionHandles(text).filter((handle) => !activeHandles.has(handle));
    if (unknownMentions.length) {
      setError(`Mention active members by exact username: ${unknownMentions.join(', ')}`);
      return;
    }
    setError('');
    setSavingText('Saving locally…');

    if (editing) {
      const original = editing;
      const optimistic = {
        ...editing,
        body: text,
        updated_at: new Date().toISOString(),
        _sync_status: 'pending',
      };
      publish((current) => current.map((item) => (
        String(item.id) === String(editing.id) ? optimistic : item
      )));
      setEditing(null);
      setBody('');
      try {
        const updated = await editTaskComment(
          userId,
          taskId,
          original.id,
          text,
          original.version,
        );
        if (updated) {
          publish((current) => current.map((item) => (
            String(item.id) === String(original.id) ? updated : item
          )));
        }
        setSavingText('Edit pending sync');
      } catch (_error) {
        publish((current) => current.map((item) => (
          String(item.id) === String(original.id) ? original : item
        )));
        setBody(text);
        setEditing(original);
        setError('Comment edit could not be saved locally.');
        setSavingText('');
        return;
      }
    } else {
      const temporaryId = `local-comment-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const optimistic = {
        id: temporaryId,
        task_id: taskId,
        author_id: userId,
        body: text,
        created_at: new Date().toISOString(),
        _sync_status: 'pending',
      };
      publish((current) => [optimistic, ...current]);
      setBody('');
      try {
        const added = await addTaskComment(userId, taskId, text);
        publish((current) => current.map((item) => (
          item.id === temporaryId ? added : item
        )));
        setSavingText('Comment pending sync');
      } catch (_error) {
        publish((current) => current.filter((item) => item.id !== temporaryId));
        setBody(text);
        setError('Comment could not be saved locally.');
        setSavingText('');
        return;
      }
    }
    setTimeout(() => setSavingText(''), 1800);
  };

  const beginEdit = (comment) => {
    if (readOnly || comment._sync_status === 'pending') return;
    setEditing(comment);
    setBody(comment.body || '');
    setError('');
  };

  const cancelEdit = () => {
    setEditing(null);
    setBody('');
    setError('');
  };

  const remove = (comment) => Alert.alert(
    'Delete comment?',
    'This removes the comment for everyone.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const previous = localComments;
          publish((current) => current.filter((item) => String(item.id) !== String(comment.id)));
          setError('');
          setSavingText('Delete pending sync');
          try {
            await deleteTaskComment(userId, taskId, comment.id, comment.version);
            setTimeout(() => setSavingText(''), 1800);
          } catch (_error) {
            publish(previous);
            setSavingText('');
            setError('Comment could not be deleted locally.');
          }
        },
      },
    ],
  );

  const renderComment = (item) => {
    const authorId = item.author_id || item.created_by;
    const mine = String(authorId) === String(userId);
    const author = memberMap.get(String(authorId));
    const pending = item._sync_status === 'pending';
    const failed = item._sync_status === 'error' || Boolean(item._sync_error);
    return (
      <View key={String(item.id)} style={[styles.comment, { borderBottomColor: border }]}>
        <View style={styles.commentHeader}>
          <Text numberOfLines={1} maxFontSizeMultiplier={1.6} style={[styles.author, { color: theme.text }]}>
            {author ? getMemberName(author) : mine ? 'You' : 'Collaborator'}
          </Text>
          <Text maxFontSizeMultiplier={1.5} style={[styles.time, { color: theme.muted }]}>
            {formatTime(item.created_at || item.updated_at)}
          </Text>
          {mine && !readOnly ? (
            <>
              <Pressable accessibilityRole="button" accessibilityLabel="Edit comment" disabled={pending} onPress={() => beginEdit(item)} style={styles.iconButton}>
                <Pencil size={16} color={theme.muted} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Delete comment" disabled={pending} onPress={() => remove(item)} style={styles.iconButton}>
                <Trash2 size={16} color={destructive} />
              </Pressable>
            </>
          ) : null}
        </View>
        <Text selectable maxFontSizeMultiplier={1.8} style={[styles.body, { color: theme.text }]}>
          {commentParts(item.body).map((part, index) => (
            part.mention && activeHandles.has(part.text.toLowerCase())
              ? <Text key={`${item.id}-mention-${index}`} style={[styles.mention, { color: theme.accent }]}>{part.text}</Text>
              : part.text
          ))}
        </Text>
        {pending || failed ? (
          <View style={styles.state}>
            {failed ? <AlertCircle size={13} color={theme.muted} /> : <Clock3 size={13} color={theme.muted} />}
            <Text maxFontSizeMultiplier={1.5} style={[styles.stateText, { color: theme.muted }]}>
              {failed ? 'Sync error — your local copy is preserved' : 'Pending sync'}
            </Text>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { borderColor: border }]}
    >
      {localComments.length ? (
        <View style={styles.list}>
          {localComments.map(renderComment)}
        </View>
      ) : (
        <View style={styles.emptyList}>
          <Text maxFontSizeMultiplier={1.6} style={[styles.empty, { color: theme.muted }]}>
            No comments yet{readOnly ? '.' : '. Start the conversation.'}
          </Text>
        </View>
      )}

      {error ? (
        <View accessibilityLiveRegion="polite" style={styles.statusRow}>
          <AlertCircle size={14} color={theme.muted} />
          <Text maxFontSizeMultiplier={1.5} style={[styles.statusText, { color: theme.text }]}>{error}</Text>
        </View>
      ) : null}
      {savingText ? (
        <View accessibilityLiveRegion="polite" style={styles.statusRow}>
          <Clock3 size={14} color={theme.muted} />
          <Text maxFontSizeMultiplier={1.5} style={[styles.statusText, { color: theme.muted }]}>{savingText}</Text>
        </View>
      ) : null}

      {editing && !readOnly ? (
        <View style={styles.editing}>
          <Text maxFontSizeMultiplier={1.5} style={[styles.editingText, { color: theme.muted }]}>Editing comment</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel editing" onPress={cancelEdit} style={styles.iconButton}>
            <X size={17} color={theme.muted} />
          </Pressable>
        </View>
      ) : null}

      {!readOnly && members.some((member) => getMemberHandle(member).startsWith('@')) ? (
        <Text maxFontSizeMultiplier={1.5} style={[styles.mentionHint, { color: theme.muted }]}>
          Mention an active member with their exact @username.
        </Text>
      ) : null}

      {readOnly ? (
        <View style={[styles.readOnly, { borderTopColor: border, backgroundColor: theme.bg }]}>
          <Text maxFontSizeMultiplier={1.6} style={[styles.readOnlyText, { color: theme.muted }]}>Comments are view only.</Text>
        </View>
      ) : (
        <View style={[
          styles.composer,
          {
            paddingBottom: Math.max(12, Math.min(insets.bottom, 22)),
            borderTopColor: border,
            backgroundColor: theme.bg,
          },
        ]}>
          <TextInput
            value={body}
            onChangeText={setBody}
            editable={!savingText && Boolean(userId)}
            multiline
            maxLength={2000}
            placeholder="Write a comment"
            placeholderTextColor={theme.muted}
            accessibilityLabel="Comment text"
            maxFontSizeMultiplier={1.8}
            style={[styles.input, { color: theme.text, backgroundColor: theme.surface, borderColor: border }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={editing ? 'Save comment edit' : 'Send comment'}
            disabled={!body.trim() || Boolean(savingText) || !userId}
            onPress={submit}
            style={({ pressed }) => [
              styles.send,
              {
                backgroundColor: theme.text,
                opacity: pressed || !body.trim() || savingText || !userId ? 0.45 : 1,
              },
            ]}
          >
            {editing ? <Check size={19} color={theme.bg} /> : <Send size={19} color={theme.bg} />}
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, overflow: 'hidden' },
  list: { paddingHorizontal: 16 },
  emptyList: { minHeight: 120, alignItems: 'center', justifyContent: 'center', padding: 20 },
  empty: { fontSize: 13, textAlign: 'center', fontWeight: '300' },
  comment: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  commentHeader: { minHeight: 32, flexDirection: 'row', alignItems: 'center' },
  author: { flex: 1, fontSize: 13, fontWeight: '500' },
  time: { fontSize: 10, fontWeight: '300' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  body: { fontSize: 14, lineHeight: 20, fontWeight: '300' },
  mention: { fontWeight: '600' },
  mentionHint: { paddingHorizontal: 16, paddingTop: 8, fontSize: 11, lineHeight: 16, fontWeight: '300' },
  state: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 5 },
  stateText: { flex: 1, fontSize: 11, fontWeight: '300' },
  statusRow: { minHeight: 36, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 7 },
  statusText: { flex: 1, fontSize: 11, fontWeight: '300' },
  editing: { minHeight: 40, paddingLeft: 16, flexDirection: 'row', alignItems: 'center' },
  editingText: { flex: 1, fontSize: 12, fontWeight: '300' },
  composer: { paddingHorizontal: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'flex-end', gap: 9 },
  input: { flex: 1, minHeight: 48, maxHeight: 120, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontWeight: '300' },
  send: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  readOnly: { minHeight: 52, paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
  readOnlyText: { fontSize: 12, fontWeight: '300' },
});

export default CommentThread;