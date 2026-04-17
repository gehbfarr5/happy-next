import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * Send a local notification when the AI agent is ready.
 * Works entirely on-device — no FCM/push token or server config needed.
 * Fired from both the foreground WebSocket path and the background polling task.
 *
 * @param sessionId   Written into notification data for tap-to-navigate and
 *                    per-session suppression when app is active.
 * @param sessionName Human-readable title shown in the notification body.
 */
export async function sendLocalReadyNotification(
    sessionId?: string,
    sessionName?: string,
): Promise<void> {
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
                body: sessionName
                    ? `「${sessionName}」任务已完成，等待您的指令`
                    : 'AI agent 已完成任务，等待您的指令',
                sound: true,
                data: {
                    type: 'ready',
                    // sessionId enables tap-to-navigate and per-session suppression
                    sessionId: sessionId ?? '',
                },
            },
            trigger: null, // fire immediately
        });
    } catch (e) {
        // Notification errors must never crash the app
        console.warn('[localNotification] Failed to send notification:', e);
    }
}
