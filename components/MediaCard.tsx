import React, { memo, useCallback, useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import type { MediaItem } from '../types';
import { Colors, BorderRadius, Spacing, Typography } from '../constants/Colors';
import { useMediaStore } from '../stores/mediaStore';

interface MediaCardProps {
  item: MediaItem & { episodes?: any };
  size?: 'small' | 'medium' | 'large';
}

const { width } = Dimensions.get('window');

const SIZES = {
  small: { width: width * 0.28, height: width * 0.28 * 1.5 },
  medium: { width: width * 0.35, height: width * 0.35 * 1.5 },
  large: { width: width * 0.42, height: width * 0.42 * 1.5 },
};

// Cor da classificação indicativa
const getCertificationColor = (cert?: string) => {
  if (!cert) return Colors.textSecondary;
  const c = cert.toUpperCase();
  if (c === 'L' || c === 'LIVRE') return '#10B981'; // Verde
  if (c === '10') return '#3B82F6'; // Azul
  if (c === '12') return '#F59E0B'; // Amarelo
  if (c === '14') return '#F97316'; // Laranja
  if (c === '16' || c === '18') return '#EF4444'; // Vermelho
  return Colors.textSecondary;
};

// Cor da nota
const getRatingColor = (rating?: number) => {
  if (!rating) return Colors.textSecondary;
  if (rating >= 7) return '#FFD700'; // Dourado
  if (rating >= 5) return '#F59E0B'; // Amarelo
  return '#EF4444'; // Vermelho
};

const MediaCard = memo(({ item, size = 'medium' }: MediaCardProps) => {
  const router = useRouter();
  const { isFavorite, addFavorite, removeFavorite } = useMediaStore();
  const [favorite, setFavorite] = useState(isFavorite(item.id));
  
  const dimensions = SIZES[size];
  const tmdb = item.tmdb;

  // Verificar se é série (tem episódios)
  const hasSeries = item.episodes && Object.keys(item.episodes).length > 0;

  const handlePress = useCallback(() => {
    if (hasSeries) {
      // Série com episódios -> tela de série
      router.push({
        pathname: '/series/[id]' as any,
        params: { id: item.id }
      });
    } else {
      // Filme ou conteúdo simples -> tela de mídia
      router.push({
        pathname: '/media/[id]',
        params: { 
            id: item.id,
            title: item.tmdb?.title || item.name,
            poster: item.tmdb?.poster,
            backdrop: item.tmdb?.backdrop,
            overview: item.tmdb?.overview,
            year: item.tmdb?.year,
            rating: item.tmdb?.rating?.toString(),
            genres: item.tmdb?.genres?.join(','),
        }
      });
    }
  }, [item.id, router, hasSeries]);

  const handleFavorite = useCallback((e: any) => {
    e.stopPropagation();
    if (favorite) {
      removeFavorite(item.id);
    } else {
      addFavorite(item.id);
    }
    setFavorite(!favorite);
  }, [item.id, favorite, addFavorite, removeFavorite]);

  return (
    <TouchableOpacity
      style={[styles.container, { width: dimensions.width, height: dimensions.height }]}
      onPress={handlePress}
      activeOpacity={0.8}
    >
      {/* Poster */}
      <Image
        source={{ uri: tmdb?.poster || '' }}
        style={styles.poster}
        contentFit="cover"
        transition={200}
        cachePolicy="memory-disk"
        recyclingKey={tmdb?.poster || item.url}
      />
      
      {/* Gradient overlay */}
      <LinearGradient
        colors={['transparent', 'transparent', 'rgba(0,0,0,0.9)']}
        style={styles.gradient}
      />
      
      {/* Rating Badge */}
      {(tmdb?.rating || 0) > 0 && (
        <View style={[styles.ratingBadge, { backgroundColor: getRatingColor(tmdb.rating!) }]}>
          <Ionicons name="star" size={10} color="#000" />
          <Text style={styles.ratingText}>{tmdb.rating!.toFixed(1)}</Text>
        </View>
      )}
      
      {/* Certification Badge */}
      {tmdb?.certification && (
        <View style={[styles.certBadge, { borderColor: getCertificationColor(tmdb?.certification) }]}>
          <Text style={[styles.certText, { color: getCertificationColor(tmdb?.certification) }]}>
            {tmdb?.certification}
          </Text>
        </View>
      )}
      
      {/* Favorite Button */}
      <TouchableOpacity 
        style={[styles.favoriteButton, favorite && styles.favoriteActive]}
        onPress={handleFavorite}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons 
          name={favorite ? 'heart' : 'heart-outline'} 
          size={18} 
          color={favorite ? '#FF4757' : 'white'} 
        />
      </TouchableOpacity>
      
      {/* Type Badge (Movie/TV) */}
      <View style={styles.typeBadge}>
        <Ionicons 
          name={item.type === 'movie' ? 'film-outline' : 'tv-outline'} 
          size={12} 
          color="white" 
        />
      </View>
      
      {/* Title */}
      <View style={styles.titleContainer}>
        <Text style={styles.title} numberOfLines={2}>
          {tmdb?.title || item.name || 'Sem título'}
        </Text>
        {tmdb?.year && typeof tmdb.year === 'string' && tmdb.year.length > 0 && (
          <Text style={styles.year}>{tmdb.year}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}, (prev, next) => prev.item.id === next.item.id);

MediaCard.displayName = 'MediaCard';

const styles = StyleSheet.create({
  container: {
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.surface,
    marginRight: Spacing.sm,
  },
  poster: {
    width: '100%',
    height: '100%',
    backgroundColor: Colors.surface,
  },
  gradient: {
    ...StyleSheet.absoluteFillObject,
  },
  ratingBadge: {
    position: 'absolute',
    top: Spacing.sm,
    left: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: BorderRadius.sm,
    gap: 2,
  },
  ratingText: {
    color: '#000',
    fontSize: 11,
    fontWeight: '700',
  },
  certBadge: {
    position: 'absolute',
    bottom: 52,
    right: Spacing.sm,
    borderWidth: 1.5,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    backgroundColor: 'rgba(0,0,0,0.6)',
    zIndex: 2,
  },
  certText: {
    fontSize: 10,
    fontWeight: '700',
  },
  favoriteButton: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 6,
    borderRadius: BorderRadius.full,
    zIndex: 3,
  },
  favoriteActive: {
    backgroundColor: 'rgba(255,71,87,0.3)',
  },
  typeBadge: {
    position: 'absolute',
    bottom: 52,
    left: Spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 4,
    borderRadius: BorderRadius.sm,
    zIndex: 2,
  },
  titleContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: Spacing.sm,
  },
  title: {
    color: Colors.text,
    fontSize: Typography.caption.fontSize,
    fontWeight: '600',
    lineHeight: 16,
  },
  year: {
    color: Colors.textSecondary,
    fontSize: 10,
    marginTop: 2,
  },
});

export default MediaCard;
