import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  StatusBar,
  BackHandler,
  ScrollView,
  Platform,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { CastButton, useRemoteMediaClient } from 'react-native-google-cast';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Channel, CurrentProgram } from '../types';
import { Colors, BorderRadius, Spacing, Typography } from '../constants/Colors';
import { useFavoritesStore } from '../stores/favoritesStore';
import { getCurrentProgram, fetchChannelEPG } from '../services/epgService';
import { channels as allChannelsList } from '../data/channels';

function getResolutionLabel(h: number): string {
  if (h >= 2160) return '4K';
  if (h >= 1440) return '2K';
  if (h >= 1080) return '1080p';
  if (h >= 720) return '720p';
  if (h >= 480) return '480p';
  if (h >= 360) return '360p';
  return `${h}p`;
}

interface VideoPlayerProps {
  channel: Channel;
}

export default function VideoPlayer({ channel }: VideoPlayerProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  
  // Google Cast Client
  const client = useRemoteMediaClient();

  // Setup expo-video player
  const player = useVideoPlayer(channel.url, player => {
    player.play();
  });

  const videoViewRef = useRef<VideoView>(null);
  const [showControls, setShowControls] = useState(true);
  const [epg, setEpg] = useState<CurrentProgram | null>(null);
  const [hasError, setHasError] = useState(false);
  const [resolution, setResolution] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [isPip, setIsPip] = useState(false);

  const { toggleFavorite, isFavorite } = useFavoritesStore();
  const [favorite, setFavorite] = useState(isFavorite(channel.id));

  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  // Cast Media when client connects or channel changes
  useEffect(() => {
    if (client) {
      client.loadMedia({
        mediaInfo: {
          contentUrl: channel.url,
          metadata: {
            type: 'movie', 
            title: channel.name,
            images: channel.logo ? [{ url: channel.logo }] : [],
          },
        },
        autoplay: true,
      });
    }
  }, [client, channel]);

  // Handle Player Source Change explicitly if needed (useVideoPlayer handles simple string changes, 
  // but explicitly replacing can be safer for deep updates)
  useEffect(() => {
    if (player && channel.url) {
        // useVideoPlayer handles this, but we can force replace if logic requires
        // player.replace(channel.url); 
        // For now relying on useVideoPlayer dependency update
    }
  }, [channel.url, player]);

  // Listener setup
  useEffect(() => {
    if (!player) return;

    const subscriptions: any[] = [];

    subscriptions.push(player.addListener('statusChange', (payload) => {
        if (!isMountedRef.current) return;
        if (payload.status === 'error') {
            setHasError(true);
        }
    }));
    
    // We can also listen to playingChange if needed, though useVideoPlayer hook handles re-renders often
    // subscriptions.push(player.addListener('playingChange', ...));

    return () => {
        subscriptions.forEach(s => s.remove());
    };
  }, [player]); 

  // Cleanup
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      try {
        player.pause();
      } catch (e) {
        // Ignore pause errors on unmount
        console.log('Error pausing on unmount:', e);
      }
    };
  }, [player]);

  // Force Landscape
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    };
  }, []);

  // Fetch EPG
  useEffect(() => {
    fetchChannelEPG(channel.id).then(() => {
      if (isMountedRef.current) {
        setEpg(getCurrentProgram(channel.id));
      }
    }).catch(() => {});

    const interval = setInterval(() => {
      if (isMountedRef.current) {
        setEpg(getCurrentProgram(channel.id));
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [channel.id]);

  // Auto-hide controls
  useEffect(() => {
    if (showControls && !hasError) {
      controlsTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          setShowControls(false);
        }
      }, 3000);
    }
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [showControls, hasError]);

  // Back Handler
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true;
    });
    return () => backHandler.remove();
  }, []);

  const handleBack = useCallback(async () => {
    // Navigate back first, let useEffect cleanup handle the player
    router.back();
    // Reset orientation after navigation start
    try {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    } catch (e) {
      console.warn('Failed to unlock orientation:', e);
    }
  }, [router]);

  const handleToggleFavorite = useCallback(() => {
    toggleFavorite(channel.id);
    setFavorite(prev => !prev);
  }, [channel.id, toggleFavorite]);

  const handleScreenPress = useCallback(() => {
    if (showGuide) {
      setShowGuide(false);
      return;
    }
    if (!hasError) {
      setShowControls(prev => !prev);
    }
  }, [hasError, showGuide]);

  const handleRetry = useCallback(() => {
    setHasError(false);
    player.replace(channel.url);
    player.play();
  }, [channel.url, player]);

  // VideoView handles resolution automatically but doesn't expose strict event like "onReadyForDisplay" 
  // with natural size in the same way. We can inspect player.videoSize if available via event.
  // For now leaving resolution simplified.

  // Guide Logic
  const guideChannels = useMemo(() => {
    if (!showGuide) return [];
    return allChannelsList.map(ch => ({
      channel: ch,
      epg: getCurrentProgram(ch.id),
    }));
  }, [showGuide]);

  const guideScrollRef = useRef<ScrollView>(null);

  const handleToggleGuide = useCallback(() => {
    setShowGuide(prev => !prev);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    if (!showGuide) setShowControls(true);
  }, [showGuide]);

  const handleSwitchChannel = useCallback((targetChannel: Channel) => {
    setShowGuide(false);
    // Just replace the route, useEffect cleanup handles the rest
    router.replace({
      pathname: '/player/[id]',
      params: { id: targetChannel.id },
    });
  }, [router]);

  // Scroll to current channel in guide
  useEffect(() => {
    if (showGuide && guideScrollRef.current) {
      const idx = allChannelsList.findIndex(ch => ch.id === channel.id);
      if (idx > 0) {
        setTimeout(() => {
          guideScrollRef.current?.scrollTo({ y: Math.max(0, idx * 52 - 60), animated: false });
        }, 50);
      }
    }
  }, [showGuide, channel.id]);

  const { width, height } = Dimensions.get('window');

  const formatRemaining = (minutes?: number) => {
    if (!minutes) return '';
    if (minutes < 60) return `${minutes}min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h${mins}min`;
  };

  const handlePip = async () => {
    if (videoViewRef.current) {
      try {
        await videoViewRef.current.startPictureInPicture();
      } catch (e) {
        console.warn('[VideoPlayer] PiP indisponível:', e);
      }
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      <TouchableOpacity
        style={styles.videoContainer}
        onPress={handleScreenPress}
        activeOpacity={1}
      >
        <VideoView
          ref={videoViewRef}
          player={player}
          style={{ width: Math.max(width, height), height: Math.min(width, height) }}
          contentFit="contain"
          nativeControls={false}
          allowsPictureInPicture
          allowsFullscreen
          onPictureInPictureStart={() => {
            setIsPip(true);
            setShowControls(false);
          }}
          onPictureInPictureStop={() => {
            setIsPip(false);
          }}
        />

        {/* Error State */}
        {hasError && !isPip && (
          <View style={styles.errorContainer}>
            <Ionicons name="alert-circle-outline" size={64} color={Colors.error} />
            <Text style={styles.errorTitle}>Canal indisponível</Text>
            <Text style={styles.errorText}>
              Este canal está temporariamente fora do ar.{'\n'}
              Tente novamente mais tarde.
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

        {/* Controls Overlay */}
        {showControls && !hasError && !isPip && (
          <>
            <LinearGradient
              colors={['rgba(0,0,0,0.7)', 'transparent', 'transparent', 'rgba(0,0,0,0.7)']}
              style={styles.gradient}
            />

            {/* Top Bar */}
            <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
              <TouchableOpacity style={styles.backButton} onPress={handleBack}>
                <Ionicons name="arrow-back" size={28} color={Colors.text} />
              </TouchableOpacity>

              <View style={styles.channelInfo}>
                <Text style={styles.channelName}>{channel.name}</Text>
                <Text style={styles.channelCategory}>{channel.category}</Text>
              </View>

              {/* Cast Button */}
              <View style={{ width: 44, height: 44, justifyContent: 'center', alignItems: 'center', marginRight: 8 }}>
                 <CastButton style={{ width: 24, height: 24, tintColor: Colors.text }} />
              </View>

              {/* PIP Button */}
              {Platform.OS !== 'web' && (
                <TouchableOpacity
                    style={[styles.iconButton]}
                    onPress={handlePip}
                >
                    <MaterialIcons name="picture-in-picture-alt" size={24} color={Colors.text} />
                </TouchableOpacity>
              )}

              {resolution && (
                <View style={styles.resolutionBadge}>
                  <Text style={styles.resolutionText}>{resolution}</Text>
                </View>
              )}

              <TouchableOpacity
                style={[styles.iconButton, showGuide && styles.iconButtonActive]}
                onPress={handleToggleGuide}
              >
                <Ionicons name="list" size={24} color={Colors.text} />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.iconButton, favorite && styles.iconButtonFav]}
                onPress={handleToggleFavorite}
              >
                <Ionicons
                  name={favorite ? 'heart' : 'heart-outline'}
                  size={24}
                  color={favorite ? '#FF4757' : Colors.text}
                />
              </TouchableOpacity>
            </View>

            {/* Bottom Bar - EPG */}
            <View style={[styles.bottomBar, { paddingBottom: insets.bottom + Spacing.sm }]}>
              <View style={styles.epgInfo}>
                {epg?.current ? (
                  <>
                    <View style={styles.liveRow}>
                      <View style={styles.liveIndicator}>
                        <View style={styles.liveDot} />
                        <Text style={styles.liveText}>AO VIVO</Text>
                      </View>
                      <Text style={styles.remainingText}>
                        {formatRemaining(epg.remaining)}
                      </Text>
                    </View>
                    <Text style={styles.programTitle} numberOfLines={1}>
                      {epg.current.title}
                    </Text>
                    <View style={styles.progressBar}>
                      <View
                        style={[styles.progressFill, { width: `${epg.progress}%` }]}
                      />
                    </View>
                    {epg.next && (
                      <View style={styles.nextContainer}>
                        <Text style={styles.nextLabel}>A seguir:</Text>
                        <Text style={styles.nextProgram} numberOfLines={1}>
                          {epg.next.title}
                        </Text>
                      </View>
                    )}
                  </>
                ) : (
                  <>
                    <View style={styles.liveIndicator}>
                      <View style={styles.liveDot} />
                      <Text style={styles.liveText}>AO VIVO</Text>
                    </View>
                    <Text style={styles.programTitle}>{channel.name}</Text>
                  </>
                )}
              </View>
            </View>
          </>
        )}

        {/* Global Programming Guide Overlay */}
        {showGuide && (
          <View style={styles.guideOverlay}>
            <TouchableOpacity style={styles.guideBackdrop} onPress={handleToggleGuide} activeOpacity={1} />
            <View style={styles.guideContainer}>
              <View style={styles.guideHeader}>
                <Ionicons name="tv-outline" size={18} color={Colors.primary} />
                <Text style={styles.guideTitle}>Guia de Canais</Text>
                <TouchableOpacity onPress={handleToggleGuide} style={styles.guideClose}>
                  <Ionicons name="close" size={24} color={Colors.text} />
                </TouchableOpacity>
              </View>
              <ScrollView
                ref={guideScrollRef}
                style={styles.guideList}
                showsVerticalScrollIndicator={false}
              >
                {guideChannels.map(({ channel: ch, epg: chEpg }) => {
                  const isActive = ch.id === channel.id;
                  return (
                    <TouchableOpacity
                      key={ch.id}
                      style={[styles.guideItem, isActive && styles.guideItemActive]}
                      onPress={() => !isActive && handleSwitchChannel(ch)}
                      activeOpacity={isActive ? 1 : 0.6}
                    >
                      <View style={styles.guideChannelNum}>
                        <Text style={[styles.guideNumText, isActive && styles.guideNumTextActive]}>
                          {ch.channelNumber}
                        </Text>
                      </View>
                      <View style={styles.guideChannelInfo}>
                        <Text
                          style={[styles.guideChannelName, isActive && styles.guideChannelNameActive]}
                          numberOfLines={1}
                        >
                          {ch.name}
                        </Text>
                        {chEpg?.current ? (
                          <Text style={styles.guideProgramName} numberOfLines={1}>
                            {chEpg.current.title}
                          </Text>
                        ) : (
                          <Text style={styles.guideProgramEmpty}>{ch.category}</Text>
                        )}
                      </View>
                      {isActive && (
                        <View style={styles.guideActiveBadge}>
                          <View style={styles.guideActiveDot} />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  videoContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  gradient: {
    ...StyleSheet.absoluteFillObject,
  },
  errorContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.95)',
    padding: Spacing.xxl,
  },
  errorTitle: {
    color: Colors.text,
    fontSize: Typography.h2.fontSize,
    fontWeight: '700',
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  errorText: {
    color: Colors.textSecondary,
    fontSize: Typography.body.fontSize,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.xl,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    gap: Spacing.sm,
  },
  retryText: {
    color: Colors.text,
    fontWeight: '600',
    fontSize: Typography.body.fontSize,
  },
  backButtonError: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  backButtonText: {
    color: Colors.textSecondary,
    fontSize: Typography.body.fontSize,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  backButton: {
    padding: Spacing.sm,
    marginRight: Spacing.sm,
  },
  channelInfo: {
    flex: 1,
  },
  channelName: {
    color: Colors.text,
    fontSize: Typography.h3.fontSize,
    fontWeight: '600',
  },
  channelCategory: {
    color: Colors.textSecondary,
    fontSize: Typography.caption.fontSize,
  },
  iconButton: {
    padding: Spacing.sm,
    marginLeft: Spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: BorderRadius.full,
  },
  iconButtonActive: {
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  iconButtonFav: {
    backgroundColor: 'rgba(255, 71, 87, 0.2)',
  },
  resolutionBadge: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    marginLeft: Spacing.sm,
  },
  resolutionText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  epgInfo: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
  },
  liveRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.live,
    marginRight: Spacing.xs,
  },
  liveText: {
    color: Colors.live,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  remainingText: {
    color: Colors.textSecondary,
    fontSize: 12,
  },
  programTitle: {
    color: Colors.text,
    fontSize: Typography.bodyLarge.fontSize,
    fontWeight: '600',
    marginBottom: Spacing.sm,
  },
  progressBar: {
    height: 4,
    backgroundColor: Colors.progressBg,
    borderRadius: BorderRadius.xs,
    overflow: 'hidden',
    marginBottom: Spacing.sm,
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.progressFill,
  },
  nextContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  nextLabel: {
    color: Colors.textSecondary,
    fontSize: Typography.caption.fontSize,
    fontWeight: '600',
  },
  nextProgram: {
    color: Colors.textSecondary,
    fontSize: Typography.caption.fontSize,
    flex: 1,
  },
  // Guide overlay styles
  guideOverlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
  },
  guideBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  guideContainer: {
    width: '50%',
    backgroundColor: 'rgba(20,20,20,0.98)',
  },
  guideHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    gap: Spacing.sm,
  },
  guideTitle: {
    color: Colors.text,
    fontSize: Typography.body.fontSize,
    fontWeight: '700',
    flex: 1,
  },
  guideClose: {
    padding: Spacing.xs,
  },
  guideList: {
    flex: 1,
  },
  guideItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  guideItemActive: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
  },
  guideChannelNum: {
    width: 32,
    alignItems: 'center',
  },
  guideNumText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  guideNumTextActive: {
    color: Colors.primary,
  },
  guideChannelInfo: {
    flex: 1,
    marginLeft: Spacing.sm,
  },
  guideChannelName: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  guideChannelNameActive: {
    color: Colors.primary,
  },
  guideProgramName: {
    color: Colors.textSecondary,
    fontSize: 11,
    marginTop: 1,
  },
  guideProgramEmpty: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: 11,
    marginTop: 1,
  },
  guideActiveBadge: {
    marginLeft: Spacing.sm,
  },
  guideActiveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.live,
  },
});
