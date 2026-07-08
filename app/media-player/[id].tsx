import React, {
    useEffect, useState, useRef, useCallback, useMemo,
} from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Pressable,
    StatusBar, BackHandler, Dimensions, ActivityIndicator,
    Platform, Animated, PanResponder, Modal,
} from 'react-native';
import Video, { VideoRef } from 'react-native-video';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as NavigationBar from 'expo-navigation-bar';
import { CastButton, useRemoteMediaClient } from 'react-native-google-cast';

import { Colors, Spacing, BorderRadius } from '../../constants/Colors';
import { useMediaStore } from '../../stores/mediaStore';
import { useDownloadStore } from '../../stores/downloadStore';
import {
    STRATEGIES, resolveUrlViaGet, detectSourceType,
} from '../../services/playerStrategies';
import { getItemAPI } from '../../services/apiService';
import * as Brightness from 'expo-brightness';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const OSD_HIDE_DELAY = 5500;
const SEEK_SECONDS = 10;
const DOUBLE_TAP_DELAY = 300;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const NEXT_EP_COUNTDOWN = 7;
const RESIZE_MODES = ['contain', 'cover', 'stretch'] as const;
type ResizeMode = typeof RESIZE_MODES[number];
const RESIZE_LABELS: Record<ResizeMode, string> = { contain: 'Normal', cover: 'Preencher', stretch: 'Esticar' };
const SLEEP_OPTIONS = [15, 30, 45, 60] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatTime(s: number): string {
    if (!isFinite(s) || s < 0) return '0:00';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${m}:${String(sec).padStart(2, '0')}`;
}

function toResLabel(h: number): string {
    if (h >= 2160) return '4K';
    if (h >= 1440) return '2K';
    if (h >= 1080) return '1080p';
    if (h >= 720) return '720p';
    if (h >= 480) return '480p';
    return `${h}p`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

/** Animated ripple on double-tap seek */
function SeekRipple({ side, anim }: { side: 'left' | 'right'; anim: Animated.Value }) {
    const scale = anim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.6, 1.1, 1.4] });
    const opacity = anim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.55, 0] });
    return (
        <Animated.View
            pointerEvents="none"
            style={[
                styles.seekRipple,
                side === 'left' ? styles.seekRippleLeft : styles.seekRippleRight,
                { opacity, transform: [{ scale }] },
            ]}
        >
            <View style={styles.seekRippleInner}>
                <Ionicons
                    name={side === 'left' ? 'play-back' : 'play-forward'}
                    size={28}
                    color="#fff"
                />
                <Text style={styles.seekRippleText}>
                    {side === 'left' ? `-${SEEK_SECONDS}s` : `+${SEEK_SECONDS}s`}
                </Text>
            </View>
        </Animated.View>
    );
}

/** Vertical slider that shows volume or brightness feedback */
function SidebarIndicator({
    visible, icon, value,
}: { visible: boolean; icon: string; value: number }) {
    if (!visible) return null;
    const pct = Math.round(value * 100);
    return (
        <View style={styles.sidebarIndicator}>
            <Ionicons name={icon as any} size={20} color="#fff" />
            <View style={styles.sidebarTrack}>
                <View style={[styles.sidebarFill, { height: `${pct}%` as any }]} />
            </View>
            <Text style={styles.sidebarText}>{pct}%</Text>
        </View>
    );
}

/** Speed selection bottom sheet */
function SpeedSheet({
    visible, current, onSelect, onClose,
}: {
    visible: boolean;
    current: number;
    onSelect: (s: number) => void;
    onClose: () => void;
}) {
    return (
        <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
            <Pressable style={styles.sheetBackdrop} onPress={onClose}>
                <Pressable style={styles.sheetContainer} onPress={() => {}}>
                    <View style={styles.sheetHandle} />
                    <Text style={styles.sheetTitle}>Velocidade de reprodução</Text>
                    <View style={styles.speedGrid}>
                        {SPEEDS.map((s) => (
                            <TouchableOpacity
                                key={s}
                                style={[styles.speedChip, current === s && styles.speedChipActive]}
                                onPress={() => { onSelect(s); onClose(); }}
                            >
                                <Text style={[styles.speedChipText, current === s && styles.speedChipTextActive]}>
                                    {s === 1 ? 'Normal' : `${s}×`}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </Pressable>
            </Pressable>
        </Modal>
    );
}

/** Sleep timer bottom sheet */
function SleepSheet({
    visible, remaining, onSelect, onCancel, onClose,
}: {
    visible: boolean;
    remaining: number | null; // seconds remaining or null if off
    onSelect: (minutes: number) => void;
    onCancel: () => void;
    onClose: () => void;
}) {
    return (
        <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
            <Pressable style={styles.sheetBackdrop} onPress={onClose}>
                <Pressable style={styles.sheetContainer} onPress={() => {}}>
                    <View style={styles.sheetHandle} />
                    <Text style={styles.sheetTitle}>Timer de descanso</Text>
                    {remaining !== null && (
                        <Text style={styles.sleepRemaining}>
                            ⏱ Para em {Math.ceil(remaining / 60)} min
                        </Text>
                    )}
                    <View style={styles.speedGrid}>
                        {SLEEP_OPTIONS.map((m) => (
                            <TouchableOpacity
                                key={m}
                                style={styles.speedChip}
                                onPress={() => { onSelect(m); onClose(); }}
                            >
                                <Text style={styles.speedChipText}>{m} min</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                    {remaining !== null && (
                        <TouchableOpacity style={styles.sleepCancelBtn} onPress={() => { onCancel(); onClose(); }}>
                            <Text style={styles.sleepCancelText}>Cancelar timer</Text>
                        </TouchableOpacity>
                    )}
                </Pressable>
            </Pressable>
        </Modal>
    );
}

/** Audio/Text track selection bottom sheet */
function TrackSheet({
    visible, title, tracks, selectedId, onSelect, onClose,
}: {
    visible: boolean;
    title: string;
    tracks: Array<{ id: number | string; label: string }>;
    selectedId: number | string | null;
    onSelect: (id: number | string) => void;
    onClose: () => void;
}) {
    return (
        <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
            <Pressable style={styles.sheetBackdrop} onPress={onClose}>
                <Pressable style={styles.sheetContainer} onPress={() => {}}>
                    <View style={styles.sheetHandle} />
                    <Text style={styles.sheetTitle}>{title}</Text>
                    {tracks.map((t) => (
                        <TouchableOpacity
                            key={t.id}
                            style={styles.trackRow}
                            onPress={() => { onSelect(t.id); onClose(); }}
                        >
                            <Ionicons
                                name={t.id === selectedId ? 'radio-button-on' : 'radio-button-off'}
                                size={18}
                                color={t.id === selectedId ? Colors.primary : 'rgba(255,255,255,0.5)'}
                            />
                            <Text style={[styles.trackLabel, t.id === selectedId && styles.trackLabelActive]}>
                                {t.label}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </Pressable>
            </Pressable>
        </Modal>
    );
}


/** Draggable progress bar */
function ProgressBar({
    current, duration, buffered,
    onSeek, isSeeking, onSeekStart, onSeekEnd,
}: {
    current: number;
    duration: number;
    buffered: number;
    onSeek: (t: number) => void;
    isSeeking: boolean;
    onSeekStart: (pct: number) => void;
    onSeekEnd: (pct: number) => void;
}) {
    const barRef = useRef<View>(null);
    const barLayoutRef = useRef<{ x: number; width: number }>({ x: 0, width: 1 });
    const [dragging, setDragging] = useState(false);
    const [dragPct, setDragPct] = useState(0);

    // Measure the bar on layout to get absolute pageX position
    const onLayout = useCallback(() => {
        barRef.current?.measure((_fx, _fy, width, _height, pageX) => {
            barLayoutRef.current = { x: pageX, width: Math.max(1, width) };
        });
    }, []);

    const pctFromPageX = (pageX: number) => {
        const { x, width } = barLayoutRef.current;
        return Math.max(0, Math.min(1, (pageX - x) / width));
    };

    const panResponder = useMemo(() => PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false, // never yield to outer PanResponder

        onPanResponderGrant: (e) => {
            const pct = pctFromPageX(e.nativeEvent.pageX);
            setDragging(true);
            setDragPct(pct);
            onSeekStart(pct);
        },
        onPanResponderMove: (e) => {
            const pct = pctFromPageX(e.nativeEvent.pageX);
            setDragPct(pct);
            onSeekStart(pct); // keep preview updated
        },
        onPanResponderRelease: (e) => {
            const pct = pctFromPageX(e.nativeEvent.pageX);
            setDragging(false);
            onSeekEnd(pct);
            if (duration > 0) onSeek(pct * duration);
        },
        onPanResponderTerminate: () => {
            setDragging(false);
            onSeekEnd(dragPct);
        },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [duration, onSeek, onSeekStart, onSeekEnd]);

    const progress = duration > 0
        ? (dragging || isSeeking) ? dragPct : current / duration
        : 0;
    const bufPct = duration > 0 ? Math.min(1, buffered / duration) : 0;
    const tooltipTime = dragPct * duration;

    return (
        <View
            ref={barRef}
            style={styles.progressWrapper}
            onLayout={onLayout}
            {...panResponder.panHandlers}
        >
            {/* Tooltip */}
            {dragging && duration > 0 && (
                <View style={[
                    styles.tooltip,
                    {
                        left: Math.max(20, Math.min(
                            dragPct * barLayoutRef.current.width - 20,
                            barLayoutRef.current.width - 50,
                        )),
                    },
                ]}>
                    <Text style={styles.tooltipText}>{formatTime(tooltipTime)}</Text>
                </View>
            )}

            {/* Track */}
            <View style={styles.progressTrack}>
                {/* Buffered */}
                <View style={[styles.progressBuffered, { width: `${bufPct * 100}%` as any }]} />
                {/* Played */}
                <View style={[styles.progressFill, { width: `${progress * 100}%` as any }]} />
                {/* Thumb */}
                <View
                    style={[
                        styles.progressThumb,
                        { left: `${progress * 100}%` as any },
                        dragging && styles.progressThumbActive,
                    ]}
                />
            </View>
        </View>
    );
}

/** Auto-play next episode card */
function NextEpisodeCard({
    episode, countdown, onPlay, onCancel,
}: {
    episode: { title: string; subtitle?: string };
    countdown: number;
    onPlay: () => void;
    onCancel: () => void;
}) {
    return (
        <View style={styles.nextEpCard}>
            <Text style={styles.nextEpLabel}>A seguir</Text>
            <Text style={styles.nextEpTitle} numberOfLines={1}>{episode.title}</Text>
            {episode.subtitle ? <Text style={styles.nextEpSub}>{episode.subtitle}</Text> : null}
            <View style={styles.nextEpCountdownBar}>
                <Animated.View style={[styles.nextEpCountdownFill, { width: `${(countdown / NEXT_EP_COUNTDOWN) * 100}%` as any }]} />
            </View>
            <View style={styles.nextEpButtons}>
                <TouchableOpacity style={styles.nextEpPlay} onPress={onPlay}>
                    <Ionicons name="play" size={14} color="#000" />
                    <Text style={styles.nextEpPlayText}>Reproduzir ({countdown}s)</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.nextEpCancel} onPress={onCancel}>
                    <Text style={styles.nextEpCancelText}>Cancelar</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────────────────────

export default function MediaPlayerScreen() {
    const params = useLocalSearchParams<{
        id: string; url: string; title: string;
        seriesId?: string; season?: string;
        nextId?: string; nextUrl?: string; nextTitle?: string;
        nextSeason?: string; nextEpisode?: string;
        offline?: string;
    }>();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { addToHistory, setSeriesProgress, getProgress } = useMediaStore();
    const client = useRemoteMediaClient();
    const tasks = useDownloadStore((s) => s.tasks);
    const items = useDownloadStore((s) => s.items);

    // Resolve remote URL for Cast even when playing an offline file
    const castUrl = useMemo(() => {
        if (!params.id) return null;
        const task = tasks[params.id];
        if (task?.remoteUrl) return task.remoteUrl;
        const item = items[params.id];
        // items don't store remoteUrl but tasks do — just in case
        return null;
    }, [params.id, tasks, items]);

    const rawUrl = params.url || '';
    const decodedUrl = rawUrl ? decodeURIComponent(rawUrl) : '';
    const isOffline = params.offline === '1' || decodedUrl.startsWith('file://');

    // ── Episode state ──────────────────────────────────────────────────────
    const [currentTitle, setCurrentTitle] = useState(params.title || '');
    const [activeUrl, setActiveUrl] = useState(decodedUrl);
    const [nextEpisode] = useState<{
        id: string; url: string; title: string; season: string; episode: string;
    } | null>(
        params.nextId && params.nextUrl
            ? {
                  id: params.nextId,
                  url: decodeURIComponent(params.nextUrl),
                  title: params.nextTitle || '',
                  season: params.nextSeason || '',
                  episode: params.nextEpisode || '',
              }
            : null,
    );
    const [showNextCard, setShowNextCard] = useState(false);
    const [nextCountdown, setNextCountdown] = useState(NEXT_EP_COUNTDOWN);
    const [nextCardDismissed, setNextCardDismissed] = useState(false);

    // Intelligent next episode detection
    const resolvedNextEpisode = useMemo(() => {
        // 1. If we already have one from navigation params, use it
        if (nextEpisode) return nextEpisode;

        // 2. Otherwise, check if this is a series and look in downloads
        // seriesId might be in params or in the current item snapshot
        const currentId = params.id;
        if (!currentId) return null;

        const currentItem = items[currentId];
        const sId = params.seriesId || currentItem?.seriesId;

        if (sId) {
            const episodes = Object.values(items).filter(i => i.seriesId === sId && i.itemType === 'episode');
            const sNum = currentItem?.seasonNumber || (params.season ? parseInt(params.season) : null);
            const eNum = currentItem?.episodeNumber || (params.nextEpisode ? parseInt(params.nextEpisode) - 1 : null);

            if (sNum !== null && eNum !== null) {
                // Try next episode same season
                let next = episodes.find(e => e.seasonNumber === sNum && e.episodeNumber === eNum + 1);
                if (!next) {
                    // Try first episode next season
                    next = episodes.find(e => e.seasonNumber === sNum + 1 && e.episodeNumber === 1);
                }

                if (next) {
                    return {
                        id: next.id,
                        url: next.localPath,
                        title: next.title,
                        season: String(next.seasonNumber),
                        episode: String(next.episodeNumber),
                    };
                }
            }
        }

        return null;
    }, [nextEpisode, params.seriesId, params.id, params.season, params.nextEpisode, items]);

    // ── Video / strategy state ─────────────────────────────────────────────
    const [videoKey, setVideoKey] = useState(0);
    const [strategyIdx, setStrategyIdx] = useState(0);
    const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [isCasting, setIsCasting] = useState(false);

    // ── Playback state ─────────────────────────────────────────────────────
    const [paused, setPaused] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [buffered, setBuffered] = useState(0);
    const [volume, setVolume] = useState(1);
    const [rate, setRate] = useState(1);
    const [resolution, setResolution] = useState<string | null>(null);
    const [isSeeking, setIsSeeking] = useState(false);
    const seekPreviewPctRef = useRef(0);

    // ── New feature state ─────────────────────────────────────────────────
    const [resizeMode, setResizeMode] = useState<ResizeMode>('contain');
    const [showSleep, setShowSleep] = useState(false);
    const [sleepRemaining, setSleepRemaining] = useState<number | null>(null);
    const sleepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [isPiP, setIsPiP] = useState(false);
    const [audioTracks, setAudioTracks] = useState<Array<{ id: number; label: string }>>([]);
    const [textTracks, setTextTracks] = useState<Array<{ id: number; label: string }>>([]);
    const [selectedAudio, setSelectedAudio] = useState<number | null>(null);
    const [selectedText, setSelectedText] = useState<number | null>(null);
    const [showAudioSheet, setShowAudioSheet] = useState(false);
    const [showTextSheet, setShowTextSheet] = useState(false);
    const brightnessRef = useRef<number>(1); // original brightness to restore

    // ── OSD state ──────────────────────────────────────────────────────────
    const [showOSD, setShowOSD] = useState(true);
    const [locked, setLocked] = useState(false);
    const [showSpeed, setShowSpeed] = useState(false);
    const [showVolume, setShowVolume] = useState(false);
    const [showBrightness, setShowBrightness] = useState(false);
    const osdAnim = useRef(new Animated.Value(1)).current;

    // ── Refs ───────────────────────────────────────────────────────────────
    const videoRef = useRef<VideoRef>(null);
    const isMountedRef = useRef(true);
    const osdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastTapRef = useRef<{ side: 'left' | 'right'; time: number } | null>(null);
    const nextCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const leftRippleAnim = useRef(new Animated.Value(0)).current;
    const rightRippleAnim = useRef(new Animated.Value(0)).current;
    const gestureStartRef = useRef({ x: 0, y: 0, volume: 1 });
    const sidebarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const strategyIdxRef = useRef(0); // mirror for use inside callbacks
    const hasFetchedFreshUrl = useRef(false);

    // ── Save progress periodically ────────────────────────────────────────
    useEffect(() => {
        if (!params.id || duration <= 0 || currentTime <= 0 || paused) return;

        const interval = setInterval(() => {
            addToHistory(params.id, currentTime, duration);

            // If it's a series, also update series-level progress
            if (params.seriesId && params.season) {
                // We try to estimate current episode from title or params if not explicit
                const epNum = params.nextEpisode ? parseInt(params.nextEpisode) - 1 : 0;
                setSeriesProgress(
                    params.seriesId,
                    parseInt(params.season),
                    epNum,
                    params.id,
                    currentTime,
                    duration
                );
            }
        }, 5000);

        return () => clearInterval(interval);
    }, [params.id, params.seriesId, params.season, params.nextEpisode, currentTime, duration, paused, addToHistory, setSeriesProgress]);

    // ─────────────────────────────────────────────────────────────────────
    // Fullscreen / lifecycle
    // ─────────────────────────────────────────────────────────────────────

    useEffect(() => {
        isMountedRef.current = true;
        (async () => {
            try {
                await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
                if (Platform.OS === 'android') {
                    await NavigationBar.setPositionAsync('absolute');
                    await NavigationBar.setBackgroundColorAsync('#00000000');
                    await NavigationBar.setVisibilityAsync('hidden');
                    await NavigationBar.setBehaviorAsync('overlay-swipe');
                }
                // Save current brightness so we can restore on exit
                const { brightness } = await Brightness.getPermissionsAsync()
                    .then(async (perm) => {
                        if (perm.granted) {
                            return { brightness: await Brightness.getBrightnessAsync() };
                        }
                        return { brightness: 1 };
                    })
                    .catch(() => ({ brightness: 1 }));
                brightnessRef.current = brightness;
            } catch {}
        })();
        return () => {
            isMountedRef.current = false;
            if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
            if (nextCountdownRef.current) clearInterval(nextCountdownRef.current);
            if (sidebarTimerRef.current) clearTimeout(sidebarTimerRef.current);
            if (sleepTimerRef.current) clearInterval(sleepTimerRef.current);
            (async () => {
                try {
                    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
                    if (Platform.OS === 'android') await NavigationBar.setVisibilityAsync('visible');
                    // Restore brightness
                    await Brightness.setBrightnessAsync(brightnessRef.current).catch(() => {});
                } catch {}
            })();
        };
    }, []);

    // Back handler
    useEffect(() => {
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            if (locked) return true;
            if (showSpeed) { setShowSpeed(false); return true; }
            if (showSleep) { setShowSleep(false); return true; }
            if (showAudioSheet) { setShowAudioSheet(false); return true; }
            if (showTextSheet) { setShowTextSheet(false); return true; }
            handleClose();
            return true;
        });
        return () => sub.remove();
    }, [locked, showSpeed, showSleep, showAudioSheet, showTextSheet]);

    // ─────────────────────────────────────────────────────────────────────
    // URL resolution + strategy
    // ─────────────────────────────────────────────────────────────────────

    useEffect(() => {
        if (!decodedUrl) { setHasError(true); setErrorMsg('URL inválida'); setIsLoading(false); return; }
        if (isOffline) { setResolvedUrl(decodedUrl); return; }
        // Start with strategy 0 (VLC UA), no pre-fetch needed
        setResolvedUrl(decodedUrl);
    }, [decodedUrl, isOffline]);

    const tryNextStrategy = useCallback(async () => {
        if (!isMountedRef.current) return;

        const next = strategyIdxRef.current + 1;

        // Strategy 2: resolve final URL via GET (follow redirects)
        if (next === 2 && !isOffline) {
            strategyIdxRef.current = next;
            setStrategyIdx(next);
            setIsLoading(true);
            setHasError(false);
            const resolved = await resolveUrlViaGet(decodedUrl);
            if (!isMountedRef.current) return;
            setResolvedUrl(resolved);
            setVideoKey((k) => k + 1);
            return;
        }

        // Strategy 3 or exhausted strategies: try fresh URL from API
        if (next >= STRATEGIES.length && !hasFetchedFreshUrl.current && params.id && !isOffline) {
            hasFetchedFreshUrl.current = true;
            setIsLoading(true);
            setHasError(false);
            try {
                const media = await getItemAPI(params.id);
                let freshUrl = decodedUrl;
                if (params.seriesId && params.season) {
                    for (const season of Object.values(media.episodes ?? {})) {
                        const ep = season.find((e: any) => e.id === params.id);
                        if (ep) { freshUrl = ep.url; break; }
                    }
                } else {
                    freshUrl = media.url;
                }
                if (!isMountedRef.current) return;
                setActiveUrl(freshUrl);
                setResolvedUrl(freshUrl);
                strategyIdxRef.current = 0;
                setStrategyIdx(0);
                setVideoKey((k) => k + 1);
            } catch {
                if (!isMountedRef.current) return;
                setHasError(true);
                setIsLoading(false);
                setErrorMsg('Não foi possível reproduzir este conteúdo');
            }
            return;
        }

        if (next >= STRATEGIES.length) {
            setHasError(true);
            setIsLoading(false);
            setErrorMsg('Não foi possível reproduzir este conteúdo');
            return;
        }

        strategyIdxRef.current = next;
        setStrategyIdx(next);
        setIsLoading(true);
        setHasError(false);
        setVideoKey((k) => k + 1);
    }, [decodedUrl, isOffline, params.id, params.seriesId, params.season]);

    // ─────────────────────────────────────────────────────────────────────
    // Cast
    // ─────────────────────────────────────────────────────────────────────

    useEffect(() => {
        // Use castUrl (remote) if playing offline, otherwise use resolvedUrl
        const urlToCast = isOffline ? castUrl : resolvedUrl;

        if (client && urlToCast) {
            client.loadMedia({
                mediaInfo: {
                    contentUrl: urlToCast,
                    metadata: { title: currentTitle, type: 'movie' },
                },
                autoplay: true,
            });
            try { videoRef.current?.pause(); } catch { }
            setIsCasting(true);
        } else {
            setIsCasting(false);
        }
    }, [client, castUrl, resolvedUrl, isOffline]);

    // ─────────────────────────────────────────────────────────────────────
    // OSD show / hide
    // ─────────────────────────────────────────────────────────────────────

    const hideOSD = useCallback(() => {
        Animated.timing(osdAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
            if (isMountedRef.current) setShowOSD(false);
        });
    }, [osdAnim]);

    const revealOSD = useCallback((autoHide = true) => {
        if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
        setShowOSD(true);
        Animated.timing(osdAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
        if (autoHide && !paused) {
            osdTimerRef.current = setTimeout(hideOSD, OSD_HIDE_DELAY);
        }
    }, [osdAnim, hideOSD, paused]);

    // Keep OSD visible while paused
    useEffect(() => {
        if (paused) {
            if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
            revealOSD(false);
        } else {
            revealOSD(true);
        }
    }, [paused]);

    // ─────────────────────────────────────────────────────────────────────
    // Video callbacks
    // ─────────────────────────────────────────────────────────────────────

    const onLoad = useCallback((data: any) => {
        if (!isMountedRef.current) return;
        setIsLoading(false);
        setHasError(false);
        const d = data?.duration;
        if (d && isFinite(d) && d > 0) setDuration(d);
        const h = data?.naturalSize?.height;
        if (h && h > 0) setResolution(toResLabel(h));

        // Capture tracks
        if (data.audioTracks) {
            setAudioTracks(data.audioTracks.map((t: any) => ({
                id: t.index,
                label: t.language || t.title || `Áudio ${t.index + 1}`
            })));
        }
        if (data.textTracks) {
            setTextTracks(data.textTracks.map((t: any) => ({
                id: t.index,
                label: t.language || t.title || `Legenda ${t.index + 1}`
            })));
        }

        // Resume progress if exists
        if (d && d > 0) {
            const saved = getProgress(params.id);
            if (saved && saved.progress && saved.progress > 10 && saved.progress < (d - 15)) {
                videoRef.current?.seek(saved.progress);
            }
        }
    }, [params.id, getProgress]);

    const onProgress = useCallback((data: any) => {
        if (!isMountedRef.current) return;
        // Block progress updates while the user is scrubbing the progress bar
        // so the thumb doesn't fight back against the drag position.
        if (!isSeeking) {
            const time = data.currentTime ?? 0;
            setCurrentTime(time);

            // Intelligent early trigger: 30s before end
            if (duration > 60 && (duration - time) <= 30 && resolvedNextEpisode && !showNextCard && !nextCardDismissed) {
                setShowNextCard(true);
            }
        }
        const pb = data.playableDuration ?? 0;
        if (pb > 0) setBuffered(pb);
        // Use seekableDuration as fallback if onLoad didn't set duration
        const sd = data.seekableDuration ?? 0;
        if (sd > 0) setDuration((prev) => (prev > 0 ? prev : sd));
    }, [isSeeking, duration, resolvedNextEpisode, showNextCard, nextCardDismissed]);

    const onVideoTracks = useCallback((data: any) => {
        const tracks = data?.videoTracks ?? [];
        const maxH = tracks.reduce((m: number, t: any) => Math.max(m, t.height ?? 0), 0);
        if (maxH > 0) setResolution(toResLabel(maxH));
    }, []);

    const onError = useCallback((_err: any) => {
        if (!isMountedRef.current) return;
        setIsLoading(false);
        tryNextStrategy();
    }, [tryNextStrategy]);

    const onBuffer = useCallback(({ isBuffering }: { isBuffering: boolean }) => {
        if (!isMountedRef.current) return;
        setIsLoading(isBuffering);
    }, []);

    const onEnd = useCallback(() => {
        if (!isMountedRef.current) return;
        if (resolvedNextEpisode) {
            setShowNextCard(true);
            setNextCountdown(NEXT_EP_COUNTDOWN);
            if (nextCountdownRef.current) clearInterval(nextCountdownRef.current);
            nextCountdownRef.current = setInterval(() => {
                setNextCountdown((c) => {
                    if (c <= 1) {
                        clearInterval(nextCountdownRef.current!);
                        handleNextEpisode();
                        return 0;
                    }
                    return c - 1;
                });
            }, 1000);
        }
    }, [resolvedNextEpisode, handleNextEpisode]);

    const onPictureInPictureStatusChanged = useCallback((data: { isActive: boolean }) => {
        setIsPiP(data.isActive);
    }, []);

    const handleAudioSelect = useCallback((id: number | string) => {
        setSelectedAudio(id as number);
    }, []);

    const handleTextSelect = useCallback((id: number | string) => {
        setSelectedText(id as number);
    }, []);

    // ─────────────────────────────────────────────────────────────────────
    // Playback controls
    // ─────────────────────────────────────────────────────────────────────

    const handleClose = useCallback(() => {
        isMountedRef.current = false;
        if (params.id) {
            addToHistory(params.id, currentTime, duration);
            if (params.seriesId && params.season) {
                const epNum = params.nextEpisode ? parseInt(params.nextEpisode) - 1 : 0;
                setSeriesProgress(params.seriesId, parseInt(params.season), epNum, params.id, currentTime, duration);
            }
        }
        router.back();
    }, [params.id, params.seriesId, params.season, params.nextEpisode, currentTime, duration, router, addToHistory, setSeriesProgress]);

    const togglePause = useCallback(() => {
        setPaused((p) => !p);
        revealOSD(!paused);
    }, [paused, revealOSD]);

    const seek = useCallback((t: number) => {
        videoRef.current?.seek(Math.max(0, t));
    }, []);

    // Called while user is dragging — locks out onProgress updates
    const handleSeekStart = useCallback((pct: number) => {
        seekPreviewPctRef.current = pct;
        setIsSeeking(true);
    }, []);

    // Called when user releases — commits the seek and unlocks onProgress
    const handleSeekEnd = useCallback((_pct: number) => {
        setIsSeeking(false);
    }, []);

    const skipBy = useCallback((delta: number) => {
        seek(currentTime + delta);
    }, [currentTime, seek]);

    const handleNextEpisode = useCallback(() => {
        const next = resolvedNextEpisode;
        if (!next) return;
        if (nextCountdownRef.current) clearInterval(nextCountdownRef.current);
        setShowNextCard(false);
        if (params.seriesId && params.season) {
            setSeriesProgress(
                params.seriesId,
                parseInt(params.season),
                parseInt(next.episode),
                next.id,
            );
        }
        setCurrentTitle(next.title);
        setCurrentTime(0);
        setDuration(0);
        setBuffered(0);
        setHasError(false);
        setIsLoading(true);
        strategyIdxRef.current = 0;
        setStrategyIdx(0);
        hasFetchedFreshUrl.current = false;
        setActiveUrl(next.url);
        setResolvedUrl(next.url);
        setVideoKey((k) => k + 1);
    }, [resolvedNextEpisode, params.seriesId, params.season, setSeriesProgress]);
    const toggleAspectRatio = useCallback(() => {
        setResizeMode((prev) => {
            const idx = RESIZE_MODES.indexOf(prev);
            return RESIZE_MODES[(idx + 1) % RESIZE_MODES.length];
        });
    }, []);

    const startSleepTimer = useCallback((minutes: number) => {
        if (sleepTimerRef.current) clearInterval(sleepTimerRef.current);
        let seconds = minutes * 60;
        setSleepRemaining(seconds);

        sleepTimerRef.current = setInterval(() => {
            seconds -= 1;
            if (seconds <= 0) {
                if (sleepTimerRef.current) clearInterval(sleepTimerRef.current);
                setSleepRemaining(null);
                setPaused(true);
                handleClose();
            } else {
                setSleepRemaining(seconds);
            }
        }, 1000);
    }, [handleClose]);

    const cancelSleepTimer = useCallback(() => {
        if (sleepTimerRef.current) clearInterval(sleepTimerRef.current);
        setSleepRemaining(null);
    }, []);
    // ─────────────────────────────────────────────────────────────────────
    // Gestures (PanResponder on whole video area)
    // ─────────────────────────────────────────────────────────────────────

    const fireRipple = useCallback((side: 'left' | 'right') => {
        const anim = side === 'left' ? leftRippleAnim : rightRippleAnim;
        anim.setValue(0);
        Animated.timing(anim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
    }, [leftRippleAnim, rightRippleAnim]);

    const hideSidebar = useCallback(() => {
        if (sidebarTimerRef.current) clearTimeout(sidebarTimerRef.current);
        sidebarTimerRef.current = setTimeout(() => {
            if (!isMountedRef.current) return;
            setShowVolume(false);
            setShowBrightness(false);
        }, 1200);
    }, []);

    const screenWidth = Dimensions.get('window').width;

    const screenHeight = Dimensions.get('window').height;

    const panResponder = useMemo(() => PanResponder.create({
        // Don't claim touches in bottom 28% of screen — that's where the progress bar lives
        onStartShouldSetPanResponder: (e) =>
            !locked && e.nativeEvent.locationY < screenHeight * 0.72,
        // Only steal VERTICAL moves (volume/brightness) — never steal horizontal (progress bar drag)
        onMoveShouldSetPanResponder: (_e, gs) =>
            !locked && Math.abs(gs.dy) > 12 && Math.abs(gs.dy) > Math.abs(gs.dx) * 1.5,

        onPanResponderGrant: (e) => {
            gestureStartRef.current = {
                x: e.nativeEvent.locationX,
                y: e.nativeEvent.locationY,
                volume,
            };
            // Capture current brightness at start of gesture
            Brightness.getBrightnessAsync().then(b => {
                gestureStartRef.current.volume = b; // recycling property for brightness
            }).catch(() => {});
        },

        onPanResponderMove: (_e, gs) => {
            const { x: startX } = gestureStartRef.current;
            const isVertical = Math.abs(gs.dy) > Math.abs(gs.dx) * 1.5;
            if (!isVertical) return;

            const side = startX > screenWidth / 2 ? 'right' : 'left';
            const delta = -gs.dy / (Dimensions.get('window').height * 0.6);

            if (side === 'right') {
                const newVol = Math.max(0, Math.min(1, gestureStartRef.current.volume + delta));
                setVolume(newVol);
                setShowVolume(true);
                setShowBrightness(false);
            } else {
                // Brightness control (left side)
                const newBright = Math.max(0, Math.min(1, gestureStartRef.current.volume + delta));
                Brightness.setBrightnessAsync(newBright).catch(() => {});
                setShowBrightness(true);
                setShowVolume(false);
            }
        },

        onPanResponderRelease: (_e, gs) => {
            const isTap = Math.abs(gs.dx) < 10 && Math.abs(gs.dy) < 10;
            if (!isTap) { hideSidebar(); return; }

            // Double-tap detection
            const side = gestureStartRef.current.x > screenWidth / 2 ? 'right' : 'left';
            const now = Date.now();
            if (lastTapRef.current && lastTapRef.current.side === side && now - lastTapRef.current.time < DOUBLE_TAP_DELAY) {
                lastTapRef.current = null;
                fireRipple(side);
                skipBy(side === 'right' ? SEEK_SECONDS : -SEEK_SECONDS);
                revealOSD(true);
            } else {
                lastTapRef.current = { side, time: now };
                // Toggle OSD on single tap (after brief delay to distinguish from double)
                setTimeout(() => {
                    if (!lastTapRef.current) return; // was a double tap
                    lastTapRef.current = null;
                    if (showOSD) {
                        hideOSD();
                    } else {
                        revealOSD(true);
                    }
                }, DOUBLE_TAP_DELAY + 50);
            }
        },

        onPanResponderTerminate: () => hideSidebar(),
    }), [locked, volume, screenWidth, screenHeight, skipBy, fireRipple, revealOSD, hideOSD, showOSD, hideSidebar]);

    // ─────────────────────────────────────────────────────────────────────
    // Computed
    // ─────────────────────────────────────────────────────────────────────

    const sourceType = useMemo(() => detectSourceType(resolvedUrl ?? ''), [resolvedUrl]);
    const source = useMemo(() => {
        if (!resolvedUrl) return undefined;
        const s: any = { uri: resolvedUrl, headers: STRATEGIES[strategyIdx]?.headers ?? {} };
        if (sourceType) s.type = sourceType;
        return s;
    }, [resolvedUrl, strategyIdx, sourceType]);

    const retryManual = useCallback(() => {
        strategyIdxRef.current = 0;
        setStrategyIdx(0);
        hasFetchedFreshUrl.current = false;
        setHasError(false);
        setIsLoading(true);
        setResolvedUrl(activeUrl);
        setVideoKey((k) => k + 1);
    }, [activeUrl]);

    // ─────────────────────────────────────────────────────────────────────
    // Render
    // ─────────────────────────────────────────────────────────────────────

    const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

    return (
        <View style={styles.container}>
            <StatusBar hidden />

            {/* Video */}
            {source ? (
                <Video
                    key={videoKey}
                    ref={videoRef}
                    source={source}
                    style={StyleSheet.absoluteFill}
                    resizeMode={resizeMode}
                    paused={paused}
                    rate={rate}
                    volume={volume}
                    selectedAudioTrack={selectedAudio !== null ? { type: 'index', value: selectedAudio } : undefined}
                    selectedTextTrack={selectedText !== null ? { type: 'index', value: selectedText } : undefined}
                    controls={false}
                    ignoreSilentSwitch="ignore"
                    playInBackground={true}
                    pictureInPicture={isPiP}
                    enterPictureInPictureOnLeave={true}
                    onLoad={onLoad}
                    onProgress={onProgress}
                    onError={onError}
                    onBuffer={onBuffer}
                    onEnd={onEnd}
                    onVideoTracks={onVideoTracks}
                    onPictureInPictureStatusChanged={onPictureInPictureStatusChanged}
                    bufferConfig={{
                        minBufferMs: 15000,
                        maxBufferMs: 50000,
                        bufferForPlaybackMs: 2500,
                        bufferForPlaybackAfterRebufferMs: 5000,
                    }}
                    progressUpdateInterval={500}
                />
            ) : null}

            {/* Gesture layer */}
            <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers}>
                {/* Seek ripples */}
                <SeekRipple side="left" anim={leftRippleAnim} />
                <SeekRipple side="right" anim={rightRippleAnim} />

                {/* Volume indicator */}
                <SidebarIndicator visible={showVolume} icon="volume-high" value={volume} />

                {/* Brightness indicator (cosmetic) */}
                <SidebarIndicator visible={showBrightness} icon="sunny" value={0.7} />
            </View>

            {/* Loading */}
            {isLoading && !hasError && (
                <View style={styles.centerOverlay} pointerEvents="none">
                    <ActivityIndicator size="large" color={Colors.primary} />
                    {strategyIdx > 0 && (
                        <Text style={styles.loadingStrategy}>Tentativa {strategyIdx + 1}…</Text>
                    )}
                </View>
            )}

            {/* Error */}
            {hasError && (
                <View style={styles.errorOverlay}>
                    <Ionicons name="alert-circle-outline" size={64} color={Colors.error} />
                    <Text style={styles.errorText}>{errorMsg || 'Erro ao reproduzir'}</Text>
                    <TouchableOpacity style={styles.retryBtn} onPress={retryManual}>
                        <Ionicons name="refresh" size={18} color="#000" />
                        <Text style={styles.retryBtnText}>Tentar novamente</Text>
                    </TouchableOpacity>
                </View>
            )}

            {/* Casting overlay */}
            {isCasting && (
                <View style={styles.castingOverlay}>
                    <MaterialIcons name="cast" size={56} color={Colors.primary} />
                    <Text style={styles.castingTitle}>Transmitindo</Text>
                    <Text style={styles.castingSubtitle}>{currentTitle}</Text>
                </View>
            )}

            {/* Next episode card */}
            {showNextCard && resolvedNextEpisode && (
                <NextEpisodeCard
                    episode={{ title: resolvedNextEpisode.title, subtitle: `T${resolvedNextEpisode.season}·E${resolvedNextEpisode.episode}` }}
                    countdown={nextCountdown}
                    onPlay={handleNextEpisode}
                    onCancel={() => {
                        if (nextCountdownRef.current) clearInterval(nextCountdownRef.current);
                        setShowNextCard(false);
                        setNextCardDismissed(true);
                    }}
                />
            )}

            {/* OSD */}
            {!locked && (
                <Animated.View
                    style={[StyleSheet.absoluteFill, styles.osdContainer, { opacity: osdAnim }]}
                    pointerEvents={showOSD ? 'box-none' : 'none'}
                >
                    {/* Top gradient */}
                    <LinearGradient
                        colors={['rgba(0,0,0,0.75)', 'transparent']}
                        style={styles.gradientTop}
                        pointerEvents="none"
                    />

                    {/* Bottom gradient */}
                    <LinearGradient
                        colors={['transparent', 'rgba(0,0,0,0.85)']}
                        style={styles.gradientBottom}
                        pointerEvents="none"
                    />

                    {/* Top bar */}
                    <View style={[styles.topBar, { paddingTop: Math.max(insets.top, 10) }]}>
                        <TouchableOpacity style={styles.iconBtn} onPress={handleClose}>
                            <Ionicons name="arrow-back" size={24} color="#fff" />
                        </TouchableOpacity>

                        <View style={styles.topMid}>
                            <Text style={styles.titleText} numberOfLines={1}>{currentTitle}</Text>
                            {resolution && <Text style={styles.resLabel}>{resolution}</Text>}
                        </View>

                        <View style={styles.topRight}>
                            {(!!castUrl || !isOffline) && (
                                <CastButton style={styles.castBtn} />
                            )}
                            <TouchableOpacity
                                style={styles.iconBtn}
                                onPress={() => {
                                    if (Platform.OS === 'android') {
                                        videoRef.current?.enterPictureInPicture();
                                    } else {
                                        setIsPiP(true);
                                    }
                                }}
                            >
                                <MaterialIcons name="picture-in-picture" size={22} color="#fff" />
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.iconBtn} onPress={() => setLocked(true)}>
                                <Ionicons name="lock-open-outline" size={22} color="#fff" />
                            </TouchableOpacity>
                        </View>
                    </View>

                    {/* Center controls */}
                    <View style={styles.centerControls} pointerEvents="box-none">
                        <TouchableOpacity style={styles.seekBtn} onPress={() => skipBy(-SEEK_SECONDS)}>
                            <Ionicons name="play-back" size={28} color="#fff" />
                            <Text style={styles.seekLabel}>{SEEK_SECONDS}s</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.playBtn, isLoading && styles.playBtnLoading]}
                            onPress={togglePause}
                        >
                            {isLoading
                                ? <ActivityIndicator size="small" color="#fff" />
                                : <Ionicons name={paused ? 'play' : 'pause'} size={36} color="#fff" />
                            }
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.seekBtn} onPress={() => skipBy(SEEK_SECONDS)}>
                            <Ionicons name="play-forward" size={28} color="#fff" />
                            <Text style={styles.seekLabel}>{SEEK_SECONDS}s</Text>
                        </TouchableOpacity>
                    </View>

                    {/* Bottom bar */}
                    <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
                        <View style={styles.timeRow}>
                            <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
                            <View style={styles.timeRight}>
                                {rate !== 1 && (
                                    <Text style={styles.rateLabel}>{rate}×</Text>
                                )}
                                <Text style={styles.timeText}>{formatTime(duration)}</Text>
                            </View>
                        </View>

                        <ProgressBar
                            current={currentTime}
                            duration={duration}
                            buffered={buffered}
                            onSeek={seek}
                            isSeeking={isSeeking}
                            onSeekStart={handleSeekStart}
                            onSeekEnd={handleSeekEnd}
                        />

                        <View style={styles.toolRow}>
                            <TouchableOpacity style={styles.toolBtn} onPress={() => setShowSpeed(true)}>
                                <MaterialIcons name="speed" size={20} color="#fff" />
                                <Text style={styles.toolLabel}>
                                    {rate === 1 ? 'Normal' : `${rate}×`}
                                </Text>
                            </TouchableOpacity>

                            <TouchableOpacity style={styles.toolBtn} onPress={() => setShowSleep(true)}>
                                <Ionicons name="timer-outline" size={19} color="#fff" />
                                <Text style={styles.toolLabel}>
                                    {sleepRemaining ? `${Math.ceil(sleepRemaining / 60)}m` : 'Sleep'}
                                </Text>
                            </TouchableOpacity>

                            <TouchableOpacity style={styles.toolBtn} onPress={toggleAspectRatio}>
                                <MaterialIcons name="aspect-ratio" size={19} color="#fff" />
                                <Text style={styles.toolLabel}>{RESIZE_LABELS[resizeMode]}</Text>
                            </TouchableOpacity>

                            <View style={styles.toolRight}>
                                {(audioTracks.length > 0 || textTracks.length > 0) && (
                                    <TouchableOpacity style={styles.toolBtn} onPress={() => setShowAudioSheet(true)}>
                                        <MaterialIcons name="subtitles" size={19} color="#fff" />
                                        <Text style={styles.toolLabel}>Trilhas</Text>
                                    </TouchableOpacity>
                                )}
                                {!isOffline && (
                                    <TouchableOpacity
                                        style={styles.toolBtn}
                                        onPress={() => {
                                            try {
                                                (videoRef.current as any)?.presentFullscreenPlayer?.();
                                            } catch { }
                                        }}
                                    >
                                        <MaterialIcons name="fullscreen" size={22} color="#fff" />
                                    </TouchableOpacity>
                                )}
                            </View>
                        </View>
                    </View>
                </Animated.View>
            )}

            {/* Lock overlay */}
            {locked && (
                <View style={styles.lockOverlay} pointerEvents="box-none">
                    <TouchableOpacity
                        style={styles.lockBtn}
                        onPress={() => setLocked(false)}
                    >
                        <Ionicons name="lock-closed" size={22} color="#fff" />
                        <Text style={styles.lockText}>Toque para desbloquear</Text>
                    </TouchableOpacity>
                </View>
            )}

            {/* Speed sheet */}
            <SpeedSheet
                visible={showSpeed}
                current={rate}
                onSelect={setRate}
                onClose={() => setShowSpeed(false)}
            />

            {/* Sleep sheet */}
            <SleepSheet
                visible={showSleep}
                remaining={sleepRemaining}
                onSelect={startSleepTimer}
                onCancel={cancelSleepTimer}
                onClose={() => setShowSleep(false)}
            />

            {/* Audio track sheet */}
            <TrackSheet
                visible={showAudioSheet}
                title="Trilha de Áudio"
                tracks={audioTracks}
                selectedId={selectedAudio}
                onSelect={handleAudioSelect}
                onClose={() => setShowAudioSheet(false)}
            />

            {/* Text track sheet */}
            <TrackSheet
                visible={showTextSheet}
                title="Legendas"
                tracks={textTracks}
                selectedId={selectedText}
                onSelect={handleTextSelect}
                onClose={() => setShowTextSheet(false)}
            />
        </View>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
    },

    // ── OSD container
    osdContainer: {
        justifyContent: 'space-between',
    },
    gradientTop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 120,
    },
    gradientBottom: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 140,
    },

    // ── Top bar
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.sm,
        zIndex: 2,
    },
    topMid: {
        flex: 1,
        alignItems: 'center',
        marginHorizontal: Spacing.md,
    },
    titleText: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '600',
        textAlign: 'center',
    },
    resLabel: {
        color: 'rgba(255,255,255,0.55)',
        fontSize: 11,
        marginTop: 2,
    },
    topRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    iconBtn: {
        padding: Spacing.sm,
        backgroundColor: 'rgba(0,0,0,0.4)',
        borderRadius: BorderRadius.full,
    },
    castBtn: {
        width: 24,
        height: 24,
        tintColor: '#fff',
    },

    // ── Center controls
    centerControls: {
        ...StyleSheet.absoluteFillObject,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 40,
    },
    seekBtn: {
        alignItems: 'center',
        padding: Spacing.md,
        backgroundColor: 'rgba(0,0,0,0.35)',
        borderRadius: BorderRadius.full,
        minWidth: 60,
    },
    seekLabel: {
        color: '#fff',
        fontSize: 10,
        marginTop: 2,
        fontWeight: '500',
    },
    playBtn: {
        width: 72,
        height: 72,
        borderRadius: 36,
        backgroundColor: 'rgba(99,102,241,0.85)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    playBtnLoading: {
        backgroundColor: 'rgba(99,102,241,0.5)',
    },

    // ── Bottom bar
    bottomBar: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.sm,
        zIndex: 2,
    },
    timeRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 6,
    },
    timeRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    timeText: {
        color: 'rgba(255,255,255,0.8)',
        fontSize: 12,
        fontVariant: ['tabular-nums'],
    },
    rateLabel: {
        color: Colors.primary,
        fontSize: 11,
        fontWeight: '700',
        backgroundColor: 'rgba(99,102,241,0.2)',
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: 4,
    },
    toolRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: Spacing.sm,
    },
    toolBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        padding: Spacing.xs,
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderRadius: BorderRadius.sm,
        paddingHorizontal: Spacing.sm,
    },
    toolLabel: {
        color: '#fff',
        fontSize: 11,
        fontWeight: '500',
    },
    toolRight: {
        flexDirection: 'row',
        gap: Spacing.sm,
    },

    // ── Progress bar
    progressWrapper: {
        height: 32,
        justifyContent: 'center',
        marginHorizontal: -2,
    },
    progressTrack: {
        height: 4,
        backgroundColor: 'rgba(255,255,255,0.2)',
        borderRadius: 2,
        position: 'relative',
    },
    progressBuffered: {
        position: 'absolute',
        top: 0,
        left: 0,
        bottom: 0,
        backgroundColor: 'rgba(255,255,255,0.35)',
        borderRadius: 2,
    },
    progressFill: {
        position: 'absolute',
        top: 0,
        left: 0,
        bottom: 0,
        backgroundColor: Colors.primary,
        borderRadius: 2,
    },
    progressThumb: {
        position: 'absolute',
        width: 14,
        height: 14,
        borderRadius: 7,
        backgroundColor: '#fff',
        top: -5,
        marginLeft: -7,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.4,
        shadowRadius: 2,
        elevation: 3,
    },
    progressThumbActive: {
        width: 18,
        height: 18,
        borderRadius: 9,
        marginLeft: -9,
        top: -7,
        backgroundColor: Colors.primary,
    },
    tooltip: {
        position: 'absolute',
        bottom: 32,
        backgroundColor: 'rgba(0,0,0,0.8)',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 4,
        zIndex: 10,
    },
    tooltipText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: '600',
        fontVariant: ['tabular-nums'],
    },

    // ── Seek ripple
    seekRipple: {
        position: 'absolute',
        top: '50%',
        width: 90,
        height: 90,
        borderRadius: 45,
        marginTop: -45,
        backgroundColor: 'rgba(255,255,255,0.12)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    seekRippleLeft: {
        left: '15%',
    },
    seekRippleRight: {
        right: '15%',
    },
    seekRippleInner: {
        alignItems: 'center',
    },
    seekRippleText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: '600',
        marginTop: 2,
    },

    // ── Sidebar indicator (volume/brightness)
    sidebarIndicator: {
        position: 'absolute',
        right: 24,
        top: '25%',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.6)',
        borderRadius: 12,
        padding: 10,
        gap: 8,
    },
    sidebarTrack: {
        width: 4,
        height: 80,
        backgroundColor: 'rgba(255,255,255,0.2)',
        borderRadius: 2,
        justifyContent: 'flex-end',
    },
    sidebarFill: {
        width: '100%',
        backgroundColor: Colors.primary,
        borderRadius: 2,
    },
    sidebarText: {
        color: '#fff',
        fontSize: 10,
        fontWeight: '600',
    },

    // ── Overlays
    centerOverlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingStrategy: {
        color: 'rgba(255,255,255,0.5)',
        fontSize: 11,
        marginTop: 8,
    },
    errorOverlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.85)',
        padding: Spacing.xl,
    },
    errorText: {
        color: Colors.error,
        fontSize: 15,
        textAlign: 'center',
        marginTop: Spacing.md,
        marginBottom: Spacing.xl,
    },
    retryBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        backgroundColor: Colors.primary,
        paddingHorizontal: Spacing.xl,
        paddingVertical: Spacing.md,
        borderRadius: BorderRadius.full,
    },
    retryBtnText: {
        color: '#fff',
        fontWeight: '700',
        fontSize: 14,
    },
    castingOverlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.9)',
    },
    castingTitle: {
        color: '#fff',
        fontSize: 20,
        fontWeight: '700',
        marginTop: 16,
    },
    castingSubtitle: {
        color: 'rgba(255,255,255,0.6)',
        fontSize: 13,
        marginTop: 6,
    },

    // ── Lock
    lockOverlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'flex-end',
        alignItems: 'flex-start',
        padding: Spacing.xl,
    },
    lockBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        backgroundColor: 'rgba(0,0,0,0.6)',
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.md,
        borderRadius: BorderRadius.full,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.2)',
    },
    lockText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '500',
    },

    // ── Speed sheet
    sheetBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.6)',
        justifyContent: 'flex-end',
    },
    sheetContainer: {
        backgroundColor: '#1A1A2E',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        padding: Spacing.xl,
        paddingBottom: 32,
    },
    sheetHandle: {
        width: 36,
        height: 4,
        backgroundColor: 'rgba(255,255,255,0.2)',
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: Spacing.lg,
    },
    sheetTitle: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '600',
        marginBottom: Spacing.lg,
        textAlign: 'center',
    },
    speedGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: Spacing.sm,
        justifyContent: 'center',
    },
    speedChip: {
        paddingHorizontal: Spacing.xl,
        paddingVertical: Spacing.md,
        borderRadius: BorderRadius.full,
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        minWidth: 80,
        alignItems: 'center',
    },
    speedChipActive: {
        backgroundColor: Colors.primary,
        borderColor: Colors.primary,
    },
    speedChipText: {
        color: 'rgba(255,255,255,0.7)',
        fontSize: 14,
        fontWeight: '500',
    },
    speedChipTextActive: {
        color: '#fff',
        fontWeight: '700',
    },

    // ── Next episode card
    nextEpCard: {
        position: 'absolute',
        bottom: 80,
        right: 20,
        backgroundColor: 'rgba(15,15,30,0.92)',
        borderRadius: 14,
        padding: 14,
        width: 220,
        borderWidth: 1,
        borderColor: 'rgba(99,102,241,0.4)',
    },
    nextEpLabel: {
        color: Colors.primary,
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        marginBottom: 4,
    },
    nextEpTitle: {
        color: '#fff',
        fontSize: 13,
        fontWeight: '600',
        marginBottom: 2,
    },
    nextEpSub: {
        color: 'rgba(255,255,255,0.5)',
        fontSize: 11,
        marginBottom: 10,
    },
    nextEpCountdownBar: {
        height: 2,
        backgroundColor: 'rgba(255,255,255,0.15)',
        borderRadius: 1,
        marginBottom: 10,
        overflow: 'hidden',
    },
    nextEpCountdownFill: {
        height: '100%',
        backgroundColor: Colors.primary,
        borderRadius: 1,
    },
    nextEpButtons: {
        flexDirection: 'row',
        gap: 8,
        alignItems: 'center',
    },
    nextEpPlay: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        backgroundColor: Colors.primary,
        borderRadius: 8,
        paddingVertical: 7,
    },
    nextEpPlayText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: '700',
    },
    nextEpCancel: {
        paddingHorizontal: 8,
        paddingVertical: 7,
    },
    nextEpCancelText: {
        color: 'rgba(255,255,255,0.5)',
        fontSize: 11,
    },

    // ── New Styles
    sleepRemaining: {
        color: Colors.primary,
        fontSize: 13,
        fontWeight: '700',
        textAlign: 'center',
        marginBottom: Spacing.md,
    },
    sleepCancelBtn: {
        marginTop: Spacing.xl,
        paddingVertical: Spacing.md,
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.1)',
    },
    sleepCancelText: {
        color: Colors.error,
        fontSize: 14,
        fontWeight: '600',
    },
    trackRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: Spacing.md,
        gap: Spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.05)',
    },
    trackLabel: {
        color: 'rgba(255,255,255,0.7)',
        fontSize: 14,
        fontWeight: '500',
    },
    trackLabelActive: {
        color: '#fff',
        fontWeight: '700',
    },
});
