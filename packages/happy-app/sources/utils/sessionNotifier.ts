/**
 * 会话完成通知模块
 * 
 * 核心逻辑：
 * 1. 前台恢复时轮询 API 检查已完成会话
 * 2. 用户进入会话页面时清除该会话的通知状态
 * 3. 原始 WebSocket 通知保持不变（前台时生效）
 */

import { MMKV } from 'react-native-mmkv';
import * as SecureStore from 'expo-secure-store';
import { getServerUrl } from '@/sync/serverConfig';
import { sendLocalReadyNotification } from '@/utils/localNotification';

const NOTIFIED_KEY = 'notified_sessions_v3';
const LAST_VIEWED_KEY = 'session-last-viewed-at';

const mmkv = new MMKV();

// 获取已通知的会话
function getNotified(): Set<string> {
  try {
    const raw = mmkv.getString(NOTIFIED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function saveNotified(s: Set<string>) {
  mmkv.set(NOTIFIED_KEY, JSON.stringify([...s]));
}

// 获取 lastViewedAt 映射
function getLastViewed(): Record<string, number> {
  try {
    const raw = mmkv.getString(LAST_VIEWED_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

// 获取 credentials
async function getCredentials(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync('auth_token');
  } catch { return null; }
}

/**
 * 检查已完成的会话并发送通知
 * 返回是否有新通知
 */
export async function checkCompletedSessions(): Promise<boolean> {
  console.log('[Notifier] Checking...');
  
  const token = await getCredentials();
  if (!token) return false;

  try {
    const res = await fetch(`${getServerUrl()}/v1/sessions`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return false;

    const { sessions = [] } = await res.json();
    const notified = getNotified();
    const lastViewed = getLastViewed();
    let hasNew = false;

    for (const s of sessions) {
      const done = s.agentState?.taskCompleted;
      if (!done) continue;

      // 已通知过，跳过
      if (notified.has(s.id)) continue;

      // 用户已查看（lastViewedAt >= taskCompleted），跳过
      const viewed = lastViewed[s.id] || 0;
      if (viewed >= done) continue;

      console.log('[Notifier] Notify:', s.id, 'taskCompleted:', done, 'lastViewed:', viewed);
      await sendLocalReadyNotification(s.id, s.title);
      notified.add(s.id);
      hasNew = true;
    }

    if (hasNew) saveNotified(notified);
    return hasNew;
  } catch (e) {
    console.warn('[Notifier] Error:', e);
    return false;
  }
}

/**
 * 用户进入会话时调用，清除该会话的通知状态
 * 这样如果会话再次完成，可以重新通知
 */
export function onEnterSession(sessionId: string) {
  const notified = getNotified();
  if (notified.has(sessionId)) {
    notified.delete(sessionId);
    saveNotified(notified);
    console.log('[Notifier] Cleared on enter:', sessionId);
  }
}

/**
 * 标记会话为已通知（从 WebSocket hasReadyEvent 调用）
 */
export function markNotified(sessionId: string) {
  const notified = getNotified();
  if (!notified.has(sessionId)) {
    notified.add(sessionId);
    saveNotified(notified);
    console.log('[Notifier] Marked:', sessionId);
  }
}
