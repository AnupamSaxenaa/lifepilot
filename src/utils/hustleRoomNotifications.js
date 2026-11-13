import notifee, { AndroidImportance, AndroidVisibility } from '@notifee/react-native';
import { Platform } from 'react-native';

const CHANNEL_ID = 'hustle-room-progress';
const notificationId = (roomId) => `hustle-room-${String(roomId)}`;

export const HUSTLE_ROOM_ACTIONS = Object.freeze({
  pause: 'hustle-room-pause',
  complete: 'hustle-room-complete',
});

const ensureChannel = async () => {
  if (Platform.OS !== 'android') return null;
  return notifee.createChannel({
    id: CHANNEL_ID,
    name: 'Focus Room progress',
    description: 'Shows your running Focus Room timer and controls.',
    importance: AndroidImportance.LOW,
    vibration: false,
    sound: undefined,
  });
};

export const showHustleRoomNotification = async ({
  roomId,
  roomName,
  taskLabel,
  taskId,
  queueItemId,
  userId,
  elapsedSeconds = 0,
  durationSeconds = 0,
}) => {
  if (Platform.OS !== 'android' || !roomId) return false;
  try {
    const settings = await notifee.getNotificationSettings();
    if (Number(settings.authorizationStatus) < 1) return false;
    await ensureChannel();
    const elapsed = Math.max(0, Math.floor(Number(elapsedSeconds) || 0));
    const duration = Math.max(0, Math.floor(Number(durationSeconds) || 0));
    const remainingMs = Math.max(0, duration - elapsed) * 1000;
    const hasTaskActions = Boolean(queueItemId && userId);

    await notifee.displayNotification({
      id: notificationId(roomId),
      title: roomName || 'Focus Room',
      body: taskLabel ? `Focusing on ${taskLabel}` : 'Your focus timer is running',
      data: {
        type: 'hustle_room',
        roomId: String(roomId),
        userId: userId ? String(userId) : '',
        taskId: taskId != null ? String(taskId) : '',
        queueItemId: queueItemId ? String(queueItemId) : '',
      },
      android: {
        channelId: CHANNEL_ID,
        smallIcon: 'notification_icon',
        color: '#FFFFFF',
        ongoing: true,
        autoCancel: false,
        onlyAlertOnce: true,
        visibility: AndroidVisibility.PRIVATE,
        ...(remainingMs > 0 ? { timeoutAfter: remainingMs } : {}),
        timestamp: Date.now() - elapsed * 1000,
        showChronometer: true,
        chronometerDirection: 'up',
        pressAction: { id: 'default', launchActivity: 'default' },
        actions: hasTaskActions ? [
          { title: 'Pause', pressAction: { id: HUSTLE_ROOM_ACTIONS.pause } },
          { title: 'Complete', pressAction: { id: HUSTLE_ROOM_ACTIONS.complete } },
        ] : [],
      },
    });
    return true;
  } catch {
    return false;
  }
};

export const cancelHustleRoomNotification = async (roomId) => {
  if (!roomId) return;
  try { await notifee.cancelNotification(notificationId(roomId)); } catch (_error) {}
};

export const handleHustleRoomNotificationAction = async (notification, pressActionId) => {
  const data = notification?.data;
  if (data?.type !== 'hustle_room' || !data.roomId || !data.queueItemId) return false;
  if (![HUSTLE_ROOM_ACTIONS.pause, HUSTLE_ROOM_ACTIONS.complete].includes(pressActionId)) return false;

  const roomId = String(data.roomId);
  const payloadUserId = data.userId ? String(data.userId) : null;
  try {
    const dataManager = await import('../lib/dataManager');
    const currentUserId = await dataManager.getCurrentUserId();
    const userId = payloadUserId || currentUserId;
    if (!userId || (currentUserId && String(currentUserId) !== String(userId))) return false;

    const snapshot = await dataManager.loadHustleRoom(userId, roomId, null, { refresh: false });
    const item = snapshot?.focus?.queue?.find((candidate) => candidate.id === String(data.queueItemId));
    if (!item) return false;

    if (pressActionId === HUSTLE_ROOM_ACTIONS.complete) {
      await dataManager.completeFocusRoomTask(userId, roomId, item);
    } else {
      await dataManager.updateHustleRoomQueueItem(userId, roomId, item.id, {
        status: 'queued',
        shareTitle: item.shareTitle,
      });
    }
    await dataManager.updateMyHustleRoomProgress(userId, roomId, {
      timerStatus: 'paused',
      taskLabel: item.title,
    });
    await cancelHustleRoomNotification(roomId);
    return true;
  } catch {
    return false;
  }
};