import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text, Platform } from 'react-native';
import { enableLayoutAnimations } from 'react-native-reanimated';
import { Colors } from '../constants/Colors';

import Updater from '../components/Updater';

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
