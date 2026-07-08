import React, { useEffect, useCallback, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  TextInput,
  TouchableOpacity,
  Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Typography, Spacing, BorderRadius } from '../../constants/Colors';
import { useChannelStore } from '../../stores/channelStore';
import { useFavoritesStore } from '../../stores/favoritesStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { initEPGService, onEPGProgress, onEPGStateChange, isEPGLoaded } from '../../services/epgService';
import CategoryTabs from '../../components/CategoryTabs';
import ChannelList from '../../components/ChannelList';
import PinModal from '../../components/PinModal';
import EPGGuideModal from '../../components/EPGGuideModal';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pendingCategory, setPendingCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [epgProgress, setEpgProgress] = useState({ progress: 0, loaded: 0, total: 0 });
  const [isLoadingEPG, setIsLoadingEPG] = useState(false);

  const [showEPGGuide, setShowEPGGuide] = useState(false);
  
  const { 
    selectedCategory, 
    setCategory, 
    getFilteredChannels, 
    getCategories,
    isProList,
    setProList,
    proChannels,
    fetchProChannels,
  } = useChannelStore();
  
  const { favorites } = useFavoritesStore();
  const { adultUnlocked, unlockAdult, showEPG } = useSettingsStore();

  // Auto-init EPG se habilitado nas configurações
  useEffect(() => {
    if (showEPG && !isEPGLoaded()) {
      initEPGService();
    }
  }, [showEPG]);

  // Memoize categories to prevent re-creation on every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const categories = useMemo(() => getCategories(adultUnlocked), [adultUnlocked, getCategories, isProList, proChannels]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allChannels = useMemo(() => getFilteredChannels(adultUnlocked, favorites), [adultUnlocked, favorites, getFilteredChannels, isProList, proChannels]);

  // Filtra por busca
  const channels = useMemo(() => {
    if (!searchQuery.trim()) return allChannels;
    const query = searchQuery.toLowerCase().trim();
    return allChannels.filter(ch => 
      ch.name.toLowerCase().includes(query) ||
      ch.category.toLowerCase().includes(query)
    );
  }, [allChannels, searchQuery]);

  useEffect(() => {
    const unsubProg = onEPGProgress((progress, loaded, total) => {
      setEpgProgress({ progress, loaded, total });
    });
    const unsubState = onEPGStateChange((state) => {
      setIsLoadingEPG(state === 'loading');
    });
    return () => { unsubProg(); unsubState(); };
  }, []);

  const handleTogglePro = useCallback((val: boolean) => {
    setProList(val);
    if (val && proChannels.length === 0) {
      fetchProChannels();
    }
  }, [setProList, fetchProChannels, proChannels.length]);

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
          <View style={styles.headerActions}>
            <View style={styles.proToggleContainer}>
              <Text style={styles.proToggleText}>Lite</Text>
              <Switch
                value={isProList}
                onValueChange={handleTogglePro}
                trackColor={{ false: Colors.surface, true: Colors.primary }}
                thumbColor={isProList ? '#fff' : '#ccc'}
                ios_backgroundColor={Colors.surface}
              />
              <Text style={styles.proToggleText}>Pro</Text>
            </View>
            <TouchableOpacity
              style={styles.searchButton}
              onPress={() => setShowEPGGuide(true)}
            >
              <Ionicons name="calendar-outline" size={22} color={Colors.text} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.searchButton} onPress={toggleSearch}>
              <Ionicons
                name={showSearch ? 'close' : 'search'}
                size={24}
                color={Colors.text}
              />
            </TouchableOpacity>
          </View>
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
        {isLoadingEPG && (
          <View style={styles.epgProgressContainer}>
            <Text style={styles.epgProgressText}>
              Carregando guia... {epgProgress.progress}%
            </Text>
            <View style={styles.epgProgressBar}>
              <View
                style={[
                  styles.epgProgressFill,
                  { width: `${Math.min(100, epgProgress.progress)}%` },
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

      <EPGGuideModal
        visible={showEPGGuide}
        onClose={() => setShowEPGGuide(false)}
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  proToggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    gap: 4,
  },
  proToggleText: {
    color: Colors.text,
    fontSize: Typography.caption.fontSize,
    fontWeight: '600',
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
