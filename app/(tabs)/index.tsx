import React, { useEffect, useCallback, useState, useMemo, useRef } from 'react';
import { 
  View, 
  Text,
  StyleSheet, 
  StatusBar,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Typography, Spacing, BorderRadius } from '../../constants/Colors';
import { useChannelStore } from '../../stores/channelStore';
import { useFavoritesStore } from '../../stores/favoritesStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { initEPGService, prefetchEPG, getEPGStats } from '../../services/epgService';
import CategoryTabs from '../../components/CategoryTabs';
import ChannelList from '../../components/ChannelList';
import PinModal from '../../components/PinModal';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pendingCategory, setPendingCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [epgProgress, setEpgProgress] = useState({ loaded: 0, total: 0 });
  const [isLoadingEPG, setIsLoadingEPG] = useState(false);
  
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

  // Prefetch EPG em background (não bloqueia UI)
  useEffect(() => {
    if (channels.length > 0 && !prefetchedRef.current) {
      prefetchedRef.current = true;
      setIsLoadingEPG(true);
      
      const channelIds = channels.slice(0, 20).map(c => c.id);
      const total = channelIds.length;
      let loaded = 0;
      
      setEpgProgress({ loaded: 0, total });
      
      // Carrega em batches pequenos para não travar
      const loadBatch = async (batch: string[]) => {
        await prefetchEPG(batch);
        loaded += batch.length;
        setEpgProgress({ loaded, total });
      };
      
      // Carrega 5 por vez de forma assíncrona
      const loadAll = async () => {
        for (let i = 0; i < channelIds.length; i += 5) {
          const batch = channelIds.slice(i, i + 5);
          await loadBatch(batch);
        }
        setIsLoadingEPG(false);
      };
      
      // Não bloqueia - setTimeout para próximo tick
      setTimeout(loadAll, 100);
    }
  }, [channels]);

  const handleSelectCategory = useCallback((category: string) => {
    if (category === 'Adulto' && !adultUnlocked) {
      setPendingCategory(category);
      setPinModalVisible(true);
      return;
    }
    setCategory(category as any);
    setSearchQuery('');
    setShowSearch(false);
    prefetchedRef.current = false; // Reset para nova categoria
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
