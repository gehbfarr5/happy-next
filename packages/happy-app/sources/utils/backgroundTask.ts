import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { getServerUrl } from '@/sync/serverConfig';
import { storage } from '@/sync/storage';
import { sendLocalReadyNotification } from '@/utils/localNotification';

const BACKGROUND_FETCH_TASK = 'background-session-check';

// 记录已通知的会话，避免重复通知
let notifiedSessions: Set<string> = new Set();

export function isBackgroundFetchAvailable(): boolean {
  return Platform.OS === 'android' || Platform.OS === 'ios';
}

// 检查会话状态并发送通知
async function checkSessionsAndNotify(): Promise<void> {
  try {
    const state = storage.getState();
    const credentials = state.credentials;
    if (!credentials) return;

    const serverUrl = getServerUrl();
    const response = await fetch(`${serverUrl}/v1/sessions`, {
      headers: {
        'Authorization': `Bearer ${credentials.token}`,
      },
    });

    if (!response.ok) return;

    const data = await response.json();
    const sessions = data.sessions || [];

    // 找出已完成但用户未查看的会话
    for (const session of sessions) {
      const sessionId = session.id;
      const taskCompleted = session.agentState?.taskCompleted;
      
      if (!taskCompleted) continue;
      
      // 检查是否已通知过
      if (notifiedSessions.has(sessionId)) continue;
      
      // 检查用户是否已查看（比较 taskCompleted 和 lastViewedAt）
      const lastViewedAt = state.sessionLastViewedAt?.get?.(sessionId) || 0;
      if (taskCompleted <= lastViewedAt) continue;

      // 发送本地通知
      await sendLocalReadyNotification(sessionId, session.title || undefined);

      // 标记已通知
      notifiedSessions.add(sessionId);
    }
  } catch (e) {
    console.warn('[backgroundTask] Check failed:', e);
  }
}

// 定义后台任务
TaskManager.defineTask(BACKGROUND_FETCH_TASK, async () => {
  try {
    await checkSessionsAndNotify();
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (error) {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// 注册后台任务
export async function registerBackgroundFetch(): Promise<void> {
  if (!isBackgroundFetchAvailable()) return;

  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_FETCH_TASK);
    if (isRegistered) return;

    await BackgroundFetch.registerTaskAsync(BACKGROUND_FETCH_TASK, {
      minimumInterval: 15 * 60, // 15 分钟（iOS 最小间隔）
      stopOnTerminate: false,
      startOnReceive: true,
    });
    console.log('[backgroundTask] Registered successfully');
  } catch (e) {
    console.warn('[backgroundTask] Register failed:', e);
  }
}

// 取消后台任务
export async function unregisterBackgroundFetch(): Promise<void> {
  if (!isBackgroundFetchAvailable()) return;

  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_FETCH_TASK);
    if (isRegistered) {
      await BackgroundFetch.unregisterTaskAsync(BACKGROUND_FETCH_TASK);
    }
  } catch (e) {
    console.warn('[backgroundTask] Unregister failed:', e);
  }
}

// 清除已通知记录（在用户查看会话时调用）
export function clearNotifiedSession(sessionId: string): void {
  notifiedSessions.delete(sessionId);
}

// 前台恢复时主动检查
export async function checkPendingSessionsOnForeground(): Promise<void> {
  await checkSessionsAndNotify();
}
