import React, { useEffect, useState, useMemo } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView,
  StatusBar,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Colors, Typography, Spacing, BorderRadius } from '../../constants/Colors';
import { getFilmography } from '../../services/apiService';
import type { MediaItem, CastMember } from '../../types';
import MediaCard from '../../components/MediaCard';

const { width } = Dimensions.get('window');

const COLUMNS = 3;
const GRID_GAP = Spacing.sm;
// Card width: fits 3 cards per row accounting for section padding + gap + MediaCard marginRight
const FILM_CARD_WIDTH = Math.floor(
  (width - Spacing.lg * 2 - GRID_GAP * (COLUMNS - 1) - Spacing.sm * COLUMNS) / COLUMNS
);

export default function ActorScreen() {
  const { id, name, photo } = useLocalSearchParams<{ id: string; name: string; photo?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  
  const [loading, setLoading] = useState(true);
  const [actor, setActor] = useState<CastMember | null>(null);
  const [filmography, setFilmography] = useState<MediaItem[]>([]);

  useEffect(() => {
    async function load() {
      if (!name) { setLoading(false); return; }

      try {
        const actorId = parseInt(id, 10);
        const result = await getFilmography({
          p_actor_id: actorId || undefined,
          p_actor: actorId ? undefined : (name as string),
        });
        // Deduplicate: by ID first, then by normalized title
        const seen = new Set<string>();
        const seenTitles = new Set<string>();
        const unique = result.items.filter(item => {
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          const title = (item.tmdb?.title || item.name).trim().toLowerCase();
          if (seenTitles.has(title)) return false;
          seenTitles.add(title);
          return true;
        });
        setFilmography(unique);
        setActor({ id: actorId || 0, name: name as string, character: '', photo: (photo as string) || null });
      } catch {
        // silently fail — empty filmography
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id, name]);

  const handleBack = () => router.back();

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
      
      <ScrollView 
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <Ionicons name="arrow-back" size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Ator</Text>
          <View style={{ width: 40 }} />
        </View>
        
        {/* Actor Profile */}
        <View style={styles.profile}>
          <Image
            source={{ uri: actor?.photo || '' }}
            style={styles.photo}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
          <Text style={styles.actorName}>{actor?.name || name || 'Ator'}</Text>
          <Text style={styles.filmCount}>
            {filmography.length} título{filmography.length !== 1 ? 's' : ''} no catálogo
          </Text>
        </View>
        
        {/* Filmography */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Filmografia</Text>
          <View style={styles.grid}>
            {filmography.map((item) => (
              <MediaCard key={item.id} item={item} cardWidth={FILM_CARD_WIDTH} />
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  scroll: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  backButton: {
    padding: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.full,
  },
  headerTitle: {
    color: Colors.text,
    fontSize: Typography.h3.fontSize,
    fontWeight: '600',
  },
  profile: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
  },
  photo: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: Colors.surface,
  },
  actorName: {
    color: Colors.text,
    fontSize: Typography.h2.fontSize,
    fontWeight: '700',
    marginTop: Spacing.md,
    textAlign: 'center',
  },
  filmCount: {
    color: Colors.textSecondary,
    fontSize: Typography.body.fontSize,
    marginTop: Spacing.xs,
  },
  section: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: Typography.h3.fontSize,
    fontWeight: '700',
    marginBottom: Spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
});
