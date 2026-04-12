import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * Send a local notification when the AI agent is ready (without FCM/server push).
 * Works entirely on-device — no push token or server config needed.
 *
 * @param sessionId  The session ID — written into notification data so:
 *                   1. Tapping the notification navigates to the correct session.
 *                   2. The "hide current session notifications" setting works correctly.
 * @param sessionName  Human-readable session title shown in the notification body.
 */
export async function sendLocalReadyNotification(sessionId?: string, sessionName?: string): Promise<void> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;

  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      const { status: newStatus } = await Notifications.requestPermissionsAsync();
      if (newStatus !== 'granted') return;
    }

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'AI 已就绪',
        body: sessionName ? `「${sessionName}」任务已完成，等待您的指令` : 'AI agent 已完成任务，等待您的指令',
        sound: true,
        data: {
          type: 'ready',
          // sessionId enables: (1) tap-to-navigate, (2) per-session notification suppression
          sessionId: sessionId ?? '',
        },
      },
      trigger: null, // fire immediately
    });
  } catch (e) {
    // Notification errors should not crash the app
    console.warn('[localNotification] Failed to send local ready notification:', e);
  }
}
