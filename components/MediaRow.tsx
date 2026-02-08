import React, { memo } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  FlatList,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import type { MediaItem } from '../types';
import { Colors, Spacing, Typography } from '../constants/Colors';
import MediaCard from './MediaCard';

interface MediaRowProps {
  title: string;
  categoryId: string;
  items: MediaItem[];
  onSeeAll?: () => void;
}

const MediaRow = memo(({ title, categoryId, items, onSeeAll }: MediaRowProps) => {
  const router = useRouter();

  if (items.length === 0) return null;

  const handleSeeAll = () => {
    if (onSeeAll) {
      onSeeAll();
    } else {
      router.push({
        pathname: '/category/[id]' as any,
        params: { id: categoryId, name: title }
      });
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <TouchableOpacity style={styles.seeAllButton} onPress={handleSeeAll}>
          <Text style={styles.seeAllText}>Ver tudo</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.primary} />
        </TouchableOpacity>
      </View>
      
      {/* Horizontal List */}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <MediaCard item={item} size="medium" />
        )}
        initialNumToRender={5}
        maxToRenderPerBatch={5}
        windowSize={3}
        removeClippedSubviews
      />
    </View>
  );
}, (prev, next) => {
  return prev.categoryId === next.categoryId && 
         prev.items.length === next.items.length;
});

MediaRow.displayName = 'MediaRow';

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.xl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  title: {
    color: Colors.text,
    fontSize: Typography.h3.fontSize,
    fontWeight: '700',
  },
  seeAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  seeAllText: {
    color: Colors.primary,
    fontSize: Typography.caption.fontSize,
    fontWeight: '600',
  },
  list: {
    paddingHorizontal: Spacing.lg,
  },
});

export default MediaRow;
