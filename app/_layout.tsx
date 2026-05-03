import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text, Platform } from 'react-native';
import { enableLayoutAnimations } from 'react-native-reanimated';
import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { Colors } from '../constants/Colors';

import Updater from '../components/Updater';
import { downloadManager } from '../services/downloadManager';
import { useDownloadStore } from '../stores/downloadStore';
import { initNotifications } from '../services/downloadNotifications';

// Enable layout animations for 120fps transitions
enableLayoutAnimations(true);

// Correção global de texto cortado no Android (Moto G04, MediaTek e outros)
// "simple" evita que o Android use hifenização/quebra de linha mais agressiva
// que causa medição incorreta do texto e cortes no último caractere.
// allowFontScaling=false previne que o tamanho de fonte do sistema distorça layouts.
if (Platform.OS === 'android') {
  const T = Text as any;
  if (!T.defaultProps) T.defaultProps = {};
  T.defaultProps.textBreakStrategy = 'simple';
  T.defaultProps.allowFontScaling = false;
}

export default function RootLayout() {
  const router = useRouter();

  useEffect(() => {
    // Request notification permission immediately on app open (before any download)
    initNotifications().catch(() => {});

    // downloadManager.init reuses initNotifications (idempotent) + reconciles bg downloads
    downloadManager.init().catch((e) => console.warn('[Layout] downloadManager.init error:', e));

    // Tap notification → open content
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as any;
      if (!data) return;

      if (data.type === 'completed' && data.taskId) {
        const item = useDownloadStore.getState().getItem(data.taskId);
        if (item) {
          router.push({
            pathname: '/media-player/[id]' as any,
            params: {
              id: item.id,
              url: encodeURIComponent(item.localPath),
              title: item.title,
              offline: '1',
            },
          });
          return;
        }
      }
      if (data.type === 'progress') {
        // Tapping the ongoing progress notification should NOT do anything 
        // (the user specifically requested it to not interfere/open).
        return;
      }

      // Default: open downloads tab
      router.push('/(tabs)/downloads' as any);
    });

    return () => sub.remove();
  }, [router]);

  return (
    <SafeAreaProvider>
      <Updater />
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: {
            backgroundColor: Colors.background,
          },
          animation: Platform.select({
            android: 'fade_from_bottom',
            ios: 'slide_from_right',
          }),
          presentation: 'card',
          gestureEnabled: true,
          gestureDirection: 'horizontal',
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen 
          name="player/[id]" 
          options={{
            animation: 'fade',
            presentation: 'fullScreenModal',
          }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}
