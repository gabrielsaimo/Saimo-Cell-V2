import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { Colors } from '../../constants/Colors';
import { getChannelById } from '../../data/channels';
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
  const proChannels = useChannelStore(state => state.proChannels);

  const channel = useMemo<Channel | null>(() => {
    // Always prefer local data (has DRM, headers, streams)
    const local = getChannelById(params.id);
    if (local) return local;
    // Pro channel not in local data — build from params
    const pro = proChannels.find(ch => ch.id === params.id);
    if (pro) return pro;
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
  }, [params.id, params.url, params.name, params.category, params.logo, params.channelNumber, proChannels]);

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
