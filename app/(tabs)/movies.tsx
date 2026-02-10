import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView,
  StatusBar,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Typography, Spacing, BorderRadius } from '../../constants/Colors';
import { useMediaStore } from '../../stores/mediaStore';
import {
  loadInitialCategories,
  searchMedia,
  filterMedia,
  sortMedia,
  getAllGenres,
} from '../../services/mediaService';
import { 
  CATEGORIES, 
  clearMemoryCache,
  fetchCategoryPage,
  PARALLEL_BATCH_SIZE
} from '../../services/streamingService';
import { useSettingsStore } from '../../stores/settingsStore';

const ADULT_CATEGORY_IDS = [
  'hot-adultos-bella-da-semana',
  'hot-adultos-legendado',
  'hot-adultos',
];
import type { MediaItem } from '../../types';
import MediaRow from '../../components/MediaRow';
import MediaCard from '../../components/MediaCard';
import FilterBar from '../../components/FilterBar';

export default function MoviesScreen() {
  const insets = useSafeAreaInsets();
  
  // Content state
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [categories, setCategories] = useState<Map<string, MediaItem[]>>(new Map());
  
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  
  const { 
    activeFilter, activeSort, activeGenre,
    setFilter, setSort, setGenre, clearFilters 
  } = useMediaStore();
  
  const { adultUnlocked } = useSettingsStore();

  // Carregar dados online ao abrir
  useEffect(() => {
    loadCatalog();
  }, [adultUnlocked]); // Recarregar se o status adulto mudar

  const loadCatalog = async () => {
    setLoading(true);
    setCategories(new Map()); // Limpar anteriores

    try {
      // 1. Filtrar categorias baseado na configuração adulto
      const relevantCategories = CATEGORIES.filter(cat => {
        if (!adultUnlocked && ADULT_CATEGORY_IDS.includes(cat.id)) {
          return false;
        }
        return true;
      });

      // 2. Carregar em batches para aparecer aos poucos
      for (let i = 0; i < relevantCategories.length; i += PARALLEL_BATCH_SIZE) {
        const batch = relevantCategories.slice(i, i + PARALLEL_BATCH_SIZE);
        
        const batchResults = await Promise.all(
          batch.map(async (cat) => {
            try {
              const items = await fetchCategoryPage(cat.id, 1);
              return { id: cat.id, items };
            } catch (err) {
              console.warn(`Erro ao carregar categoria ${cat.id}`, err);
              return { id: cat.id, items: [] };
            }
          })
        );

        // Atualizar estado incrementalmente
        setCategories(prev => {
          const newMap = new Map(prev);
          batchResults.forEach(({ id, items }) => {
            if (items.length > 0) {
              newMap.set(id, items);
            }
          });
          return newMap;
        });

        // Se for o primeiro batch, já tira o loading full screen
        if (i === 0) {
          setLoading(false);
        }
      }
    } catch (e) {
      console.error('Erro ao carregar catálogo:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    clearMemoryCache();
    loadCatalog();
  }, []);

  // Todos os itens combinados
  const allItems = useMemo(() => {
    const items: MediaItem[] = [];
    categories.forEach(catItems => items.push(...catItems));
    return items;
  }, [categories]);

  // Gêneros disponíveis
  const genres = useMemo(() => getAllGenres(allItems), [allItems]);

  // Itens filtrados
  const filteredItems = useMemo(() => {
    let items = allItems;
    
    if (searchQuery.trim()) {
      items = searchMedia(searchQuery, items);
    }
    
    if (activeFilter !== 'all') {
      items = filterMedia(items, activeFilter);
    }
    
    if (activeGenre) {
      items = filterMedia(items, undefined, activeGenre);
    }
    
    items = sortMedia(items, activeSort);
    
    return items;
  }, [allItems, searchQuery, activeFilter, activeGenre, activeSort]);

  const showGrid = searchQuery.trim() || activeFilter !== 'all' || activeGenre;

  // Tela de carregamento
  if (loading) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Carregando catálogo...</Text>
      </View>
    );
  }

  // Catálogo
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
      
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.title}>Filmes & Séries</Text>
            <Text style={styles.subtitle}>
              {categories.size} categorias • {allItems.length} títulos
            </Text>
          </View>
          <View style={styles.headerButtons}>
            <TouchableOpacity 
              style={styles.headerButton} 
              onPress={() => setShowSearch(!showSearch)}
            >
              <Ionicons 
                name={showSearch ? 'close' : 'search'} 
                size={22} 
                color={Colors.text} 
              />
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.headerButton} 
              onPress={() => setShowFilters(!showFilters)}
            >
              <Ionicons name="options" size={22} color={Colors.text} />
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.headerButton, styles.refreshButton]} 
              onPress={handleRefresh}
            >
              <Ionicons name="refresh" size={20} color={Colors.text} />
            </TouchableOpacity>
          </View>
        </View>
        
        {/* Search Bar */}
        {showSearch && (
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={20} color={Colors.textSecondary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Buscar filmes e séries..."
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
      </View>
      
      {/* Filters */}
      {showFilters && (
        <FilterBar
          activeFilter={activeFilter}
          activeSort={activeSort}
          activeGenre={activeGenre}
          genres={genres}
          onFilterChange={setFilter}
          onSortChange={setSort}
          onGenreChange={setGenre}
          onClear={clearFilters}
        />
      )}

      {/* Content */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={Colors.primary}
            colors={[Colors.primary]}
          />
        }
      >
        {showGrid ? (
          <View style={styles.gridContainer}>
            <Text style={styles.resultsText}>
              {filteredItems.length} resultado{filteredItems.length !== 1 ? 's' : ''}
            </Text>
            <View style={styles.grid}>
              {filteredItems.map((item) => (
                <MediaCard key={item.id} item={item} size="small" />
              ))}
            </View>
          </View>
        ) : (
          CATEGORIES.map((cat) => {
             // Verificação extra de segurança para conteúdo adulto
            if (!adultUnlocked && ADULT_CATEGORY_IDS.includes(cat.id)) {
              return null;
            }

            const items = categories.get(cat.id) || [];
            if (items.length === 0) return null;
            
            return (
              <MediaRow
                key={cat.id}
                title={cat.name}
                categoryId={cat.id}
                items={items.slice(0, 10)}
              />
            );
          })
        )}
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
  loadingText: {
    color: Colors.textSecondary,
    marginTop: Spacing.md,
    fontSize: Typography.body.fontSize,
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
  headerButtons: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  headerButton: {
    padding: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.full,
  },
  refreshButton: {
    backgroundColor: Colors.primary,
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
  content: {
    flex: 1,
  },
  gridContainer: {
    paddingHorizontal: Spacing.lg,
  },
  resultsText: {
    color: Colors.textSecondary,
    fontSize: Typography.caption.fontSize,
    marginBottom: Spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
});
