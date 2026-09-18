import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { Colors } from '../../constants/Colors';
import { useChannelStore } from '../../stores/channelStore';
import VideoPlayer from '../../components/VideoPlayer';
import type { Channel } from '../../types';

export default function PlayerScreen() {
  const params = useLocalSearchParams<{
    id: string;
    url?: string;
    name?: string;
    category?: string;
    logo?: string;
    channelNumber?: string;
  }>();
  const channels = useChannelStore(state => state.channels);

  const channel = useMemo<Channel | null>(() => {
    // A lista Git já foi registrada aqui com DRM, headers e fontes reserva.
    const remote = channels.find(ch => ch.id === params.id);
    if (remote) return remote;
    // Last resort: params only (no DRM info)
    if (params.url && params.name && params.category) {
      const num = params.channelNumber ? Number(params.channelNumber) : undefined;
      return {
        id: params.id,
        url: params.url,
        name: params.name,
        category: params.category,
        logo: params.logo ?? '',
        channelNumber: Number.isFinite(num) ? num : undefined,
      };
    }
    return null;
  }, [params.id, params.url, params.name, params.category, params.logo, params.channelNumber, channels]);

  if (!channel) {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      <VideoPlayer channel={channel} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
});
