import React, { memo } from 'react';
import { 
  View, 
  ScrollView, 
  StyleSheet, 
  Text,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { Channel } from '../types';
import { Colors, Spacing } from '../constants/Colors';
import ChannelCard from './ChannelCard';

interface ChannelListProps {
  channels: Channel[];
}

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - Spacing.lg * 3) / 2;

// Lista simples sem virtualização - todos os canais carregam de uma vez
const ChannelList = memo(({ channels }: ChannelListProps) => {
  if (channels.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="tv-outline" size={64} color={Colors.textSecondary} />
        <Text style={styles.emptyText}>Nenhum canal encontrado</Text>
      </View>
    );
  }

  // Divide canais em pares para layout de 2 colunas
  const rows: Channel[][] = [];
  for (let i = 0; i < channels.length; i += 2) {
    rows.push(channels.slice(i, i + 2));
  }

  return (
    <ScrollView 
      style={styles.scrollView}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
    >
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.row}>
          {row.map((channel) => (
            <ChannelCard key={channel.id} channel={channel} />
          ))}
          {/* Placeholder para manter layout quando há apenas 1 item na row */}
          {row.length === 1 && <View style={{ width: CARD_WIDTH }} />}
        </View>
      ))}
    </ScrollView>
  );
});

ChannelList.displayName = 'ChannelList';

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    padding: Spacing.lg,
    paddingBottom: 120,
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
