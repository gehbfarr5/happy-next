import { MMKV } from 'react-native-mmkv';

/**
 * MMKV-backed snapshot of session active states and titles.
 *
 * Written from the JS (foreground) context so the background task
 * can compare without any decryption logic.
 *
 * Shape stored in MMKV under SNAPSHOT_KEY:
 *   {
 *     sessions: Record<sessionId, { active: boolean; title: string }>;
 *     snapshotAt: number;      // Unix ms
 *   }
 */

const snapshotStorage = new MMKV({ id: 'session-snapshot' });
const SNAPSHOT_KEY = 'snapshot';

export interface SessionEntry {
    active: boolean;
    title: string;
}

export interface SessionSnapshot {
    sessions: Record<string, SessionEntry>;
    snapshotAt: number;
}

function empty(): SessionSnapshot {
    return { sessions: {}, snapshotAt: 0 };
}

export function loadSnapshot(): SessionSnapshot {
    try {
        const raw = snapshotStorage.getString(SNAPSHOT_KEY);
        if (!raw) return empty();
        return JSON.parse(raw) as SessionSnapshot;
    } catch {
        return empty();
    }
}

export function saveSnapshot(snapshot: SessionSnapshot): void {
    try {
        snapshotStorage.set(SNAPSHOT_KEY, JSON.stringify(snapshot));
    } catch {
        // Best-effort — never crash for snapshot writes
    }
}

/**
 * Called when the app transitions to background.
 * Captures the current active states and titles from Zustand storage
 * so the background task can diff without decryption.
 */
export function snapshotActiveSessions(): void {
    try {
        // Lazy-import to avoid circular deps at module load time
        const { storage } = require('./storage') as typeof import('./storage');
        const { getSessionName } = require('@/utils/sessionUtils') as typeof import('@/utils/sessionUtils');

        const sessions = storage.getState().sessions;
        const prev = loadSnapshot();

        const updated: Record<string, SessionEntry> = {};
        for (const [id, session] of Object.entries(sessions)) {
            updated[id] = {
                active: session.active,
                title: getSessionName(session),
            };
        }

        saveSnapshot({
            sessions: updated,
            snapshotAt: Date.now(),
        });
    } catch {
        // Best-effort
    }
}

