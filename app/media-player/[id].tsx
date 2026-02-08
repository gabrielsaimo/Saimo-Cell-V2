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
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEvent } from 'expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';

import { Colors, Typography, Spacing, BorderRadius } from '../../constants/Colors';
import { useMediaStore } from '../../stores/mediaStore';

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

export default function MediaPlayerScreen() {
  const { id, url, title } = useLocalSearchParams<{ id: string; url: string; title: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  
  const [showControls, setShowControls] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  
  // Progress state
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const { addToHistory } = useMediaStore();

  // Criar player
  const player = useVideoPlayer(url || '', (p) => {
    p.loop = false;
    p.play();
  });

  // Status do player
  const { status } = useEvent(player, 'statusChange', { status: player.status });

  useEffect(() => {
    if (status === 'readyToPlay') {
      setIsLoading(false);
      setError(null);
      if (player.duration) {
        setDuration(player.duration);
      }
    } else if (status === 'error') {
      setIsLoading(false);
      setError('Erro ao reproduzir. Tente novamente.');
    }
  }, [status, player.duration]);

  // Atualizar progresso periodicamente
  useEffect(() => {
    progressInterval.current = setInterval(() => {
      if (player.currentTime !== undefined) {
        setCurrentTime(player.currentTime);
        if (player.duration && player.duration > 0) {
          setDuration(player.duration);
        }
      }
    }, 500);
    
    return () => {
      if (progressInterval.current) {
        clearInterval(progressInterval.current);
      }
    };
  }, [player]);

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

  const handleClose = useCallback(() => {
    player.pause();
    if (id) addToHistory(id);
    router.back();
  }, [player, id, router, addToHistory]);

  const togglePlayPause = useCallback(() => {
    if (player.playing) {
      player.pause();
      setIsPlaying(false);
    } else {
      player.play();
      setIsPlaying(true);
    }
    resetHideTimer();
  }, [player, resetHideTimer]);

  // Skip forward/backward
  const handleSkipForward = useCallback(() => {
    const newTime = Math.min(currentTime + 10, duration);
    player.currentTime = newTime;
    setCurrentTime(newTime);
    resetHideTimer();
  }, [currentTime, duration, player, resetHideTimer]);

  const handleSkipBackward = useCallback(() => {
    const newTime = Math.max(currentTime - 10, 0);
    player.currentTime = newTime;
    setCurrentTime(newTime);
    resetHideTimer();
  }, [currentTime, player, resetHideTimer]);

  // Seek by tapping on progress bar
  const handleSeekPress = useCallback((event: any) => {
    const { locationX } = event.nativeEvent;
    const barWidth = Dimensions.get('window').width - Spacing.lg * 2;
    const percent = Math.max(0, Math.min(1, locationX / barWidth));
    const newTime = percent * duration;
    player.currentTime = newTime;
    setCurrentTime(newTime);
    resetHideTimer();
  }, [duration, player, resetHideTimer]);

  const handleRetry = useCallback(() => {
    setError(null);
    setIsLoading(true);
    player.play();
  }, [player]);

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
      
      {/* Video */}
      <TouchableOpacity 
        style={styles.videoContainer}
        activeOpacity={1}
        onPress={handleScreenPress}
      >
        <VideoView
          player={player}
          style={styles.video}
          contentFit="contain"
          nativeControls={false}
        />
      </TouchableOpacity>
      
      {/* Loading overlay */}
      {isLoading && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Carregando...</Text>
        </View>
      )}
      
      {/* Error overlay */}
      {error && (
        <View style={styles.overlay}>
          <Ionicons name="alert-circle-outline" size={64} color={Colors.error} />
          <Text style={styles.errorText}>{error}</Text>
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
            <View style={{ width: 40 }} />
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
});
