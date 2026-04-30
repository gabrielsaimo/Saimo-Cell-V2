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
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRemoteMediaClient } from 'react-native-google-cast';

import { Colors, Typography, Spacing, BorderRadius } from '../../constants/Colors';
import { getItemAPI } from '../../services/apiService';
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
  const castClient = useRemoteMediaClient();
  const [favorite, setFavorite] = useState(false);
  const [overviewExpanded, setOverviewExpanded] = useState(false);

  // Carregar série
  useEffect(() => {
    async function load() {
      if (!id) return;
      try {
        const item = await getItemAPI(id);
        setSeries(item as any);
        setFavorite(isFavorite(id));
        const progress = getSeriesProgress(id);
        if (progress) setSelectedSeason(progress.season.toString());
      } catch (e) {
        console.warn('[SeriesDetail] Erro ao carregar:', id, e);
      } finally {
        setLoading(false);
      }
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const isFav = isFavorite(id as string);
  useEffect(() => {
    setFavorite(isFav);
  }, [isFav]);

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

    // Descobre o próximo episódio (mesmo season ou próximo season)
    const seasonEps = series.episodes[season] || [];
    const currentIndex = seasonEps.findIndex(e => e.id === ep.id);
    let nextEp: Episode | null = null;
    let nextSeason = season;

    if (currentIndex >= 0 && currentIndex < seasonEps.length - 1) {
      nextEp = seasonEps[currentIndex + 1];
    } else {
      // Tenta avançar para próxima temporada
      const seasonNums = Object.keys(series.episodes).sort((a, b) => parseInt(a) - parseInt(b));
      const seasonIdx = seasonNums.indexOf(season);
      if (seasonIdx >= 0 && seasonIdx < seasonNums.length - 1) {
        nextSeason = seasonNums[seasonIdx + 1];
        const nextSeasonEps = series.episodes[nextSeason] || [];
        if (nextSeasonEps.length > 0) nextEp = nextSeasonEps[0];
      }
    }

    router.push({
      pathname: '/media-player/[id]' as any,
      params: {
        id: ep.id,
        url: encodeURIComponent(ep.url),
        title: `${series.name} - T${season} E${ep.episode}`,
        seriesId: series.id,
        season,
        ...(nextEp && {
          nextId: nextEp.id,
          nextUrl: encodeURIComponent(nextEp.url),
          nextTitle: `${series.name} - T${nextSeason} E${nextEp.episode}`,
          nextSeason,
          nextEpisode: String(nextEp.episode),
        }),
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

  const handleCastEpisode = useCallback((ep: Episode, season: string) => {
    if (!series) return;
    if (!castClient) {
      Alert.alert('Google Cast', 'Nenhum dispositivo Cast conectado. Conecte um Chromecast antes de transmitir.');
      return;
    }
    castClient.loadMedia({
      mediaInfo: {
        contentUrl: ep.url,
        metadata: {
          type: 'tvShow',
          title: `${series.name} - T${season} E${ep.episode}${ep.name ? ` · ${ep.name}` : ''}`,
          images: series.tmdb?.poster ? [{ url: series.tmdb.poster }] : [],
        },
      },
      autoplay: true,
    });
  }, [series, castClient]);

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

          {castClient && (
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => {
                const ep = progress
                  ? series.episodes[progress.season.toString()]?.find(e => e.episode === progress.episode)
                  : episodes[0];
                const s = progress ? progress.season.toString() : selectedSeason;
                if (ep) handleCastEpisode(ep, s);
              }}
            >
              <MaterialIcons name="cast" size={24} color={Colors.text} />
            </TouchableOpacity>
          )}
        </View>
        
        {/* Sinopse */}
        {tmdb?.overview && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Sinopse</Text>
            <Text
              style={styles.overview}
              numberOfLines={overviewExpanded ? undefined : 3}
            >
              {tmdb.overview}
            </Text>
            {tmdb.overview.length > 150 && (
              <TouchableOpacity
                onPress={() => setOverviewExpanded(v => !v)}
                style={styles.seeMoreBtn}
                activeOpacity={0.7}
              >
                <Text style={styles.seeMoreText}>
                  {overviewExpanded ? 'Ver menos' : 'Ver mais'}
                </Text>
                <Ionicons
                  name={overviewExpanded ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color={Colors.primary}
                />
              </TouchableOpacity>
            )}
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
            <View
              key={ep.id}
              style={[
                styles.episodeCard,
                progress?.episodeId === ep.id && styles.episodeCardActive
              ]}
            >
              <TouchableOpacity
                style={styles.episodeNumber}
                onPress={() => handlePlayEpisode(ep, selectedSeason)}
              >
                <Text style={styles.episodeNumberText}>{ep.episode}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.episodeInfo}
                onPress={() => handlePlayEpisode(ep, selectedSeason)}
              >
                <Text style={styles.episodeName} numberOfLines={1}>
                  {ep.name || `Episódio ${ep.episode}`}
                </Text>
                {progress?.episodeId === ep.id && (
                  <Text style={styles.episodeContinue}>Continuar assistindo</Text>
                )}
              </TouchableOpacity>
              {castClient && (
                <TouchableOpacity
                  onPress={() => handleCastEpisode(ep, selectedSeason)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <MaterialIcons name="cast" size={22} color={Colors.textSecondary} />
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => handlePlayEpisode(ep, selectedSeason)}>
                <Ionicons name="play-circle" size={32} color={Colors.primary} />
              </TouchableOpacity>
            </View>
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
  seeMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: Spacing.xs,
  },
  seeMoreText: {
    color: Colors.primary,
    fontSize: Typography.caption.fontSize,
    fontWeight: '600',
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
