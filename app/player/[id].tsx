import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { Colors } from '../../constants/Colors';
import { getChannelById } from '../../data/channels';
import VideoPlayer from '../../components/VideoPlayer';

export default function PlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const channel = getChannelById(id);

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
