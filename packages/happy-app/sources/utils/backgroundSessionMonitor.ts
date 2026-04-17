import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { checkCompletedSessions } from '@/utils/sessionNotifier';

export const BACKGROUND_SESSION_TASK = 'BACKGROUND_SESSION_CHECK';

/**
 * Background fetch task — wakes periodically by the OS even when the JS
 * runtime is suspended, polls session state, and fires local notifications
 * for any session that completed since the last foreground snapshot.
 *
 * The actual detection and notification logic lives in sessionNotifier so
 * the same code is shared between the foreground (AppState active) and
 * background paths.
 */
TaskManager.defineTask(BACKGROUND_SESSION_TASK, async () => {
    try {
        const fired = await checkCompletedSessions();
        return fired
            ? BackgroundFetch.BackgroundFetchResult.NewData
            : BackgroundFetch.BackgroundFetchResult.NoData;
    } catch (e) {
        console.warn('[BackgroundSessionMonitor] task error:', e);
        return BackgroundFetch.BackgroundFetchResult.Failed;
    }
});

/**
 * Register the background fetch task.
 * Safe to call multiple times — skips registration if already registered.
 * Call once from the root layout after the app is initialised.
 */
export async function registerBackgroundSessionMonitor(): Promise<void> {
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;

    try {
        // Ensure notification permissions before registering
        const { status } = await Notifications.getPermissionsAsync();
        if (status !== 'granted') {
            const { status: asked } = await Notifications.requestPermissionsAsync();
            if (asked !== 'granted') return;
        }

        const fetchStatus = await BackgroundFetch.getStatusAsync();
        if (
            fetchStatus === BackgroundFetch.BackgroundFetchStatus.Restricted ||
            fetchStatus === BackgroundFetch.BackgroundFetchStatus.Denied
        ) {
            console.warn('[BackgroundSessionMonitor] background fetch not available on this device');
            return;
        }

        const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SESSION_TASK);
        if (isRegistered) return;

        await BackgroundFetch.registerTaskAsync(BACKGROUND_SESSION_TASK, {
            minimumInterval: 15 * 60, // 15 minutes (OS may throttle further on Android)
            stopOnTerminate: false,   // keep alive after app is killed (Android)
            startOnBoot: true,        // restart after device reboot
        });
    } catch (e) {
        console.warn('[BackgroundSessionMonitor] register error:', e);
    }
}
