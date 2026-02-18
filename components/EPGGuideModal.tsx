import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  FlatList,
  ScrollView,
  Dimensions,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';

import type { Channel, CurrentProgram } from '../types';
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../constants/Colors';
import { getCurrentProgram, onEPGUpdate } from '../services/epgService';
import { getAllChannels } from '../data/channels';

const { width, height } = Dimensions.get('window');

// ─── EPG Row ────────────────────────────────────────────────────────────────

interface EPGRowProps {
  channel: Channel;
  onPress: (channel: Channel) => void;
}

const formatTime = (date: Date) =>
  date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const EPGRow = React.memo(({ channel, onPress }: EPGRowProps) => {
  const [epg, setEpg] = useState<CurrentProgram | null>(() =>
    getCurrentProgram(channel.id)
  );

  useEffect(() => {
    setEpg(getCurrentProgram(channel.id));

    const unsub = onEPGUpdate((id) => {
      if (id === channel.id) {
        setEpg(getCurrentProgram(channel.id));
      }
    });

    const interval = setInterval(() => {
      setEpg(getCurrentProgram(channel.id));
    }, 60000);

    return () => {
      unsub();
      clearInterval(interval);
    };
  }, [channel.id]);

  return (
    <TouchableOpacity
      style={rowStyles.container}
      onPress={() => onPress(channel)}
      activeOpacity={0.7}
    >
      {/* Logo */}
      <View style={rowStyles.logoBox}>
        <Image
          source={{ uri: channel.logo }}
          style={rowStyles.logo}
          contentFit="contain"
          cachePolicy="memory-disk"
        />
      </View>

      {/* Info */}
      <View style={rowStyles.info}>
        <Text style={rowStyles.channelName} numberOfLines={1}>
          {channel.name}
        </Text>

        {epg?.current ? (
          <>
            <View style={rowStyles.titleRow}>
              <View style={rowStyles.liveBadge}>
                <View style={rowStyles.liveDot} />
                <Text style={rowStyles.liveLabel}>AO VIVO</Text>
              </View>
              <Text style={rowStyles.programTitle} numberOfLines={1}>
                {epg.current.title}
              </Text>
            </View>

            <View style={rowStyles.progressTrack}>
              <View
                style={[
                  rowStyles.progressFill,
                  { width: `${Math.round(epg.progress)}%` as any },
                ]}
              />
            </View>

            {epg.next && (
              <Text style={rowStyles.nextText} numberOfLines={1}>
                <Text style={rowStyles.nextLabel}>A seguir · </Text>
                {formatTime(epg.next.startTime)} {epg.next.title}
              </Text>
            )}
          </>
        ) : (
          <Text style={rowStyles.noEpg}>Sem programação</Text>
        )}
      </View>

      {/* Remaining time */}
      {(epg?.remaining ?? 0) > 0 && (
        <View style={rowStyles.chip}>
          <Text style={rowStyles.chipText}>{epg!.remaining}m</Text>
        </View>
      )}

      <Ionicons
        name="chevron-forward"
        size={14}
        color={Colors.textMuted}
        style={{ marginLeft: 2 }}
      />
    </TouchableOpacity>
  );
});

EPGRow.displayName = 'EPGRow';

const rowStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    gap: Spacing.md,
  },
  logoBox: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  logo: {
    width: 38,
    height: 38,
  },
  info: {
    flex: 1,
    gap: 3,
  },
  channelName: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.live + '22',
    borderRadius: BorderRadius.xs,
    paddingHorizontal: 5,
    paddingVertical: 2,
    gap: 3,
    flexShrink: 0,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.live,
  },
  liveLabel: {
    color: Colors.live,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  programTitle: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  progressTrack: {
    height: 3,
    backgroundColor: Colors.progressBg,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 2,
  },
  nextText: {
    color: Colors.textMuted,
    fontSize: 11,
  },
  nextLabel: {
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  noEpg: {
    color: Colors.textMuted,
    fontSize: 11,
    fontStyle: 'italic',
  },
  chip: {
    backgroundColor: Colors.surfaceVariant,
    borderRadius: BorderRadius.xs,
    paddingHorizontal: 6,
    paddingVertical: 3,
    flexShrink: 0,
  },
  chipText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
});

// ─── Main Modal ──────────────────────────────────────────────────────────────

interface EPGGuideModalProps {
  visible: boolean;
  onClose: () => void;
  /** When provided, called instead of navigating to the player (used inside VideoPlayer) */
  onChannelPress?: (channel: Channel) => void;
}

export default function EPGGuideModal({ visible, onClose, onChannelPress }: EPGGuideModalProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [selectedCategory, setSelectedCategory] = useState<string>('Todos');

  // Normais primeiro, adultos no final — garante lazy load natural do FlatList
  const allChannels = useMemo(() => {
    const normal = getAllChannels(false);
    const adult = getAllChannels(true).filter((c) => c.category === 'Adulto');
    return [...normal, ...adult];
  }, []);

  // Quantidade de canais normais → initialNumToRender carrega todos de uma vez
  const normalCount = useMemo(
    () => allChannels.filter((c) => c.category !== 'Adulto').length,
    [allChannels]
  );

  const categories = useMemo(() => {
    const cats = Array.from(new Set(allChannels.map((c) => c.category)));
    return ['Todos', ...cats];
  }, [allChannels]);

  const filteredChannels = useMemo(() => {
    if (selectedCategory === 'Todos') return allChannels;
    return allChannels.filter((c) => c.category === selectedCategory);
  }, [allChannels, selectedCategory]);

  const handleChannelPress = useCallback(
    (channel: Channel) => {
      if (onChannelPress) {
        // Modo in-player: troca canal sem navegar
        onChannelPress(channel);
        onClose();
      } else {
        // Modo standalone: navega para o player
        onClose();
        setTimeout(() => {
          router.push({
            pathname: '/player/[id]',
            params: { id: channel.id },
          });
        }, 300);
      }
    },
    [onClose, onChannelPress, router]
  );

  const keyExtractor = useCallback((item: Channel) => item.id, []);
  const renderItem = useCallback(
    ({ item }: { item: Channel }) => (
      <EPGRow channel={item} onPress={handleChannelPress} />
    ),
    [handleChannelPress]
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        {/* Tap outside to close */}
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
        />

        {/* Sheet */}
        <View
          style={[
            styles.sheet,
            { paddingBottom: insets.bottom + Spacing.sm },
          ]}
        >
          {/* Drag handle */}
          <View style={styles.handle} />

          {/* Header */}
          <LinearGradient
            colors={[Colors.primaryDark + 'CC', Colors.surface]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.headerGradient}
          >
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <View style={styles.headerIcon}>
                  <Ionicons name="tv" size={18} color={Colors.primaryLight} />
                </View>
                <View>
                  <Text style={styles.headerTitle}>Guia de Programação</Text>
                  <Text style={styles.headerSub}>
                    {filteredChannels.length} canais
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={onClose}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={20} color={Colors.text} />
              </TouchableOpacity>
            </View>
          </LinearGradient>

          {/* Category pills */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.pillsScroll}
            contentContainerStyle={styles.pillsContent}
          >
            {categories.map((cat) => {
              const active = cat === selectedCategory;
              return (
                <TouchableOpacity
                  key={cat}
                  style={[styles.pill, active && styles.pillActive]}
                  onPress={() => setSelectedCategory(cat)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[styles.pillText, active && styles.pillTextActive]}
                    numberOfLines={1}
                  >
                    {cat}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Channel list */}
          <FlatList
            data={filteredChannels}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            showsVerticalScrollIndicator={false}
            initialNumToRender={normalCount}
            maxToRenderPerBatch={20}
            windowSize={10}
            removeClippedSubviews
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons
                  name="calendar-outline"
                  size={40}
                  color={Colors.textMuted}
                />
                <Text style={styles.emptyText}>
                  Nenhum canal com programação
                </Text>
                <Text style={styles.emptySubText}>
                  Carregue o guia na tela inicial
                </Text>
              </View>
            }
          />
        </View>
      </View>
    </Modal>
  );
}

const SHEET_HEIGHT = height * 0.88;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    height: SHEET_HEIGHT,
    backgroundColor: Colors.cardBg,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    overflow: 'hidden',
    ...Shadows.lg,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  headerGradient: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.primary + '33',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: Colors.text,
    fontSize: Typography.h3.fontSize,
    fontWeight: '700',
  },
  headerSub: {
    color: Colors.textSecondary,
    fontSize: Typography.caption.fontSize,
    marginTop: 1,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillsScroll: {
    flexShrink: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  pillsContent: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  pill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pillActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  pillText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  pillTextActive: {
    color: Colors.text,
    fontWeight: '700',
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xxxl * 2,
    gap: Spacing.sm,
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: Typography.body.fontSize,
    fontWeight: '500',
  },
  emptySubText: {
    color: Colors.textMuted,
    fontSize: Typography.caption.fontSize,
  },
});
