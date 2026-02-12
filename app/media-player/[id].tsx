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
  Platform,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { CastButton, useRemoteMediaClient } from 'react-native-google-cast';

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
  const [isPip, setIsPip] = useState(false);

  const videoViewRef = useRef<VideoView>(null);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const { addToHistory } = useMediaStore();
  
  // Google Cast
  const client = useRemoteMediaClient();

  // Resolve redirects logic
  useEffect(() => {
    isMountedRef.current = true;
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
      setDebugInfo(`Fallback para URL original: ${decodedUrl}\nErro resolve: ${err}`);
      setResolvedUrl(decodedUrl);
    });

    return () => { isMountedRef.current = false; };
  }, [decodedUrl]);

  // Load Cast Media
  useEffect(() => {
    if (client && resolvedUrl) {
      client.loadMedia({
        mediaInfo: {
          contentUrl: resolvedUrl,
          metadata: {
            title: title || 'Filme/Série',
            subtitle: 'Saimo TV',
            images: [
              { url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg' },
            ],
            type: 'movie',
          },
        },
        autoplay: true,
      });
    }
  }, [client, resolvedUrl, title]);

  // Expo Video Setup
  const player = useVideoPlayer(resolvedUrl, (player) => {
    player.play();
  });

  // Player Event Listeners
  useEffect(() => {
    if (!player) return;

    const subscriptions: any[] = [];

    subscriptions.push(player.addListener('statusChange', (payload) => {
       if (!isMountedRef.current) return;
       const { status, error } = payload;
       
       if (status === 'loading') {
         setIsLoading(true);
       } else {
         setIsLoading(false);
         if (status === 'error' && error) {
            setError(`Erro ao reproduzir: ${error.message}`);
         }
       }
    }));

    subscriptions.push(player.addListener('playingChange', (payload) => {
       if (!isMountedRef.current) return;
       setIsPlaying(payload.isPlaying);
    }));

    subscriptions.push(player.addListener('timeUpdate', (event) => {
      if (!isMountedRef.current) return;
      setCurrentTime(event.currentTime);
      // duration might be available on player.duration
      if (player.duration) {
         setDuration(player.duration);
      }
    }));
    
    // Attempt to get resolution from source if possible/available in future updates
    // subscriptions.push(player.addListener('sourceChange', ...));

    return () => {
      subscriptions.forEach(sub => sub.remove());
    };
  }, [player]);

  // Force Landscape
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    };
  }, []);

  // Controls Timer
  const resetHideTimer = useCallback(() => {
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
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

  // Back Handler
  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      handleClose();
      return true;
    });
    return () => handler.remove();
  }, []);

  const handleClose = useCallback(async () => {
    isMountedRef.current = false;
    if (player) player.pause();
    if (id) addToHistory(id);
    router.back();
  }, [id, router, addToHistory, player]);

  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      player.pause();
    } else {
      player.play();
    }
    resetHideTimer();
  }, [isPlaying, player, resetHideTimer]);

  const handleSkipForward = useCallback(() => {
    if (!player) return;
    const newTime = Math.min(currentTime + 10, duration || currentTime + 10);
    player.currentTime = newTime;
    resetHideTimer();
  }, [currentTime, duration, player, resetHideTimer]);

  const handleSkipBackward = useCallback(() => {
    if (!player) return;
    const newTime = Math.max(currentTime - 10, 0);
    player.currentTime = newTime;
    resetHideTimer();
  }, [currentTime, player, resetHideTimer]);

  const handleSeekPress = useCallback((event: any) => {
    if (!player || duration <= 0) return;
    const { locationX } = event.nativeEvent;
    const barWidth = Dimensions.get('window').width - Spacing.lg * 2;
    const percent = Math.max(0, Math.min(1, locationX / barWidth));
    const newTime = percent * duration;
    player.currentTime = newTime;
    resetHideTimer();
  }, [duration, player, resetHideTimer]);

  // PIP Handler
  const enterPip = useCallback(async () => {
    if (videoViewRef.current) {
      try {
        await videoViewRef.current.startPictureInPicture();
      } catch (e) {
        console.warn('[MediaPlayer] PiP indisponível:', e);
      }
    }
  }, []);

  const handleScreenPress = () => {
    if (showControls) setShowControls(false);
    else resetHideTimer();
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      <TouchableOpacity
        style={styles.videoContainer}
        activeOpacity={1}
        onPress={handleScreenPress}
      >
        {resolvedUrl ? (
          <VideoView
            ref={videoViewRef}
            player={player}
            style={styles.video}
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
        ) : null}
      </TouchableOpacity>

      {/* Loading Overlay */}
      {isLoading && !error && !isPip && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>
            {resolvedUrl ? 'Carregando vídeo...' : 'Resolvendo link...'}
          </Text>
        </View>
      )}

      {/* Error Overlay */}
      {error && !isPip && (
        <View style={styles.overlay}>
          <Ionicons name="alert-circle-outline" size={64} color={Colors.error} />
          <Text style={styles.errorText}>{error}</Text>
          <View style={styles.debugContainer}>
            <Text style={styles.debugTitle}>DEBUG INFO:</Text>
            <Text style={styles.debugText} selectable>ID: {id || '(vazio)'}</Text>
            <Text style={styles.debugText} selectable>{debugInfo}</Text>
          </View>
          <TouchableOpacity 
            style={styles.retryButton} 
            onPress={() => {
                setError(null);
                setResolvedUrl(null); // trigger re-resolve
            }}
          >
            <Ionicons name="refresh" size={20} color="#000" />
            <Text style={styles.retryText}>Tentar novamente</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Controls Overlay */}
      {showControls && !error && !isPip && (
        <View style={styles.controls}>
          {/* Top Bar */}
          <View style={[styles.topBar, { paddingTop: insets.top || 10 }]}>
            <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            
            <Text style={styles.title} numberOfLines={1}>{title || 'Reproduzindo'}</Text>

            <View style={styles.topRightControls}>
               <CastButton style={{ width: 24, height: 24, tintColor: 'white', marginRight: 16 }} />
               <TouchableOpacity onPress={enterPip}>
                  <MaterialIcons name="picture-in-picture-alt" size={24} color="white" />
               </TouchableOpacity>
            </View>
          </View>

          {/* Center Controls */}
          <View style={styles.centerControls}>
            <TouchableOpacity style={styles.skipButton} onPress={handleSkipBackward}>
              <Ionicons name="play-back" size={32} color="white" />
              <Text style={styles.skipText}>10s</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.playButton} onPress={togglePlayPause}>
              <Ionicons
                name={isPlaying ? 'pause' : 'play'}
                size={48}
                color="white"
              />
            </TouchableOpacity>

            <TouchableOpacity style={styles.skipButton} onPress={handleSkipForward}>
              <Ionicons name="play-forward" size={32} color="white" />
              <Text style={styles.skipText}>10s</Text>
            </TouchableOpacity>
          </View>

          {/* Bottom Bar */}
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom || 10 }]}>
            <View style={styles.timeContainer}>
              <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
              <Text style={styles.timeSeparator}>/</Text>
              <Text style={styles.timeText}>{formatTime(duration)}</Text>
            </View>

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
  topRightControls: {
    flexDirection: 'row',
    alignItems: 'center',
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
});
