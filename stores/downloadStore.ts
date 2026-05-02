import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DownloadItem, DownloadTask, DownloadStatus } from '../types';

interface DownloadState {
    items: Record<string, DownloadItem>;
    tasks: Record<string, DownloadTask>;

    addTask: (task: DownloadTask) => void;
    updateTask: (id: string, patch: Partial<DownloadTask>) => void;
    removeTask: (id: string) => void;

    addItem: (item: DownloadItem) => void;
    removeItem: (id: string) => void;

    getItem: (id: string) => DownloadItem | undefined;
    getTask: (id: string) => DownloadTask | undefined;
    getItemsByMediaId: (mediaId: string) => DownloadItem[];
    getTasksByStatus: (status: DownloadStatus) => DownloadTask[];
    getTotalBytes: () => number;
    hasDownload: (id: string) => boolean;
}

export const useDownloadStore = create<DownloadState>()(
    persist(
        (set, get) => ({
            items: {},
            tasks: {},

            addTask: (task) =>
                set((s) => ({ tasks: { ...s.tasks, [task.id]: task } })),

            updateTask: (id, patch) =>
                set((s) => {
                    const existing = s.tasks[id];
                    if (!existing) return s;
                    return { tasks: { ...s.tasks, [id]: { ...existing, ...patch } } };
                }),

            removeTask: (id) =>
                set((s) => {
                    const tasks = { ...s.tasks };
                    delete tasks[id];
                    return { tasks };
                }),

            addItem: (item) =>
                set((s) => ({ items: { ...s.items, [item.id]: item } })),

            removeItem: (id) =>
                set((s) => {
                    const items = { ...s.items };
                    delete items[id];
                    return { items };
                }),

            getItem: (id) => get().items[id],
            getTask: (id) => get().tasks[id],

            getItemsByMediaId: (mediaId) =>
                Object.values(get().items).filter((i) => i.mediaId === mediaId),

            getTasksByStatus: (status) =>
                Object.values(get().tasks).filter((t) => t.status === status),

            getTotalBytes: () =>
                Object.values(get().items).reduce((acc, i) => acc + i.fileSize, 0),

            hasDownload: (id) =>
                !!get().items[id] ||
                (['queued', 'downloading', 'paused'].includes(
                    get().tasks[id]?.status ?? ''
                )),
        }),
        {
            name: 'saimo-downloads-v1',
            storage: createJSONStorage(() => AsyncStorage),
            partialize: (state) => ({
                items: state.items,
                // Persist all non-terminal tasks.
                // `downloading` saved as `paused` so they restart on next open.
                // `failed` saved so user can see and retry them.
                tasks: Object.fromEntries(
                    Object.entries(state.tasks)
                        .filter(([, t]) => ['downloading', 'paused', 'queued', 'failed'].includes(t.status))
                        .map(([id, t]) => [
                            id,
                            t.status === 'downloading' ? { ...t, status: 'paused' as const } : t,
                        ])
                ),
            }),
        }
    )
);
