import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  BackHandler,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';

import { Colors, Typography, Spacing, BorderRadius } from '../../constants/Colors';
import { useMediaStore } from '../../stores/mediaStore';

// Resolve a altura do vídeo em label legível
function getResolutionLabel(h: number): string {
  if (h >= 2160) return '4K';
  if (h >= 1440) return '2K';
  if (h >= 1080) return '1080p';
  if (h >= 720) return '720p';
  if (h >= 480) return '480p';
  if (h >= 360) return '360p';
  return `${h}p`;
}

// Formatar tempo em mm:ss ou hh:mm:ss
function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';

  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Resolve redirects manually by following HTTP 3xx responses.
 * Returns the final URL after all redirects.
 */
async function resolveRedirects(initialUrl: string): Promise<string> {
  try {
    // Use HEAD with redirect: 'follow' - fetch will follow redirects
    // and response.url will be the final URL
    const response = await fetch(initialUrl, {
      method: 'HEAD',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      },
    });
    const finalUrl = response.url;
    console.log('[MediaPlayer] Redirect resolved:', initialUrl, '->', finalUrl);
    return finalUrl;
  } catch (headError) {
    // HEAD might be blocked, try GET with range header (just 1 byte)
    try {
      const response = await fetch(initialUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'Range': 'bytes=0-0',
          'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        },
      });
      const finalUrl = response.url;
      console.log('[MediaPlayer] Redirect resolved (GET):', initialUrl, '->', finalUrl);
      return finalUrl;
    } catch (getError) {
      console.warn('[MediaPlayer] Could not resolve redirects, using original URL');
      return initialUrl;
    }
  }
}

export default function MediaPlayerScreen() {
  const params = useLocalSearchParams<{ id: string; url: string; title: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Decode the URL that was encoded when navigating to this screen
  const rawUrl = params.url || '';
  const decodedUrl = rawUrl ? decodeURIComponent(rawUrl) : '';
  const { id, title } = params;

  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(true);

  // Progress state
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [resolution, setResolution] = useState<string | null>(null);

  const videoRef = useRef<Video>(null);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const { addToHistory } = useMediaStore();

  // Resolve redirects before playing
  useEffect(() => {
    isMountedRef.current = true;

    console.log('[MediaPlayer] === DEBUG ===');
    console.log('[MediaPlayer] Raw param:', rawUrl);
    console.log('[MediaPlayer] Decoded URL:', decodedUrl);

    if (!decodedUrl) {
      setError('URL do vídeo não recebida');
      setDebugInfo('URL vazia - nenhum parâmetro recebido');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setDebugInfo(`Resolvendo: ${decodedUrl}`);

    resolveRedirects(decodedUrl).then((finalUrl) => {
      if (!isMountedRef.current) return;
      console.log('[MediaPlayer] Final URL to play:', finalUrl);
      setDebugInfo(`Original: ${decodedUrl}\nFinal: ${finalUrl}`);
      setResolvedUrl(finalUrl);
    }).catch((err) => {
      if (!isMountedRef.current) return;
      console.error('[MediaPlayer] Redirect resolution failed:', err);
      // Fallback: try with the original URL anyway
      setDebugInfo(`Fallback para URL original: ${decodedUrl}\nErro resolve: ${err}`);
      setResolvedUrl(decodedUrl);
    });

    return () => {
      isMountedRef.current = false;
    };
  }, [decodedUrl]);

  // Handle playback status updates from expo-av
  const onPlaybackStatusUpdate = useCallback((status: AVPlaybackStatus) => {
    if (!isMountedRef.current) return;

    if (!status.isLoaded) {
      if (status.error) {
        console.error('[MediaPlayer] Playback error:', status.error);
        setDebugInfo(prev => `${prev}\nPlayback error: ${status.error}`);
        setError(`Erro ao reproduzir: ${status.error}`);
        setIsLoading(false);
      }
      return;
    }

    // Update loading state
    if (status.isBuffering && !status.isPlaying) {
      setIsLoading(true);
    } else {
      setIsLoading(false);
      setError(null);
    }

    setIsPlaying(status.isPlaying);

    if (status.positionMillis !== undefined) {
      setCurrentTime(status.positionMillis / 1000);
    }
    if (status.durationMillis !== undefined && status.durationMillis > 0) {
      setDuration(status.durationMillis / 1000);
    }
  }, []);

  // Detect video resolution when ready for display
  const handleReadyForDisplay = useCallback((event: any) => {
    const { naturalSize } = event;
    if (naturalSize) {
      const h = Math.min(naturalSize.width, naturalSize.height);
      const w = Math.max(naturalSize.width, naturalSize.height);
      // Use the smaller dimension as height (accounts for orientation)
      setResolution(getResolutionLabel(naturalSize.orientation === 'landscape' ? h : Math.min(w, h)));
    }
  }, []);

  // Forçar landscape
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    };
  }, []);

  // Hide controls timer
  const resetHideTimer = useCallback(() => {
    if (hideControlsTimer.current) {
      clearTimeout(hideControlsTimer.current);
    }
    setShowControls(true);
    hideControlsTimer.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 4000);
  }, [isPlaying]);

  useEffect(() => {
    resetHideTimer();
    return () => {
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    };
  }, [resetHideTimer]);

  // Back handler
  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      handleClose();
      return true;
    });
    return () => handler.remove();
  }, []);

  const handleClose = useCallback(async () => {
    isMountedRef.current = false;
    try {
      await videoRef.current?.pauseAsync();
    } catch (e) {}
    if (id) addToHistory(id);
    router.back();
  }, [id, router, addToHistory]);

  const togglePlayPause = useCallback(async () => {
    if (isPlaying) {
      await videoRef.current?.pauseAsync();
    } else {
      await videoRef.current?.playAsync();
    }
    resetHideTimer();
  }, [isPlaying, resetHideTimer]);

  // Skip forward/backward
  const handleSkipForward = useCallback(async () => {
    const newTime = Math.min(currentTime + 10, duration);
    await videoRef.current?.setPositionAsync(newTime * 1000);
    setCurrentTime(newTime);
    resetHideTimer();
  }, [currentTime, duration, resetHideTimer]);

  const handleSkipBackward = useCallback(async () => {
    const newTime = Math.max(currentTime - 10, 0);
    await videoRef.current?.setPositionAsync(newTime * 1000);
    setCurrentTime(newTime);
    resetHideTimer();
  }, [currentTime, resetHideTimer]);

  // Seek by tapping on progress bar
  const handleSeekPress = useCallback(async (event: any) => {
    const { locationX } = event.nativeEvent;
    const barWidth = Dimensions.get('window').width - Spacing.lg * 2;
    const percent = Math.max(0, Math.min(1, locationX / barWidth));
    const newTime = percent * duration;
    await videoRef.current?.setPositionAsync(newTime * 1000);
    setCurrentTime(newTime);
    resetHideTimer();
  }, [duration, resetHideTimer]);

  const handleRetry = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    setDebugInfo('');

    // Re-resolve redirects on retry
    const urlToResolve = decodedUrl;
    try {
      const finalUrl = await resolveRedirects(urlToResolve);
      setResolvedUrl(null); // force re-mount of Video
      setDebugInfo(`Retry - Original: ${urlToResolve}\nFinal: ${finalUrl}`);
      setTimeout(() => setResolvedUrl(finalUrl), 100);
    } catch (e) {
      setResolvedUrl(null);
      setDebugInfo(`Retry fallback: ${urlToResolve}`);
      setTimeout(() => setResolvedUrl(urlToResolve), 100);
    }
  }, [decodedUrl]);

  const handleScreenPress = () => {
    if (showControls) {
      setShowControls(false);
    } else {
      resetHideTimer();
    }
  };

  // Calcular progresso
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      {/* Video - only render when URL is resolved */}
      <TouchableOpacity
        style={styles.videoContainer}
        activeOpacity={1}
        onPress={handleScreenPress}
      >
        {resolvedUrl ? (
          <Video
            ref={videoRef}
            source={{
              uri: resolvedUrl,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
              },
            }}
            style={styles.video}
            resizeMode={ResizeMode.CONTAIN}
            shouldPlay={true}
            isLooping={false}
            useNativeControls={false}
            onPlaybackStatusUpdate={onPlaybackStatusUpdate}
            onReadyForDisplay={handleReadyForDisplay}
            onError={(err: string) => {
              console.error('[MediaPlayer] Video onError:', err);
              setDebugInfo(prev => `${prev}\nonError: ${err}`);
              setError(`Erro no vídeo: ${err}`);
              setIsLoading(false);
            }}
          />
        ) : null}
      </TouchableOpacity>

      {/* Loading overlay */}
      {isLoading && !error && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>
            {resolvedUrl ? 'Carregando vídeo...' : 'Resolvendo link...'}
          </Text>
        </View>
      )}

      {/* Error overlay */}
      {error && (
        <View style={styles.overlay}>
          <Ionicons name="alert-circle-outline" size={64} color={Colors.error} />
          <Text style={styles.errorText}>{error}</Text>

          {/* Debug info visible on screen */}
          <View style={styles.debugContainer}>
            <Text style={styles.debugTitle}>DEBUG INFO:</Text>
            <Text style={styles.debugText} selectable>ID: {id || '(vazio)'}</Text>
            <Text style={styles.debugText} selectable>
              {debugInfo || `URL: ${decodedUrl || '(vazia)'}`}
            </Text>
          </View>

          <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
            <Ionicons name="refresh" size={20} color="#000" />
            <Text style={styles.retryText}>Tentar novamente</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Controls overlay */}
      {showControls && !error && (
        <View style={styles.controls}>
          {/* Top bar */}
          <View style={[styles.topBar, { paddingTop: insets.top || 10 }]}>
            <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.title} numberOfLines={1}>{title || 'Reproduzindo'}</Text>
            {resolution && (
              <View style={styles.resolutionBadge}>
                <Text style={styles.resolutionText}>{resolution}</Text>
              </View>
            )}
          </View>

          {/* Center controls */}
          <View style={styles.centerControls}>
            {/* Skip backward */}
            <TouchableOpacity style={styles.skipButton} onPress={handleSkipBackward}>
              <Ionicons name="play-back" size={32} color="white" />
              <Text style={styles.skipText}>10s</Text>
            </TouchableOpacity>

            {/* Play/Pause */}
            <TouchableOpacity style={styles.playButton} onPress={togglePlayPause}>
              <Ionicons
                name={isPlaying ? 'pause' : 'play'}
                size={48}
                color="white"
              />
            </TouchableOpacity>

            {/* Skip forward */}
            <TouchableOpacity style={styles.skipButton} onPress={handleSkipForward}>
              <Ionicons name="play-forward" size={32} color="white" />
              <Text style={styles.skipText}>10s</Text>
            </TouchableOpacity>
          </View>

          {/* Bottom bar with progress */}
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom || 10 }]}>
            {/* Time display */}
            <View style={styles.timeContainer}>
              <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
              <Text style={styles.timeSeparator}>/</Text>
              <Text style={styles.timeText}>{formatTime(duration)}</Text>
            </View>

            {/* Progress bar (tappable) */}
            <TouchableOpacity
              style={styles.progressBarContainer}
              activeOpacity={0.8}
              onPress={handleSeekPress}
            >
              <View style={styles.progressBarBg}>
                <View style={[styles.progressBarFill, { width: `${progress}%` }]} />
                <View style={[styles.progressThumb, { left: `${progress}%` }]} />
              </View>
            </TouchableOpacity>

            {/* Progress percentage */}
            <View style={styles.progressInfo}>
              <Text style={styles.progressText}>{Math.round(progress)}%</Text>
            </View>
          </View>
        </View>
      )}
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
  },
  video: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.8)',
  },
  loadingText: {
    color: Colors.text,
    marginTop: Spacing.md,
    fontSize: Typography.body.fontSize,
  },
  errorText: {
    color: Colors.error,
    marginTop: Spacing.md,
    fontSize: Typography.body.fontSize,
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.lg,
    gap: Spacing.sm,
  },
  retryText: {
    color: '#000',
    fontWeight: '600',
  },
  debugContainer: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding: 12,
    marginTop: 16,
    marginHorizontal: 20,
    maxWidth: '90%',
  },
  debugTitle: {
    color: '#FFD700',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  debugText: {
    color: '#aaa',
    fontSize: 10,
    fontFamily: 'monospace',
    marginBottom: 3,
  },
  controls: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  closeButton: {
    padding: Spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: BorderRadius.full,
  },
  title: {
    flex: 1,
    color: Colors.text,
    fontSize: Typography.h3.fontSize,
    fontWeight: '600',
    textAlign: 'center',
    marginHorizontal: Spacing.md,
  },
  centerControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.xxl,
  },
  playButton: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: Spacing.lg,
    borderRadius: BorderRadius.full,
  },
  skipButton: {
    alignItems: 'center',
    padding: Spacing.md,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: BorderRadius.lg,
  },
  skipText: {
    color: Colors.text,
    fontSize: 10,
    marginTop: 2,
  },
  bottomBar: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  timeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  timeText: {
    color: Colors.text,
    fontSize: Typography.caption.fontSize,
    fontFamily: 'monospace',
  },
  timeSeparator: {
    color: Colors.textSecondary,
    marginHorizontal: Spacing.xs,
  },
  progressBarContainer: {
    width: '100%',
    height: 40,
    justifyContent: 'center',
    paddingVertical: 10,
  },
  progressBarBg: {
    width: '100%',
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 3,
    position: 'relative',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 3,
  },
  progressThumb: {
    position: 'absolute',
    width: 16,
    height: 16,
    backgroundColor: Colors.primary,
    borderRadius: 8,
    top: -5,
    marginLeft: -8,
  },
  progressInfo: {
    alignItems: 'center',
    marginTop: Spacing.xs,
  },
  progressText: {
    color: Colors.textSecondary,
    fontSize: Typography.caption.fontSize,
  },
  resolutionBadge: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  resolutionText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
