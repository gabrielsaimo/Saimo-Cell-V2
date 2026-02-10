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
import { getSeriesById } from '../../services/mediaService';
import { useMediaStore } from '../../stores/mediaStore';
import type { SeriesItem, Episode, CastMember } from '../../types';

const { width, height } = Dimensions.get('window');

export default function SeriesDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  
  const [series, setSeries] = useState<SeriesItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSeason, setSelectedSeason] = useState<string>('1');
  
  const { isFavorite, addFavorite, removeFavorite, getSeriesProgress, setSeriesProgress } = useMediaStore();
  const [favorite, setFavorite] = useState(false);

  // Carregar série
  useEffect(() => {
    async function load() {
      if (!id) return;
      const item = await getSeriesById(id);
      setSeries(item);
      setFavorite(isFavorite(id));
      
      // Se tiver progresso, selecionar a temporada correta
      const progress = getSeriesProgress(id);
      if (progress) {
        setSelectedSeason(progress.season.toString());
      }
      
      setLoading(false);
    }
    load();
  }, [id, isFavorite, getSeriesProgress]);

  // Temporadas disponíveis
  const seasons = useMemo(() => {
    if (!series?.episodes) return [];
    return Object.keys(series.episodes).sort((a, b) => parseInt(a) - parseInt(b));
  }, [series]);

  // Episódios da temporada selecionada
  const episodes = useMemo(() => {
    if (!series?.episodes || !selectedSeason) return [];
    return series.episodes[selectedSeason] || [];
  }, [series, selectedSeason]);

  // Progresso atual
  const progress = useMemo(() => {
    if (!id) return null;
    return getSeriesProgress(id);
  }, [id, getSeriesProgress]);

  const handleBack = useCallback(() => router.back(), [router]);

  const handleFavorite = useCallback(() => {
    if (!series) return;
    if (favorite) {
      removeFavorite(series.id);
    } else {
      addFavorite(series.id);
    }
    setFavorite(!favorite);
  }, [series, favorite, addFavorite, removeFavorite]);

  const handlePlayEpisode = useCallback((ep: Episode, season: string) => {
    if (!series) return;
    setSeriesProgress(series.id, parseInt(season), ep.episode, ep.id);
    router.push({
      pathname: '/media-player/[id]' as any,
      params: {
        id: ep.id,
        url: encodeURIComponent(ep.url),
        title: `${series.name} - T${season} E${ep.episode}`
      }
    });
  }, [series, router, setSeriesProgress]);

  const handleContinue = useCallback(() => {
    if (!series || !progress) return;
    const seasonEps = series.episodes[progress.season.toString()];
    const ep = seasonEps?.find(e => e.episode === progress.episode);
    if (ep) {
      handlePlayEpisode(ep, progress.season.toString());
    }
  }, [series, progress, handlePlayEpisode]);

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

  if (!series) {
    return (
      <View style={[styles.container, styles.center]}>
        <Ionicons name="tv-outline" size={64} color={Colors.textSecondary} />
        <Text style={styles.errorText}>Série não encontrada</Text>
        <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
          <Text style={styles.backBtnText}>Voltar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const tmdb = series.tmdb;
  const logo = series.episodes?.['1']?.[0]?.logo || tmdb?.poster || '';

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
            source={{ uri: tmdb?.backdrop || logo }}
            style={styles.backdrop}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.5)', Colors.background]}
            style={styles.heroGradient}
          />
          
          {/* Back Button */}
          <TouchableOpacity 
            style={[styles.headerButton, { top: insets.top + 10 }]}
            onPress={handleBack}
          >
            <Ionicons name="arrow-back" size={24} color={Colors.text} />
          </TouchableOpacity>
          
          {/* Title + Info */}
          <View style={styles.heroContent}>
            <Image
              source={{ uri: tmdb?.poster || logo }}
              style={styles.poster}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
            <View style={styles.heroInfo}>
              <Text style={styles.title} numberOfLines={2}>
                {tmdb?.title || series.name}
              </Text>
              <View style={styles.metaRow}>
                <Text style={styles.metaText}>
                  {seasons.length} Temporada{seasons.length > 1 ? 's' : ''}
                </Text>
                {tmdb?.rating && (
                  <View style={styles.ratingBadge}>
                    <Ionicons name="star" size={12} color="#FFD700" />
                    <Text style={styles.ratingText}>{tmdb.rating.toFixed(1)}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        </View>
        
        {/* Action Buttons */}
        <View style={styles.actions}>
          {progress ? (
            <TouchableOpacity style={styles.continueButton} onPress={handleContinue}>
              <Ionicons name="play" size={24} color="#000" />
              <Text style={styles.continueText}>
                Continuar T{progress.season} E{progress.episode}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity 
              style={styles.playButton} 
              onPress={() => episodes[0] && handlePlayEpisode(episodes[0], selectedSeason)}
            >
              <Ionicons name="play" size={24} color="#000" />
              <Text style={styles.playText}>Assistir</Text>
            </TouchableOpacity>
          )}
          
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
        
        {/* Sinopse */}
        {tmdb?.overview && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Sinopse</Text>
            <Text style={styles.overview}>{tmdb.overview}</Text>
          </View>
        )}

        {/* Cast */}
        {tmdb?.cast && tmdb.cast.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Elenco</Text>
            <FlatList
              data={tmdb.cast.slice(0, 15)}
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
        
        {/* Seletor de Temporadas */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Temporadas</Text>
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.seasonsRow}
          >
            {seasons.map((s) => (
              <TouchableOpacity
                key={s}
                style={[
                  styles.seasonChip,
                  selectedSeason === s && styles.seasonChipActive
                ]}
                onPress={() => setSelectedSeason(s)}
              >
                <Text style={[
                  styles.seasonChipText,
                  selectedSeason === s && styles.seasonChipTextActive
                ]}>
                  T{s}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
        
        {/* Lista de Episódios */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Episódios ({episodes.length})
          </Text>
          {episodes.map((ep) => (
            <TouchableOpacity
              key={ep.id}
              style={[
                styles.episodeCard,
                progress?.episodeId === ep.id && styles.episodeCardActive
              ]}
              onPress={() => handlePlayEpisode(ep, selectedSeason)}
            >
              <View style={styles.episodeNumber}>
                <Text style={styles.episodeNumberText}>{ep.episode}</Text>
              </View>
              <View style={styles.episodeInfo}>
                <Text style={styles.episodeName} numberOfLines={1}>
                  {ep.name || `Episódio ${ep.episode}`}
                </Text>
                {progress?.episodeId === ep.id && (
                  <Text style={styles.episodeContinue}>Continuar assistindo</Text>
                )}
              </View>
              <Ionicons name="play-circle" size={32} color={Colors.primary} />
            </TouchableOpacity>
          ))}
        </View>
        
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
    height: height * 0.4,
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
    left: Spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: Spacing.sm,
    borderRadius: BorderRadius.full,
    zIndex: 10,
  },
  heroContent: {
    position: 'absolute',
    bottom: 0,
    left: Spacing.lg,
    right: Spacing.lg,
    flexDirection: 'row',
    gap: Spacing.md,
    alignItems: 'flex-end',
    paddingBottom: Spacing.lg,
  },
  poster: {
    width: 90,
    height: 135,
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
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.xs,
  },
  metaText: {
    color: Colors.textSecondary,
    fontSize: Typography.caption.fontSize,
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  ratingText: {
    color: '#FFD700',
    fontSize: Typography.caption.fontSize,
    fontWeight: '600',
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
  continueButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
  },
  continueText: {
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
  overview: {
    color: Colors.textSecondary,
    fontSize: Typography.body.fontSize,
    lineHeight: 22,
  },
  seasonsRow: {
    gap: Spacing.sm,
  },
  seasonChip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
  },
  seasonChipActive: {
    backgroundColor: Colors.primary,
  },
  seasonChipText: {
    color: Colors.textSecondary,
    fontWeight: '600',
    fontSize: Typography.body.fontSize,
  },
  seasonChipTextActive: {
    color: '#000',
  },
  episodeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    gap: Spacing.md,
  },
  episodeCardActive: {
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  episodeNumber: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  episodeNumberText: {
    color: Colors.text,
    fontSize: Typography.h3.fontSize,
    fontWeight: '700',
  },
  episodeInfo: {
    flex: 1,
  },
  episodeName: {
    color: Colors.text,
    fontSize: Typography.body.fontSize,
    fontWeight: '500',
  },
  episodeContinue: {
    color: Colors.primary,
    fontSize: Typography.caption.fontSize,
    marginTop: 2,
  },
  errorText: {
    color: Colors.textSecondary,
    fontSize: Typography.body.fontSize,
    marginTop: Spacing.md,
  },
  backBtn: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
  },
  backBtnText: {
    color: '#000',
    fontWeight: '600',
  },
  // Cast Styles
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
});
