/**
 * 会话完成通知模块
 *
 * 核心逻辑：
 * 1. 通过轮询 API 的 session.active 字段（无需解密）检测会话是否完成
 * 2. 用 MMKV 快照追踪上次已知的 active 状态，避免重复通知
 * 3. 前台 WebSocket ready event 和后台轮询两条路径均通过 markNotified 去重
 */

import { MMKV } from 'react-native-mmkv';
import { TokenStorage } from '@/auth/tokenStorage';
import { getServerUrl } from '@/sync/serverConfig';
import { sendLocalReadyNotification } from '@/utils/localNotification';
import { loadSnapshot, saveSnapshot } from '@/sync/sessionSnapshot';

const NOTIFIED_KEY = 'notified_sessions_v3';

const mmkv = new MMKV();

// ─── Notified-set helpers ─────────────────────────────────────────────────────

function getNotified(): Set<string> {
    try {
        const raw = mmkv.getString(NOTIFIED_KEY);
        return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
        return new Set();
    }
}

function saveNotified(s: Set<string>) {
    try {
        mmkv.set(NOTIFIED_KEY, JSON.stringify([...s]));
    } catch { /* best-effort */ }
}

// ─── Raw session shape from /v1/sessions ─────────────────────────────────────
// We only read `id` and `active` — all other fields (metadata, agentState) are
// encrypted strings and must NOT be accessed here.
interface RawSession {
    id: string;
    active: boolean;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Poll /v1/sessions and fire a local notification for any session that
 * transitioned from active → inactive since the last snapshot.
 *
 * Safe to call from both foreground (AppState → active) and background
 * (BackgroundFetch task).
 *
 * Returns true if at least one notification was fired.
 */
export async function checkCompletedSessions(): Promise<boolean> {
    const credentials = await TokenStorage.getCredentials();
    if (!credentials) return false;

    try {
        const res = await fetch(`${getServerUrl()}/v1/sessions`, {
            headers: { Authorization: `Bearer ${credentials.token}` },
        });
        if (!res.ok) return false;

        const { sessions = [] }: { sessions: RawSession[] } = await res.json();
        const snapshot = loadSnapshot();
        const notified = getNotified();
        let hasNew = false;

        for (const s of sessions) {
            const prev = snapshot.sessions[s.id];
            const wasActive = prev?.active ?? false;
            const completedNow = wasActive && !s.active;
            const alreadyNotified = notified.has(s.id);

            if (completedNow && !alreadyNotified) {
                // Use the title stored in the snapshot (set from foreground where
                // decryption runs). Falls back to undefined if not yet cached.
                const title = prev?.title;
                await sendLocalReadyNotification(s.id, title);
                notified.add(s.id);
                hasNew = true;
            }

            // Update snapshot active state; preserve title from previous snapshot entry.
            snapshot.sessions[s.id] = {
                active: s.active,
                title: prev?.title ?? '',
            };
        }

        if (hasNew) saveNotified(notified);
        saveSnapshot(snapshot);
        return hasNew;
    } catch (e) {
        console.warn('[sessionNotifier] checkCompletedSessions error:', e);
        return false;
    }
}

/**
 * Call when the user opens a session page.
 * Clears the "already notified" flag so the next completion fires a fresh notification.
 */
export function onEnterSession(sessionId: string): void {
    const notified = getNotified();
    if (notified.has(sessionId)) {
        notified.delete(sessionId);
        saveNotified(notified);
    }
}

/**
 * Mark a session as notified.
 * Called from the foreground WebSocket ready-event path in sync.ts so the
 * background task doesn't double-fire for the same completion.
 */
export function markNotified(sessionId: string): void {
    const notified = getNotified();
    if (!notified.has(sessionId)) {
        notified.add(sessionId);
        saveNotified(notified);
    }
}
