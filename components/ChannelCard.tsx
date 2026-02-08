import React, { memo, useCallback, useState, useEffect, useRef } from 'react';
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

import type { Channel, CurrentProgram } from '../types';
import { Colors, BorderRadius, Spacing, Typography, Shadows } from '../constants/Colors';
import { useFavoritesStore } from '../stores/favoritesStore';
import { useSettingsStore } from '../stores/settingsStore';
import { getCurrentProgram } from '../services/epgService';

interface ChannelCardProps {
  channel: Channel;
}

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - Spacing.lg * 3) / 2;

const ChannelCard = memo(({ channel }: ChannelCardProps) => {
  const router = useRouter();
  const { toggleFavorite, isFavorite } = useFavoritesStore();
  const showEPG = useSettingsStore(state => state.showEPG);
  const showChannelNumber = useSettingsStore(state => state.showChannelNumber);
  
  const [favorite, setFavorite] = useState(isFavorite(channel.id));
  const [currentEPG, setCurrentEPG] = useState<CurrentProgram | null>(null);
  const isMountedRef = useRef(true);

  // Carrega EPG do cache (SEM bloquear, SEM fetch)
  useEffect(() => {
    isMountedRef.current = true;
    
    if (showEPG) {
      // Apenas lê do cache, nunca faz fetch aqui
      const epg = getCurrentProgram(channel.id);
      setCurrentEPG(epg);
    }

    // Atualiza do cache a cada 60 segundos
    const interval = setInterval(() => {
      if (isMountedRef.current && showEPG) {
        setCurrentEPG(getCurrentProgram(channel.id));
      }
    }, 60000);

    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [channel.id, showEPG]);

  // Sincroniza estado de favorito
  useEffect(() => {
    setFavorite(isFavorite(channel.id));
  }, [isFavorite, channel.id]);

  const handlePress = useCallback(() => {
    // Navegação imediata
    router.push({
      pathname: '/player/[id]',
      params: { id: channel.id }
    });
  }, [channel.id, router]);

  const handleFavorite = useCallback(() => {
    toggleFavorite(channel.id);
    setFavorite(prev => !prev);
  }, [channel.id, toggleFavorite]);

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <View style={styles.imageContainer}>
        {channel.logo ? (
          <Image
            source={{ uri: channel.logo }}
            style={styles.logo}
            contentFit="contain"
            transition={200}
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={styles.placeholder}>
            <Ionicons name="tv-outline" size={32} color={Colors.textSecondary} />
            <Text style={styles.placeholderText}>{channel.name.charAt(0)}</Text>
          </View>
        )}
        
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.8)']}
          style={styles.gradient}
        />

        {/* Número do canal */}
        {showChannelNumber && channel.channelNumber && (
          <View style={styles.numberBadge}>
            <Text style={styles.numberText}>{channel.channelNumber}</Text>
          </View>
        )}

        {/* Botão favoritar */}
        <TouchableOpacity 
          style={[styles.favoriteButton, favorite && styles.favoriteButtonActive]}
          onPress={handleFavorite}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons 
            name={favorite ? 'heart' : 'heart-outline'} 
            size={22} 
            color={favorite ? '#FF4757' : Colors.text} 
          />
        </TouchableOpacity>
      </View>

      <View style={styles.info}>
        <Text style={styles.channelName} numberOfLines={1}>
          {channel.name}
        </Text>
        
        <Text style={styles.category} numberOfLines={1}>
          {channel.category}
        </Text>

        {/* EPG Info - só mostra se tiver no cache */}
        {showEPG && currentEPG?.current && (
          <View style={styles.epgContainer}>
            <View style={styles.liveIndicator}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>AO VIVO</Text>
              {typeof currentEPG.remaining === 'number' && currentEPG.remaining > 0 && (
                <Text style={styles.remainingText}>{currentEPG.remaining}min</Text>
              )}
            </View>
            <Text style={styles.programTitle} numberOfLines={1}>
              {currentEPG.current.title}
            </Text>
            <View style={styles.progressBar}>
              <View 
                style={[
                  styles.progressFill, 
                  { width: `${currentEPG.progress}%` }
                ]} 
              />
            </View>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}, (prevProps, nextProps) => {
  return prevProps.channel.id === nextProps.channel.id;
});

ChannelCard.displayName = 'ChannelCard';

const styles = StyleSheet.create({
  container: {
    width: CARD_WIDTH,
    backgroundColor: Colors.cardBg,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    ...Shadows.md,
  },
  imageContainer: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: '70%',
    height: '70%',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },
  gradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '50%',
  },
  numberBadge: {
    position: 'absolute',
    top: Spacing.sm,
    left: Spacing.sm,
    backgroundColor: Colors.overlay,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
  },
  numberText: {
    color: Colors.text,
    fontSize: 11,
    fontWeight: '600',
  },
  favoriteButton: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    backgroundColor: Colors.overlay,
    padding: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  favoriteButtonActive: {
    backgroundColor: 'rgba(255, 71, 87, 0.3)',
  },
  info: {
    padding: Spacing.md,
  },
  channelName: {
    color: Colors.text,
    fontSize: Typography.body.fontSize,
    fontWeight: '600',
    marginBottom: Spacing.xs,
  },
  category: {
    color: Colors.textSecondary,
    fontSize: Typography.caption.fontSize,
    marginBottom: Spacing.sm,
  },
  epgContainer: {
    marginTop: Spacing.xs,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.xs,
    gap: Spacing.xs,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.live,
  },
  liveText: {
    color: Colors.live,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  remainingText: {
    color: Colors.textSecondary,
    fontSize: 9,
    marginLeft: 'auto',
  },
  programTitle: {
    color: Colors.textSecondary,
    fontSize: Typography.caption.fontSize,
    marginBottom: Spacing.xs,
  },
  progressBar: {
    height: 3,
    backgroundColor: Colors.progressBg,
    borderRadius: BorderRadius.xs,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.progressFill,
    borderRadius: BorderRadius.xs,
  },
});

export default ChannelCard;
