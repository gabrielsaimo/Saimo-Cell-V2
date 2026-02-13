import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView,
  StatusBar,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  FlatList,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Colors, Typography, Spacing, BorderRadius } from '../../constants/Colors';
import { getMediaById } from '../../services/mediaService';
import { useMediaStore } from '../../stores/mediaStore';
import type { MediaItem, CastMember } from '../../types';

const { width, height } = Dimensions.get('window');

// Cor da classificação
const getCertColor = (cert?: string) => {
  if (!cert) return Colors.textSecondary;
  const c = cert.toUpperCase();
  if (c === 'L') return '#10B981';
  if (c === '10') return '#3B82F6';
  if (c === '12') return '#F59E0B';
  if (c === '14') return '#F97316';
  if (c === '16' || c === '18') return '#EF4444';
  return Colors.textSecondary;
};

export default function MediaDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  
  const [media, setMedia] = useState<MediaItem | null>(null);
  const [loading, setLoading] = useState(true);
  
  const { isFavorite, addFavorite, removeFavorite, addToHistory } = useMediaStore();
  const [favorite, setFavorite] = useState(false);

  const params = useLocalSearchParams();

  useEffect(() => {
    let isMounted = true;

    async function load() {
      if (!id) return;
      setLoading(true);
      
      let item = await getMediaById(id);

      // Fallback: Construct partial item from params if not found in catalog
      if (!item && params.title) {
        item = {
            id: id,
            name: params.title as string,
            url: '', // No URL available yet
            category: '',
            isAdult: false,
            type: 'movie',
            tmdb: {
                id: 0,
                title: params.title as string,
                poster: params.poster as string,
                backdrop: params.backdrop as string,
                overview: params.overview as string,
                year: params.year as string,
                rating: params.rating ? parseFloat(params.rating as string) : 0,
                genres: params.genres ? (params.genres as string).split(',') : [],
                cast: [],
            }
        };
      }

      if (isMounted) {
        setMedia(item);
        setFavorite(isFavorite(id));
        setLoading(false); // Show content immediately
      }
    }
    load();

    return () => {
        isMounted = false;
    };
  }, [id, isFavorite, params]);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handlePlay = useCallback(() => {
    if (!media) return;
    addToHistory(media.id);
    router.push({
      pathname: '/media-player/[id]' as any,
      params: { id: media.id, url: encodeURIComponent(media.url), title: media.tmdb?.title || media.name }
    });
  }, [media, router, addToHistory]);

  const handleFavorite = useCallback(() => {
    if (!media) return;
    if (favorite) {
      removeFavorite(media.id);
    } else {
      addFavorite(media.id);
    }
    setFavorite(!favorite);
  }, [media, favorite, addFavorite, removeFavorite]);

  const handleActorPress = useCallback((actor: CastMember) => {
    router.push({
      pathname: '/actor/[id]',
      params: { id: actor.id.toString(), name: actor.name }
    });
  }, [router]);

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!media) {
    return (
      <View style={[styles.container, styles.center]}>
        <Ionicons name="film-outline" size={64} color={Colors.textSecondary} />
        <Text style={styles.errorText}>Conteúdo não encontrado</Text>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <Text style={styles.backButtonText}>Voltar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const tmdb = media.tmdb;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      
      <ScrollView 
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* Hero Section */}
        <View style={styles.hero}>
          <Image
            source={{ uri: tmdb?.backdrop || tmdb?.poster || '' }}
            style={styles.backdrop}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.3)', Colors.background]}
            style={styles.heroGradient}
          />
          
          {/* Back Button */}
          <TouchableOpacity 
            style={[styles.headerButton, { top: insets.top + 10, left: Spacing.lg }]}
            onPress={handleBack}
          >
            <Ionicons name="arrow-back" size={24} color={Colors.text} />
          </TouchableOpacity>
          
          {/* Poster + Info */}
          <View style={[styles.heroContent, { bottom: 0 }]}>
            <Image
              source={{ uri: tmdb?.poster || '' }}
              style={styles.poster}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
            <View style={styles.heroInfo}>
              <Text style={styles.title} numberOfLines={2}>
                {tmdb?.title || media.name}
              </Text>
              
              {/* Meta badges */}
              <View style={styles.badges}>
                {tmdb?.year && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{tmdb.year}</Text>
                  </View>
                )}
                {tmdb?.runtime && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{tmdb.runtime} min</Text>
                  </View>
                )}
                {tmdb?.certification && (
                  <View style={[styles.badge, { borderColor: getCertColor(tmdb.certification) }]}>
                    <Text style={[styles.badgeText, { color: getCertColor(tmdb.certification) }]}>
                      {tmdb.certification}
                    </Text>
                  </View>
                )}
                {tmdb?.rating && (
                  <View style={[styles.badge, styles.ratingBadge]}>
                    <Ionicons name="star" size={12} color="#FFD700" />
                    <Text style={[styles.badgeText, { color: '#FFD700' }]}>
                      {tmdb.rating.toFixed(1)}
                    </Text>
                  </View>
                )}
              </View>
              
              {/* Type */}
              <View style={styles.typeRow}>
                <Ionicons 
                  name={media.type === 'movie' ? 'film' : 'tv'} 
                  size={14} 
                  color={Colors.textSecondary} 
                />
                <Text style={styles.typeText}>
                  {media.type === 'movie' ? 'Filme' : 'Série'}
                </Text>
              </View>
            </View>
          </View>
        </View>
        
        {/* Action Buttons */}
        <View style={styles.actions}>
          <TouchableOpacity 
            style={[styles.playButton, !media.url && styles.playButtonDisabled]} 
            onPress={handlePlay}
            disabled={!media.url}
          >
            <Ionicons name={media.url ? "play" : "alert-circle"} size={24} color={media.url ? "#000" : Colors.textSecondary} />
            <Text style={[styles.playText, !media.url && styles.playTextDisabled]}>
                {media.url ? 'Assistir' : 'Indisponível'}
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.iconButton, favorite && styles.iconButtonActive]}
            onPress={handleFavorite}
          >
            <Ionicons 
              name={favorite ? 'heart' : 'heart-outline'} 
              size={24} 
              color={favorite ? '#FF4757' : Colors.text} 
            />
          </TouchableOpacity>
        </View>
        
        {/* Genres */}
        {tmdb?.genres && tmdb.genres.length > 0 && (
          <View style={styles.genres}>
            {tmdb.genres.map((genre, i) => (
              <View key={i} style={styles.genreChip}>
                <Text style={styles.genreText}>{genre}</Text>
              </View>
            ))}
          </View>
        )}
        
        {/* Overview */}
        {tmdb?.overview && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Sinopse</Text>
            <Text style={styles.overview}>{tmdb.overview}</Text>
            
            {/* Extra Info */}
            <View style={styles.metaInfo}>
              {tmdb.director && (
                <Text style={styles.metaText}>
                  <Text style={styles.metaLabel}>Direção: </Text>{tmdb.director}
                </Text>
              )}
              {tmdb.writer && (
                <Text style={styles.metaText}>
                  <Text style={styles.metaLabel}>Roteiro: </Text>{tmdb.writer}
                </Text>
              )}
              {tmdb.productionCompany && (
                <Text style={styles.metaText}>
                  <Text style={styles.metaLabel}>Produção: </Text>{tmdb.productionCompany}
                </Text>
              )}
            </View>
          </View>
        )}
        
        {/* Cast */}
        {tmdb?.cast && tmdb.cast.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Elenco</Text>
            <FlatList
              data={tmdb.cast}
              keyExtractor={(item) => item.id.toString()}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: Spacing.lg }}
              renderItem={({ item: actor }) => (
                <TouchableOpacity 
                  style={styles.castCard}
                  onPress={() => handleActorPress(actor)}
                >
                  <Image
                    source={{ uri: actor.photo || '' }}
                    style={styles.castPhoto}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                  <Text style={styles.castName} numberOfLines={1}>{actor.name}</Text>
                  <Text style={styles.castCharacter} numberOfLines={1}>{actor.character}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        )}


        
        {/* Bottom padding */}
        <View style={{ height: insets.bottom + 40 }} />
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
  hero: {
    height: height * 0.5,
    position: 'relative',
  },
  backdrop: {
    width: '100%',
    height: '100%',
  },
  heroGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  headerButton: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: Spacing.sm,
    borderRadius: BorderRadius.full,
    zIndex: 10,
  },
  heroContent: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    flexDirection: 'row',
    gap: Spacing.md,
    alignItems: 'flex-end',
    paddingBottom: Spacing.lg,
  },
  poster: {
    width: 100,
    height: 150,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
  },
  heroInfo: {
    flex: 1,
    paddingBottom: Spacing.xs,
  },
  title: {
    color: Colors.text,
    fontSize: Typography.h2.fontSize,
    fontWeight: '700',
    lineHeight: 28,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
  },
  badge: {
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: BorderRadius.sm,
  },
  badgeText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderColor: '#FFD700',
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: Spacing.sm,
  },
  typeText: {
    color: Colors.textSecondary,
    fontSize: Typography.caption.fontSize,
  },
  actions: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  playButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
  },
  playText: {
    color: '#000',
    fontSize: Typography.body.fontSize,
    fontWeight: '700',
  },
  iconButton: {
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  iconButtonActive: {
    backgroundColor: 'rgba(255,71,87,0.2)',
  },
  genres: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  genreChip: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
  },
  genreText: {
    color: Colors.textSecondary,
    fontSize: 12,
  },
  section: {
    marginTop: Spacing.lg,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: Typography.h3.fontSize,
    fontWeight: '700',
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  overview: {
    color: Colors.textSecondary,
    fontSize: Typography.body.fontSize,
    lineHeight: 22,
    paddingHorizontal: Spacing.lg,
  },
  castCard: {
    width: 80,
    marginRight: Spacing.md,
    alignItems: 'center',
  },
  castPhoto: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: Colors.surface,
  },
  castName: {
    color: Colors.text,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
  castCharacter: {
    color: Colors.textSecondary,
    fontSize: 10,
    textAlign: 'center',
  },
  errorText: {
    color: Colors.textSecondary,
    fontSize: Typography.body.fontSize,
    marginTop: Spacing.md,
  },
  backButton: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
  },
  backButtonText: {
    color: '#000',
    fontWeight: '600',
  },
  metaInfo: {
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
    gap: 4,
  },
  metaText: {
    color: Colors.textSecondary,
    fontSize: Typography.caption.fontSize,
  },
  playButtonDisabled: {
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  playTextDisabled: {
    color: Colors.textSecondary,
  },
  metaLabel: {
    color: Colors.text,
    fontWeight: '600',
  },
});
