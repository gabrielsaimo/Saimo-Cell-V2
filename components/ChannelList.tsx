import React, { memo, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Text,
  Dimensions,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';

import type { Channel } from '../types';
import { Colors, Spacing } from '../constants/Colors';
import ChannelCard from './ChannelCard';

interface ChannelListProps {
  channels: Channel[];
}

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - Spacing.lg * 3) / 2;

const ChannelList = memo(({ channels }: ChannelListProps) => {
  // Divide canais em pares para layout de 2 colunas
  const rows = useMemo(() => {
    const result: Channel[][] = [];
    for (let i = 0; i < channels.length; i += 2) {
      result.push(channels.slice(i, i + 2));
    }
    return result;
  }, [channels]);

  const renderRow = useCallback(({ item: row }: { item: Channel[] }) => (
    <View style={styles.row}>
      {row.map((channel) => (
        <ChannelCard key={channel.id} channel={channel} />
      ))}
      {row.length === 1 && <View style={{ width: CARD_WIDTH }} />}
    </View>
  ), []);

  if (channels.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="tv-outline" size={64} color={Colors.textSecondary} />
        <Text style={styles.emptyText}>Nenhum canal encontrado</Text>
      </View>
    );
  }

  return (
    <View style={styles.listContainer}>
      <FlashList
        data={rows}
        renderItem={renderRow}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        keyExtractor={(item) => item[0].id}
        removeClippedSubviews={Platform.OS === 'android'}
        maintainVisibleContentPosition={{
          autoscrollToTopThreshold: 10,
        }}
      />
    </View>
  );
});

ChannelList.displayName = 'ChannelList';

const styles = StyleSheet.create({
  listContainer: {
    flex: 1,
    minHeight: 200,
  },
  contentContainer: {
    padding: Spacing.lg,
    paddingBottom: 120, // Repassado via FlashList contentContainer
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: Spacing.xxxl * 2,
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 16,
    marginTop: Spacing.md,
  },
});

export default ChannelList;
