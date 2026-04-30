import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Dimensions,
  StatusBar,
  BackHandler,
  Platform,
  ActivityIndicator,
} from 'react-native';
import Video, { DRMType, SelectedTrackType, SelectedVideoTrackType, VideoRef } from 'react-native-video';
import { CastButton, useRemoteMediaClient } from 'react-native-google-cast';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as NavigationBar from 'expo-navigation-bar';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Channel, CurrentProgram } from '../types';
import { Colors, BorderRadius, Spacing, Typography } from '../constants/Colors';
import { useFavoritesStore } from '../stores/favoritesStore';
import { getCurrentProgram, fetchChannelEPG, onEPGUpdate } from '../services/epgService';
import EPGGuideModal from './EPGGuideModal';

function toResLabel(h: number): string {
  if (h >= 2160) return '4K';
  if (h >= 1440) return '2K';
  if (h >= 1080) return '1080p';
  if (h >= 720) return '720p';
  if (h >= 480) return '480p';
  if (h >= 360) return '360p';
  return `${h}p`;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatRemaining(min?: number): string {
  if (!min) return '';
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${m}min`;
}

interface VideoPlayerProps {
  channel: Channel;
}

export default function VideoPlayer({ channel }: VideoPlayerProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [activeChannel, setActiveChannel] = useState<Channel>(channel);

  const client = useRemoteMediaClient();
  const videoRef = useRef<VideoRef>(null);

  const [epg, setEpg] = useState<CurrentProgram | null>(null);
  const [hasError, setHasError] = useState(false);
  const [videoResolution, setVideoResolution] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [osdVisible, setOsdVisible] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [menuPage, setMenuPage] = useState<'main' | 'audio' | 'video' | 'cc'>('main');
  const [videoKey, setVideoKey] = useState(0);
  const [isCasting, setIsCasting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const [audioTracks, setAudioTracks] = useState<any[]>([]);
  const [videoTracks, setVideoTracks] = useState<any[]>([]);
  const [textTracks, setTextTracks] = useState<any[]>([]);
  const [selectedAudioIdx, setSelectedAudioIdx] = useState<number | null>(null);
  const [selectedVideoTrackId, setSelectedVideoTrackId] = useState<number | null>(null);
  const [selectedTextIdx, setSelectedTextIdx] = useState<number | null>(null);

  const { toggleFavorite, isFavorite } = useFavoritesStore();
  const [favorite, setFavorite] = useState(isFavorite(channel.id));

  const osdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const switchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRetryingRef = useRef(false);
  const isMountedRef = useRef(true);
  const [isRetrying, setIsRetrying] = useState(false);

  // ─── OSD ───
  const showOSD = useCallback(() => {
    setOsdVisible(true);
    if (osdTimeoutRef.current) clearTimeout(osdTimeoutRef.current);
    osdTimeoutRef.current = setTimeout(() => setOsdVisible(false), 5000);
  }, []);

  const hideOSD = useCallback(() => {
    setOsdVisible(false);
    if (osdTimeoutRef.current) clearTimeout(osdTimeoutRef.current);
  }, []);

  useEffect(() => { showOSD(); }, [activeChannel.id]); // eslint-disable-line

  // ─── Channel switch ───
  const handleSwitchChannel = useCallback((target: Channel) => {
    if (target.id === activeChannel.id) return;
    if (retryTimerRef.current)    { clearTimeout(retryTimerRef.current);    retryTimerRef.current    = null; }
    if (retryIntervalRef.current) { clearTimeout(retryIntervalRef.current); retryIntervalRef.current = null; }
    if (switchDebounceRef.current){ clearTimeout(switchDebounceRef.current); switchDebounceRef.current = null; }
    isRetryingRef.current = false;
    setIsRetrying(false);
    setHasError(false);
    setVideoResolution(null);
    setAudioTracks([]);
    setVideoTracks([]);
    setTextTracks([]);
    setSelectedAudioIdx(null);
    setSelectedVideoTrackId(null);
    setSelectedTextIdx(null);
    setMenuPage('main');
    setIsLoading(true);
    setActiveChannel(target);
    switchDebounceRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      setVideoKey(k => k + 1);
    }, 200);
  }, [activeChannel.id]);

  // ─── Favorite sync ───
  useEffect(() => {
    setFavorite(isFavorite(activeChannel.id));
  }, [activeChannel.id, isFavorite]);

  const handleToggleFavorite = useCallback(() => {
    toggleFavorite(activeChannel.id);
    setFavorite(prev => !prev);
  }, [activeChannel.id, toggleFavorite]);

  // ─── Cast ───
  const handleCast = useCallback(() => {
    if (!client) return;
    client.loadMedia({
      mediaInfo: {
        contentUrl: activeChannel.url,
        metadata: {
          type: 'movie',
          title: activeChannel.name,
          images: activeChannel.logo ? [{ url: activeChannel.logo }] : [],
        },
      },
      autoplay: true,
    });
    setIsCasting(true);
  }, [client, activeChannel]);

  useEffect(() => {
    if (client) handleCast();
    else setIsCasting(false);
  }, [client, handleCast]);

  // ─── EPG ───
  useEffect(() => {
    const cached = getCurrentProgram(activeChannel.id);
    if (cached) setEpg(cached);
    else {
      setEpg(null);
      fetchChannelEPG(activeChannel.id).catch(() => {});
    }
    const interval = setInterval(() => {
      if (isMountedRef.current) setEpg(getCurrentProgram(activeChannel.id));
    }, 30000);
    const unsub = onEPGUpdate((id) => {
      if (id === activeChannel.id && isMountedRef.current) {
        setEpg(getCurrentProgram(activeChannel.id));
      }
    });
    return () => { clearInterval(interval); unsub(); };
  }, [activeChannel.id]);

  // ─── Mount + Fullscreen ───
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (osdTimeoutRef.current)     clearTimeout(osdTimeoutRef.current);
      if (switchDebounceRef.current) clearTimeout(switchDebounceRef.current);
      if (retryTimerRef.current)     clearTimeout(retryTimerRef.current);
      if (retryIntervalRef.current)  clearTimeout(retryIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
        if (Platform.OS === 'android') {
          await NavigationBar.setVisibilityAsync('hidden');
          await NavigationBar.setBehaviorAsync('overlay-swipe');
        }
      } catch {}
    })();
    return () => {
      (async () => {
        try {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
          if (Platform.OS === 'android') {
            await NavigationBar.setVisibilityAsync('visible');
          }
        } catch {}
      })();
    };
  }, []);

  // ─── Back ───
  const handleBack = useCallback(async () => {
    router.back();
    try { await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP); } catch {}
  }, [router]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showMenu) { setShowMenu(false); return true; }
      if (showGuide) { setShowGuide(false); return true; }
      handleBack();
      return true;
    });
    return () => sub.remove();
  }, [showMenu, showGuide, handleBack]);

  // ─── Video callbacks ───
  const onLoad = useCallback((data: any) => {
    if (!isMountedRef.current) return;
    if (isRetryingRef.current) {
      isRetryingRef.current = false;
      setIsRetrying(false);
      if (retryTimerRef.current)    { clearTimeout(retryTimerRef.current);    retryTimerRef.current    = null; }
      if (retryIntervalRef.current) { clearTimeout(retryIntervalRef.current); retryIntervalRef.current = null; }
    }
    setHasError(false);
    setIsLoading(false);
    const h = data?.naturalSize?.height;
    if (h && h > 0) setVideoResolution(toResLabel(h));
  }, []);

  const onError = useCallback(() => {
    if (!isMountedRef.current) return;
    setIsLoading(false);
    if (!isRetryingRef.current) {
      isRetryingRef.current = true;
      setIsRetrying(true);
      retryTimerRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;
        isRetryingRef.current = false;
        setIsRetrying(false);
        setHasError(true);
      }, 8000);
    }
    if (retryIntervalRef.current) clearTimeout(retryIntervalRef.current);
    retryIntervalRef.current = setTimeout(() => {
      if (!isMountedRef.current || !isRetryingRef.current) return;
      setVideoKey(k => k + 1);
    }, 2000);
  }, []);

  const onAudioTracks = useCallback((data: any) => {
    setAudioTracks(data?.audioTracks ?? []);
  }, []);

  const onVideoTracks = useCallback((data: any) => {
    const tracks = data?.videoTracks ?? [];
    setVideoTracks(tracks);
    const maxH = tracks.reduce((m: number, t: any) => Math.max(m, t.height ?? 0), 0);
    if (maxH > 0) setVideoResolution(toResLabel(maxH));
  }, []);

  const onTextTracks = useCallback((data: any) => {
    setTextTracks(data?.textTracks ?? []);
  }, []);

  const handleRetry = useCallback(() => {
    isRetryingRef.current = false;
    setIsRetrying(false);
    setHasError(false);
    setIsLoading(true);
    if (retryTimerRef.current)    { clearTimeout(retryTimerRef.current);    retryTimerRef.current    = null; }
    if (retryIntervalRef.current) { clearTimeout(retryIntervalRef.current); retryIntervalRef.current = null; }
    setVideoKey(k => k + 1);
  }, []);

  const onBandwidthUpdate = useCallback((data: any) => {
    if (!isMountedRef.current) return;
    const h = data?.height;
    if (h && h > 0) setVideoResolution(toResLabel(h));
  }, []);

  // ─── DRM config ───
  const drmConfig = useMemo(() => {
    if (!activeChannel.drm?.clearKey) return undefined;
    return {
      type: DRMType.CLEARKEY,
      licenseServer: 'http://127.0.0.1:8765',
    };
  }, [activeChannel.drm?.clearKey]);

  // ─── Prev/Next ───
  // Sem channel store global; mantém apenas a interação via guia.
  const audioLanguages = useMemo(() => {
    return Array.from(new Set(audioTracks.map(t => t.language).filter(Boolean))).slice(0, 3);
  }, [audioTracks]);

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      <Pressable
        style={styles.videoContainer}
        onPress={() => {
          if (showMenu || showGuide) return;
          osdVisible ? hideOSD() : showOSD();
        }}
        focusable={false}
        android_ripple={{ color: 'transparent' }}
      >
        <View style={styles.video} pointerEvents="none">
          <Video
            key={videoKey}
            ref={videoRef}
            source={{ uri: activeChannel.url, headers: activeChannel.headers }}
            drm={drmConfig}
            style={styles.video}
            resizeMode="contain"
            onLoad={onLoad}
            onError={onError}
            onAudioTracks={onAudioTracks}
            onVideoTracks={onVideoTracks}
            onTextTracks={onTextTracks}
            onBandwidthUpdate={onBandwidthUpdate}
            selectedAudioTrack={selectedAudioIdx !== null
              ? { type: SelectedTrackType.INDEX, value: selectedAudioIdx }
              : { type: SelectedTrackType.SYSTEM }}
            selectedVideoTrack={selectedVideoTrackId !== null
              ? { type: SelectedVideoTrackType.INDEX, value: selectedVideoTrackId }
              : { type: SelectedVideoTrackType.AUTO }}
            selectedTextTrack={selectedTextIdx !== null
              ? { type: SelectedTrackType.INDEX, value: selectedTextIdx }
              : { type: SelectedTrackType.DISABLED }}
            bufferConfig={{
              minBufferMs: 15000,
              maxBufferMs: 50000,
              bufferForPlaybackMs: 2500,
              bufferForPlaybackAfterRebufferMs: 5000,
            }}
            controls={false}
            repeat
            ignoreSilentSwitch="ignore"
            playInBackground={false}
            focusable={false}
          />
        </View>

        {(isLoading || isRetrying) && !hasError && (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color={Colors.primary} />
            {isRetrying && <Text style={styles.retryingText}>Conectando ao canal...</Text>}
          </View>
        )}

        {isCasting && (
          <View style={styles.castingOverlay}>
            <MaterialIcons name="cast" size={56} color={Colors.primary} />
            <Text style={styles.castingTitle}>Transmitindo</Text>
            <Text style={styles.castingSubtitle}>{activeChannel.name}</Text>
          </View>
        )}

        {hasError && (
          <View style={styles.errorContainer}>
            <Ionicons name="alert-circle-outline" size={64} color={Colors.error} />
            <Text style={styles.errorTitle}>Canal indisponível</Text>
            <Text style={styles.errorText}>
              Este canal está temporariamente fora do ar.
            </Text>
            <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
              <Ionicons name="refresh" size={20} color={Colors.text} />
              <Text style={styles.retryText}>Tentar novamente</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.backButtonError} onPress={handleBack}>
              <Text style={styles.backButtonText}>Voltar aos canais</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Top Bar */}
        {osdVisible && !showMenu && !showGuide && !hasError && (
          <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
            <TouchableOpacity style={styles.iconButton} onPress={handleBack}>
              <Ionicons name="arrow-back" size={24} color={Colors.text} />
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <View style={styles.castWrap}>
              <CastButton style={{ width: 24, height: 24, tintColor: Colors.text }} />
            </View>
            <TouchableOpacity style={styles.iconButton} onPress={() => setShowGuide(true)}>
              <Ionicons name="list" size={22} color={Colors.text} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconButton} onPress={() => { setMenuPage('main'); setShowMenu(true); }}>
              <Ionicons name="settings-outline" size={22} color={Colors.text} />
            </TouchableOpacity>
          </View>
        )}

        {/* OSD Banner */}
        {osdVisible && !showMenu && !showGuide && !hasError && (
          <View style={[styles.osdContainer, { bottom: insets.bottom + 24, left: 24, right: 24 }]}>
            <View style={styles.osdBanner}>
              <View style={styles.osdLogoCol}>
                <View style={styles.osdLogoWrap}>
                  {activeChannel.logo ? (
                    <Image
                      source={{ uri: activeChannel.logo }}
                      style={styles.osdLogo}
                      contentFit="contain"
                      cachePolicy="memory-disk"
                    />
                  ) : (
                    <Ionicons name="tv-outline" size={32} color={Colors.textSecondary} />
                  )}
                </View>
                {activeChannel.channelNumber != null && (
                  <View style={styles.osdChNumBadge}>
                    <Text style={styles.osdChNum}>{String(activeChannel.channelNumber).padStart(2, '0')}</Text>
                  </View>
                )}
                <Text style={styles.osdChannelName} numberOfLines={1}>{activeChannel.name}</Text>
              </View>

              <View style={styles.osdDivider} />

              <View style={styles.osdEpgCol}>
                <View style={styles.osdLiveRow}>
                  <View style={styles.osdCatPill}>
                    <Text style={styles.osdCatText}>{activeChannel.category}</Text>
                  </View>
                  {videoResolution && (
                    <View style={styles.osdResBadge}>
                      <Text style={styles.osdResText}>{videoResolution}</Text>
                    </View>
                  )}
                  {audioLanguages.map((lang) => (
                    <View key={`aud-${lang}`} style={styles.osdAudBadge}>
                      <Ionicons name="volume-medium" size={11} color={Colors.text} />
                      <Text style={styles.osdAudText}>{lang}</Text>
                    </View>
                  ))}
                  {textTracks.length > 0 && (
                    <View style={styles.osdCcBadge}>
                      <Ionicons name="logo-closed-captioning" size={12} color={Colors.text} />
                      <Text style={styles.osdCcText}>CC</Text>
                    </View>
                  )}
                  {epg?.remaining ? (
                    <Text style={styles.osdRemaining}>{formatRemaining(epg.remaining)}</Text>
                  ) : null}
                </View>

                {epg?.current ? (
                  <>
                    <View style={styles.osdProgTitleRow}>
                      <Text style={styles.osdProgTitle} numberOfLines={1}>{epg.current.title}</Text>
                      <Text style={styles.osdProgTime}>
                        {formatTime(epg.current.startTime)}{' – '}{formatTime(epg.current.endTime)}
                      </Text>
                    </View>
                    {epg.current.description ? (
                      <Text style={styles.osdProgDesc} numberOfLines={2}>{epg.current.description}</Text>
                    ) : null}
                    <View style={styles.osdProgBar}>
                      <View style={[styles.osdProgFill, { width: `${Math.min(100, epg.progress ?? 0)}%` }]} />
                    </View>
                    {epg.next && (
                      <View style={styles.osdNextRow}>
                        <Ionicons name="chevron-forward" size={13} color={Colors.textMuted} />
                        <Text style={styles.osdNextTitle} numberOfLines={1}>{epg.next.title}</Text>
                        <Text style={styles.osdNextTime}>{formatTime(epg.next.startTime)}</Text>
                      </View>
                    )}
                  </>
                ) : (
                  <Text style={styles.osdNoEpg}>Sem informação de programação</Text>
                )}
              </View>

              <TouchableOpacity
                style={styles.iconButton}
                onPress={handleToggleFavorite}
              >
                <Ionicons
                  name={favorite ? 'heart' : 'heart-outline'}
                  size={22}
                  color={favorite ? '#FF4757' : Colors.text}
                />
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Pressable>

      {/* Menu */}
      {showMenu && !showGuide && (
        <Pressable style={styles.menuOverlay} onPress={() => setShowMenu(false)}>
          <Pressable style={styles.menuCard} onPress={e => e.stopPropagation()}>
            <View style={styles.menuHeader}>
              <Text style={styles.menuChannelName} numberOfLines={1}>{activeChannel.name}</Text>
              {menuPage !== 'main' && (
                <TouchableOpacity style={styles.menuBackButton} onPress={() => setMenuPage('main')}>
                  <Ionicons name="chevron-back" size={18} color={Colors.text} />
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.menuSeparator} />

            {menuPage === 'main' && (
              <>
                <TouchableOpacity style={styles.menuItem} onPress={() => { handleToggleFavorite(); setShowMenu(false); }}>
                  <Ionicons name={favorite ? 'heart' : 'heart-outline'} size={20} color={favorite ? '#FF4757' : Colors.text} />
                  <Text style={styles.menuItemText}>{favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.menuItem} onPress={() => { setShowGuide(true); setShowMenu(false); }}>
                  <Ionicons name="calendar-outline" size={20} color={Colors.text} />
                  <Text style={styles.menuItemText}>Guia de Programação</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.menuItem, audioTracks.length === 0 && styles.menuItemDisabled]}
                  disabled={audioTracks.length === 0}
                  onPress={() => setMenuPage('audio')}
                >
                  <Ionicons name="musical-notes-outline" size={20} color={Colors.text} />
                  <Text style={styles.menuItemText}>
                    Áudio{selectedAudioIdx !== null && audioTracks[selectedAudioIdx] ? ` · ${audioTracks[selectedAudioIdx].language ?? selectedAudioIdx + 1}` : ' · Padrão'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.menuItem, videoTracks.length === 0 && styles.menuItemDisabled]}
                  disabled={videoTracks.length === 0}
                  onPress={() => setMenuPage('video')}
                >
                  <Ionicons name="layers-outline" size={20} color={Colors.text} />
                  <Text style={styles.menuItemText}>
                    Qualidade{selectedVideoTrackId !== null
                      ? (() => {
                          const t = videoTracks.find(v => v.trackId === selectedVideoTrackId);
                          return t ? ` · ${t.height ? t.height + 'p' : 'Manual'}` : '';
                        })()
                      : ' · Auto'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.menuItem, textTracks.length === 0 && styles.menuItemDisabled]}
                  disabled={textTracks.length === 0}
                  onPress={() => setMenuPage('cc')}
                >
                  <Ionicons name="logo-closed-captioning" size={20} color={Colors.text} />
                  <Text style={styles.menuItemText}>
                    Legendas{selectedTextIdx !== null && textTracks[selectedTextIdx] ? ` · ${textTracks[selectedTextIdx].language ?? selectedTextIdx + 1}` : ' · Off'}
                  </Text>
                </TouchableOpacity>
              </>
            )}

            {menuPage === 'audio' && audioTracks.map((track: any, i: number) => (
              <TouchableOpacity
                key={i}
                style={styles.menuItem}
                onPress={() => { setSelectedAudioIdx(i); setMenuPage('main'); }}
              >
                <Ionicons
                  name={selectedAudioIdx === i ? 'radio-button-on' : 'radio-button-off'}
                  size={18}
                  color={Colors.text}
                />
                <Text style={styles.menuItemText}>{track.language ?? track.title ?? `Faixa ${i + 1}`}</Text>
              </TouchableOpacity>
            ))}

            {menuPage === 'video' && [null, ...videoTracks].map((track: any, i: number) => {
              const label = i === 0 ? 'Automático' : track?.height ? `${track.height}p` : `Qualidade ${i}`;
              const isActive = i === 0 ? selectedVideoTrackId === null : track?.trackId === selectedVideoTrackId;
              return (
                <TouchableOpacity
                  key={i}
                  style={styles.menuItem}
                  onPress={() => {
                    setSelectedVideoTrackId(i === 0 ? null : track?.trackId ?? null);
                    setMenuPage('main');
                  }}
                >
                  <Ionicons name={isActive ? 'radio-button-on' : 'radio-button-off'} size={18} color={Colors.text} />
                  <Text style={styles.menuItemText}>{label}</Text>
                </TouchableOpacity>
              );
            })}

            {menuPage === 'cc' && [null, ...textTracks].map((track: any, i: number) => {
              const label = i === 0 ? 'Desativado' : track?.language ?? track?.title ?? `Legenda ${i}`;
              const isActive = i === 0 ? selectedTextIdx === null : selectedTextIdx === i - 1;
              return (
                <TouchableOpacity
                  key={i}
                  style={styles.menuItem}
                  onPress={() => {
                    setSelectedTextIdx(i === 0 ? null : i - 1);
                    setMenuPage('main');
                  }}
                >
                  <Ionicons name={isActive ? 'radio-button-on' : 'radio-button-off'} size={18} color={Colors.text} />
                  <Text style={styles.menuItemText}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </Pressable>
        </Pressable>
      )}

      <EPGGuideModal
        visible={showGuide}
        onClose={() => setShowGuide(false)}
        onChannelPress={handleSwitchChannel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  videoContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  video: { width: '100%', height: '100%' },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)', gap: 12 },
  retryingText: { color: Colors.textSecondary, fontSize: Typography.body.fontSize, fontWeight: '500' },
  castingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.92)',
    gap: Spacing.sm,
  },
  castingTitle: { color: Colors.text, fontSize: Typography.h2.fontSize, fontWeight: '700' },
  castingSubtitle: { color: Colors.textSecondary, fontSize: Typography.body.fontSize },
  errorContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.95)',
    padding: Spacing.xxl,
    gap: Spacing.md,
  },
  errorTitle: { color: Colors.text, fontSize: Typography.h2.fontSize, fontWeight: '700' },
  errorText: { color: Colors.textSecondary, fontSize: Typography.body.fontSize, textAlign: 'center' },
  retryButton: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
  },
  retryText: { color: Colors.text, fontWeight: '600' },
  backButtonError: { padding: Spacing.md },
  backButtonText: { color: Colors.textSecondary },

  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  iconButton: {
    width: 40, height: 40,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: BorderRadius.full,
    justifyContent: 'center', alignItems: 'center',
  },
  castWrap: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },

  osdContainer: { position: 'absolute' },
  osdBanner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(6,6,18,0.94)',
    borderRadius: 16, borderWidth: 1, borderColor: 'rgba(99,102,241,0.32)',
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg,
    gap: Spacing.lg, minHeight: 100,
  },
  osdLogoCol: { alignItems: 'center', gap: Spacing.xs, flexShrink: 0, width: 96 },
  osdLogoWrap: {
    width: 88, height: 56, backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: BorderRadius.md, justifyContent: 'center', alignItems: 'center',
    overflow: 'hidden',
  },
  osdLogo: { width: '82%', height: '82%' },
  osdChNumBadge: {
    backgroundColor: 'rgba(99,102,241,0.18)', borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(99,102,241,0.38)',
  },
  osdChNum: { color: Colors.primaryLight, fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  osdChannelName: { color: Colors.text, fontSize: 12, fontWeight: '700', textAlign: 'center', maxWidth: 100 },
  osdDivider: { width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.08)' },
  osdEpgCol: { flex: 1, gap: 6, justifyContent: 'center' },
  osdLiveRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  osdCatPill: {
    backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  osdCatText: { color: Colors.textSecondary, fontSize: 11, fontWeight: '500' },
  osdResBadge: {
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: BorderRadius.sm,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  osdResText: { color: Colors.text, fontSize: 10, fontWeight: '700' },
  osdAudBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: BorderRadius.sm,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  osdAudText: { color: Colors.text, fontSize: 10, fontWeight: '600' },
  osdCcBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: BorderRadius.sm,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  osdCcText: { color: Colors.text, fontSize: 10, fontWeight: '700' },
  osdRemaining: { color: Colors.textMuted, fontSize: 11, marginLeft: 'auto' },
  osdProgTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  osdProgTitle: { color: Colors.text, fontSize: Typography.body.fontSize, fontWeight: '600', flex: 1 },
  osdProgTime: { color: Colors.textMuted, fontSize: 11, fontVariant: ['tabular-nums'] },
  osdProgDesc: { color: Colors.textSecondary, fontSize: 12, lineHeight: 16 },
  osdProgBar: { height: 3, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' },
  osdProgFill: { height: '100%', backgroundColor: Colors.primary },
  osdNextRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  osdNextTitle: { color: Colors.textMuted, fontSize: 11, flex: 1 },
  osdNextTime: { color: Colors.textMuted, fontSize: 11 },
  osdNoEpg: { color: Colors.textMuted, fontSize: 12 },

  menuOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center',
    zIndex: 200,
  },
  menuCard: {
    width: 340, maxHeight: '80%',
    backgroundColor: 'rgba(8,8,20,0.98)',
    borderRadius: 16, borderWidth: 1, borderColor: 'rgba(99,102,241,0.32)',
    overflow: 'hidden',
  },
  menuHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.lg },
  menuChannelName: { flex: 1, color: Colors.text, fontSize: Typography.h3.fontSize, fontWeight: '700' },
  menuBackButton: { padding: 6, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.08)' },
  menuSeparator: { height: 1, backgroundColor: 'rgba(255,255,255,0.07)' },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
  },
  menuItemDisabled: { opacity: 0.4 },
  menuItemText: { flex: 1, color: Colors.text, fontSize: Typography.body.fontSize },
});
