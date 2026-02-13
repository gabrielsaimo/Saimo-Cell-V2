import React, { useEffect, useCallback, useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  TextInput,
  TouchableOpacity,
  InteractionManager,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Typography, Spacing, BorderRadius } from '../../constants/Colors';
import { useChannelStore } from '../../stores/channelStore';
import { useFavoritesStore } from '../../stores/favoritesStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { initEPGService, fetchChannelEPG, hasEPGMapping, hasFreshCache } from '../../services/epgService';
import CategoryTabs from '../../components/CategoryTabs';
import ChannelList from '../../components/ChannelList';
import PinModal from '../../components/PinModal';
import EPGConsentModal from '../../components/EPGConsentModal';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pendingCategory, setPendingCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [epgProgress, setEpgProgress] = useState({ loaded: 0, total: 0 });
  const [isLoadingEPG, setIsLoadingEPG] = useState(false);
  
  // EPG Consent State
  const [showEPGConsent, setShowEPGConsent] = useState(true);
  const [allowEPGLoading, setAllowEPGLoading] = useState(false);
  
  const prefetchedRef = useRef(false);
  
  const { 
    selectedCategory, 
    setCategory, 
    getFilteredChannels, 
    getCategories,
  } = useChannelStore();
  
  const { favorites } = useFavoritesStore();
  const { adultUnlocked, unlockAdult } = useSettingsStore();

  // Initialize EPG service
  useEffect(() => {
    initEPGService();
  }, []);

  const categories = getCategories(adultUnlocked);
  const allChannels = getFilteredChannels(adultUnlocked, favorites);

  // Filtra por busca
  const channels = useMemo(() => {
    if (!searchQuery.trim()) return allChannels;
    const query = searchQuery.toLowerCase().trim();
    return allChannels.filter(ch => 
      ch.name.toLowerCase().includes(query) ||
      ch.category.toLowerCase().includes(query)
    );
  }, [allChannels, searchQuery]);

  // Prefetch EPG em background — UM canal por vez + yield entre cada um.
  // Nunca bloqueia navegação nem interações do usuário.
  useEffect(() => {
    if (!allowEPGLoading) return;
    if (channels.length === 0 || prefetchedRef.current) return;
    prefetchedRef.current = true;

    // Filtra apenas canais sem cache fresco em memória
    const channelIds = channels
      .filter(c => hasEPGMapping(c.id) && !hasFreshCache(c.id))
      .map(c => c.id);

    // Nada a carregar (tudo em cache) — não mostra barra de progresso
    if (channelIds.length === 0) return;

    let cancelled = false;

    // Aguarda animações/interações terminarem antes de iniciar
    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;

      const total = channelIds.length;
      let loaded = 0;
      setIsLoadingEPG(true);
      setEpgProgress({ loaded: 0, total });

      const loadAll = async () => {
        for (const channelId of channelIds) {
          if (cancelled) return;

          // Busca UM canal — se já estiver em cache (disco), retorna rápido
          await fetchChannelEPG(channelId).catch(() => {});
          loaded++;

          // Atualiza progresso a cada 5 canais para reduzir re-renders
          if (loaded % 5 === 0 || loaded >= total) {
            setEpgProgress({ loaded, total });
          }

          // Yield obrigatório após cada canal — JS thread livre para toques/navegação
          await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
        if (!cancelled) {
          setEpgProgress({ loaded: total, total });
          setIsLoadingEPG(false);
        }
      };

      loadAll();
    });

    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [channels, allowEPGLoading]);

  const handleSelectCategory = useCallback((category: string) => {
    if (category === 'Adulto' && !adultUnlocked) {
      setPendingCategory(category);
      setPinModalVisible(true);
      return;
    }
    setCategory(category as any);
    setSearchQuery('');
    setShowSearch(false);
  }, [adultUnlocked, setCategory]);

  const handlePinSuccess = useCallback(() => {
    unlockAdult();
    if (pendingCategory) {
      setCategory(pendingCategory as any);
      setPendingCategory(null);
    }
  }, [pendingCategory, setCategory, unlockAdult]);

  const handlePinClose = useCallback(() => {
    setPinModalVisible(false);
    setPendingCategory(null);
  }, []);

  const handleEPGAccept = useCallback(() => {
    setAllowEPGLoading(true);
    setShowEPGConsent(false);
  }, []);

  const handleEPGDecline = useCallback(() => {
    setAllowEPGLoading(false);
    setShowEPGConsent(false);
  }, []);

  const toggleSearch = useCallback(() => {
    setShowSearch(prev => !prev);
    if (showSearch) {
      setSearchQuery('');
    }
  }, [showSearch]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
      
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.title}>Saimo TV</Text>
            <Text style={styles.subtitle}>{channels.length} canais</Text>
          </View>
          <TouchableOpacity style={styles.searchButton} onPress={toggleSearch}>
            <Ionicons 
              name={showSearch ? 'close' : 'search'} 
              size={24} 
              color={Colors.text} 
            />
          </TouchableOpacity>
        </View>
        
        {/* Search Input */}
        {showSearch && (
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={20} color={Colors.textSecondary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Buscar canais..."
              placeholderTextColor={Colors.textSecondary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={20} color={Colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* EPG Loading Progress */}
        {isLoadingEPG && epgProgress.total > 0 && (
          <View style={styles.epgProgressContainer}>
            <Text style={styles.epgProgressText}>
              Carregando guia... {epgProgress.loaded}/{epgProgress.total}
            </Text>
            <View style={styles.epgProgressBar}>
              <View 
                style={[
                  styles.epgProgressFill, 
                  { width: `${(epgProgress.loaded / epgProgress.total) * 100}%` }
                ]} 
              />
            </View>
          </View>
        )}
      </View>

      {/* Category Tabs */}
      {!showSearch && (
        <CategoryTabs
          categories={categories}
          selectedCategory={selectedCategory}
          onSelectCategory={handleSelectCategory}
        />
      )}

      {/* Channel List */}
      <View style={[styles.content, { paddingBottom: insets.bottom + 60 }]}>
        <ChannelList channels={channels} />
      </View>

      <PinModal
        visible={pinModalVisible}
        onClose={handlePinClose}
        onSuccess={handlePinSuccess}
        mode="verify"
      />

      <EPGConsentModal
        visible={showEPGConsent}
        onAccept={handleEPGAccept}
        onDecline={handleEPGDecline}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    backgroundColor: Colors.background,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: {
    color: Colors.text,
    fontSize: Typography.h1.fontSize,
    fontWeight: '700',
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: Typography.caption.fontSize,
    marginTop: 2,
  },
  searchButton: {
    padding: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.full,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md,
    marginTop: Spacing.md,
    height: 44,
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    color: Colors.text,
    fontSize: Typography.body.fontSize,
    height: '100%',
  },
  epgProgressContainer: {
    marginTop: Spacing.sm,
  },
  epgProgressText: {
    color: Colors.textSecondary,
    fontSize: 11,
    marginBottom: 4,
  },
  epgProgressBar: {
    height: 3,
    backgroundColor: Colors.surface,
    borderRadius: 1.5,
    overflow: 'hidden',
  },
  epgProgressFill: {
    height: '100%',
    backgroundColor: Colors.primary,
  },
  content: {
    flex: 1,
  },
});
