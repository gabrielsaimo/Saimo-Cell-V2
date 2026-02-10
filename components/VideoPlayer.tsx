import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  StatusBar,
  BackHandler,
} from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Channel, CurrentProgram } from '../types';
import { Colors, BorderRadius, Spacing, Typography } from '../constants/Colors';
import { useFavoritesStore } from '../stores/favoritesStore';
import { getCurrentProgram, fetchChannelEPG } from '../services/epgService';

interface VideoPlayerProps {
  channel: Channel;
}

export default function VideoPlayer({ channel }: VideoPlayerProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [showControls, setShowControls] = useState(true);
  const [epg, setEpg] = useState<CurrentProgram | null>(null);
  const [hasError, setHasError] = useState(false);

  const { toggleFavorite, isFavorite } = useFavoritesStore();
  const [favorite, setFavorite] = useState(isFavorite(channel.id));

  const videoRef = useRef<Video>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  // Handle playback status updates from expo-av
  const onPlaybackStatusUpdate = useCallback((status: AVPlaybackStatus) => {
    if (!isMountedRef.current) return;

    if (!status.isLoaded) {
      if (status.error) {
        setHasError(true);
      }
      return;
    }

    // If it loaded successfully, clear error
    if (status.isLoaded && hasError) {
      setHasError(false);
    }
  }, [hasError]);

  // Cleanup ao desmontar
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      try {
        videoRef.current?.pauseAsync();
      } catch (e) {
        // Ignora erros de cleanup
      }
    };
  }, []);

  // Forçar orientação paisagem ao entrar
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);

    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    };
  }, []);

  // Carregar EPG do canal (não-bloqueante)
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

  // Auto-hide dos controles
  useEffect(() => {
    if (showControls && !hasError) {
      controlsTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          setShowControls(false);
        }
      }, 3000);
    }

    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [showControls, hasError]);

  // Tratar botão voltar - INSTANTÂNEO
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true;
    });
    return () => backHandler.remove();
  }, []);

  const handleBack = useCallback(() => {
    isMountedRef.current = false;
    try {
      videoRef.current?.pauseAsync();
    } catch (e) {}
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    router.back();
  }, [router]);

  const handleToggleFavorite = useCallback(() => {
    toggleFavorite(channel.id);
    setFavorite(prev => !prev);
  }, [channel.id, toggleFavorite]);

  const handleScreenPress = useCallback(() => {
    if (!hasError) {
      setShowControls(prev => !prev);
    }
  }, [hasError]);

  const handleRetry = useCallback(async () => {
    setHasError(false);
    try {
      await videoRef.current?.unloadAsync();
      await videoRef.current?.loadAsync(
        { uri: channel.url },
        { shouldPlay: true }
      );
    } catch (e) {
      setHasError(true);
    }
  }, [channel.url]);

  const { width, height } = Dimensions.get('window');

  // Formata tempo restante
  const formatRemaining = (minutes?: number) => {
    if (!minutes) return '';
    if (minutes < 60) return `${minutes}min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h${mins}min`;
  };

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      <TouchableOpacity
        style={styles.videoContainer}
        onPress={handleScreenPress}
        activeOpacity={1}
      >
        <Video
          ref={videoRef}
          source={{ uri: channel.url }}
          style={{ width: Math.max(width, height), height: Math.min(width, height) }}
          resizeMode={ResizeMode.CONTAIN}
          shouldPlay={true}
          isLooping={false}
          useNativeControls={false}
          onPlaybackStatusUpdate={onPlaybackStatusUpdate}
        />

        {/* Error State */}
        {hasError && (
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
        {showControls && !hasError && (
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

              <TouchableOpacity
                style={[styles.iconButton, favorite && styles.iconButtonActive]}
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
    backgroundColor: 'rgba(255, 71, 87, 0.2)',
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
});
