import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { getServerUrl } from '@/sync/serverConfig';
import { sendLocalReadyNotification } from '@/utils/localNotification';
import * as SecureStore from 'expo-secure-store';
import { MMKV } from 'react-native-mmkv';

const BACKGROUND_FETCH_TASK = 'background-session-check';
const NOTIFIED_SESSIONS_KEY = 'notified_sessions_v2';
const SESSION_LAST_VIEWED_KEY = 'session-last-viewed-at';

// 使用 MMKV 直接读取（与 persistence.ts 相同的方式）
const mmkv = new MMKV();

// 获取已通知的会话集合
function getNotifiedSessions(): Set<string> {
  try {
    const raw = mmkv.getString(NOTIFIED_SESSIONS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      return new Set(arr);
    }
  } catch (e) {
    console.warn('[backgroundTask] Failed to load notified sessions:', e);
  }
  return new Set();
}

// 保存已通知的会话集合
function saveNotifiedSessions(sessions: Set<string>): void {
  try {
    mmkv.set(NOTIFIED_SESSIONS_KEY, JSON.stringify([...sessions]));
  } catch (e) {
    console.warn('[backgroundTask] Failed to save notified sessions:', e);
  }
}

// 从 MMKV 直接读取 sessionLastViewedAt（与 persistence.ts 一致）
function getLastViewedAt(sessionId: string): number {
  try {
    const raw = mmkv.getString(SESSION_LAST_VIEWED_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      return obj[sessionId] || 0;
    }
  } catch (e) {
    console.warn('[backgroundTask] Failed to load lastViewedAt:', e);
  }
  return 0;
}

// 获取存储的 credentials
async function getStoredCredentials(): Promise<{ token: string } | null> {
  try {
    const token = await SecureStore.getItemAsync('auth_token');
    if (token) {
      return { token };
    }
  } catch (e) {
    console.warn('[backgroundTask] Failed to load credentials:', e);
  }
  return null;
}

export function isBackgroundFetchAvailable(): boolean {
  return Platform.OS === 'android' || Platform.OS === 'ios';
}

// 检查会话状态并发送通知
async function checkSessionsAndNotify(): Promise<void> {
  try {
    console.log('[backgroundTask] Starting background check...');
    
    const credentials = await getStoredCredentials();
    if (!credentials) {
      console.log('[backgroundTask] No credentials, skipping');
      return;
    }

    const serverUrl = getServerUrl();
    const response = await fetch(`${serverUrl}/v1/sessions`, {
      headers: {
        'Authorization': `Bearer ${credentials.token}`,
      },
    });

    if (!response.ok) {
      console.log('[backgroundTask] API request failed:', response.status);
      return;
    }

    const data = await response.json();
    const sessions = data.sessions || [];
    
    console.log('[backgroundTask] Fetched', sessions.length, 'sessions');

    const notifiedSessions = getNotifiedSessions();
    let hasNewNotifications = false;

    for (const session of sessions) {
      const sessionId = session.id;
      const taskCompleted = session.agentState?.taskCompleted;
      
      if (!taskCompleted) continue;

      // 检查是否已通知过
      if (notifiedSessions.has(sessionId)) {
        continue;
      }

      // 检查用户是否已查看（使用 MMKV 中的数据）
      const lastViewedAt = getLastViewedAt(sessionId);
      if (taskCompleted <= lastViewedAt) {
        console.log('[backgroundTask] Session already viewed:', sessionId);
        continue;
      }

      console.log('[backgroundTask] Sending notification for session:', sessionId, 'taskCompleted:', taskCompleted, 'lastViewedAt:', lastViewedAt);
      
      // 发送本地通知
      await sendLocalReadyNotification(sessionId, session.title || undefined);

      notifiedSessions.add(sessionId);
      hasNewNotifications = true;
    }

    if (hasNewNotifications) {
      saveNotifiedSessions(notifiedSessions);
    }
    
    console.log('[backgroundTask] Background check completed');
  } catch (e) {
    console.warn('[backgroundTask] Check failed:', e);
  }
}

// 定义后台任务
TaskManager.defineTask(BACKGROUND_FETCH_TASK, async () => {
  console.log('[backgroundTask] Background task triggered at', new Date().toISOString());
  try {
    await checkSessionsAndNotify();
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (error) {
    console.warn('[backgroundTask] Background task failed:', error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// 注册后台任务
export async function registerBackgroundFetch(): Promise<void> {
  if (!isBackgroundFetchAvailable()) return;

  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_FETCH_TASK);
    if (isRegistered) {
      console.log('[backgroundTask] Already registered');
      return;
    }

    // Android: 使用更短的间隔
    // iOS: 最小间隔为 15 分钟，系统会自动调整
    await BackgroundFetch.registerTaskAsync(BACKGROUND_FETCH_TASK, {
      minimumInterval: Platform.OS === 'android' ? 60 : 900, // Android: 1分钟, iOS: 15分钟
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
  const notifiedSessions = getNotifiedSessions();
  notifiedSessions.delete(sessionId);
  saveNotifiedSessions(notifiedSessions);
}

// 前台恢复时主动检查
export async function checkPendingSessionsOnForeground(): Promise<void> {
  console.log('[backgroundTask] Foreground check triggered');
  await checkSessionsAndNotify();
}
