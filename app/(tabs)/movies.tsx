import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  InteractionManager,
  Dimensions,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Typography, Spacing, BorderRadius } from '../../constants/Colors';
import { useMediaStore } from '../../stores/mediaStore';
import {
  filterMedia,
  sortMedia,
  getAllGenres,
  deduplicateByName,
} from '../../services/mediaService';
import {
  CATEGORIES,
  fetchCategoryPage,
  PARALLEL_BATCH_SIZE,
  startBackgroundLoading,
  stopLoading,
  getAllLoadedCategories,
  getTotalLoadedCount,
  clearAllCaches,
  searchInLoadedData,
  hydrateFromDisk,
} from '../../services/streamingService';
import { useSettingsStore } from '../../stores/settingsStore';
import { getTrendingToday, getTrendingWeek, clearTrendingCache } from '../../services/trendingService';

const ADULT_CATEGORY_IDS = [
  'hot-adultos-bella-da-semana',
  'hot-adultos-legendado',
  'hot-adultos',
];
import type { MediaItem } from '../../types';
import MediaRow from '../../components/MediaRow';
import MediaCard from '../../components/MediaCard';
import FilterBar from '../../components/FilterBar';

// Intervalo mínimo entre syncs do background → UI (ms)
const BG_SYNC_INTERVAL = 5000;
// Debounce da busca (ms) - só pesquisa após o usuário parar de digitar
const SEARCH_DEBOUNCE = 600;
// Limite máximo de resultados na grid (previne renderizar arrays gigantes)
const MAX_GRID_RESULTS = 500;

type CategoryRowData = {
  id: string;
  name: string;
  items: MediaItem[];
};

const { width } = Dimensions.get('window');
// Cálculos de altura para getItemLayout
// MediaRow: 
// - Header (Text + seeAll): ~36px (approx font + padding)
// - List: width * 0.35 * 1.5 (Card Height)
// - MarginBottom: 20 (Spacing.xl)
// Total estimada: 36 + (width * 0.35 * 1.5) + 20
const CARD_WIDTH = width * 0.35;
const CARD_HEIGHT = CARD_WIDTH * 1.5;
const ROW_HEIGHT = 36 + CARD_HEIGHT + 20;

// Grid Item Height:
// width / 3 * 1.5 + margin
const GRID_ITEM_HEIGHT = (width / 3) * 1.5 + Spacing.sm;

export default function MoviesScreen() {
  const insets = useSafeAreaInsets();

  // Content state
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [categories, setCategories] = useState<Map<string, MediaItem[]>>(new Map());
  const [totalLoaded, setTotalLoaded] = useState(0);
  const [bgLoading, setBgLoading] = useState(false);

  // Trending state
  const [trendingToday, setTrendingToday] = useState<MediaItem[]>([]);
  const [trendingWeek, setTrendingWeek] = useState<MediaItem[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(false);
  const trendingLoadedRef = useRef(false);

  // Search: input separado do query efetivo (debounced)
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resultados de busca (assíncrono — nunca bloqueia o render)
  const [searchResults, setSearchResults] = useState<MediaItem[]>([]);
  const [searching, setSearching] = useState(false);

  const [showSearch, setShowSearch] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const {
    activeFilter, activeSort, activeGenre,
    setFilter, setSort, setGenre, clearFilters
  } = useMediaStore();

  const { adultUnlocked } = useSettingsStore();

  // Refs para controle do background sync
  const lastSyncRef = useRef(0);
  const mountedRef = useRef(true);
  const catalogLoadedRef = useRef(false);

  // Cleanup ao desmontar
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopLoading();
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  // Busca assíncrona: quando debouncedQuery muda, computa resultados FORA do render
  // Isso evita bloquear a thread JS com searchMedia em 50k+ itens
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);

    // setTimeout(16ms) = ~1 frame — deixa o render completar antes de computar
    const timeoutId = setTimeout(() => {
      try {
        // Busca direto no cache sem criar allItems (evita OOM)
        let results = searchInLoadedData(debouncedQuery);

        if (activeFilter !== 'all') {
          results = filterMedia(results, activeFilter);
        }
        if (activeGenre) {
          results = filterMedia(results, undefined, activeGenre);
        }
        results = sortMedia(results, activeSort);

        if (results.length > MAX_GRID_RESULTS) {
          results = results.slice(0, MAX_GRID_RESULTS);
        }

        if (mountedRef.current) {
          setSearchResults(results);
          setSearching(false);
        }
      } catch (e) {
        console.warn('[Movies] Erro na busca:', e);
        if (mountedRef.current) {
          setSearchResults([]);
          setSearching(false);
        }
      }
    }, 16);

    return () => clearTimeout(timeoutId);
  }, [debouncedQuery, activeFilter, activeGenre, activeSort]);

  // Debounce do search: só aplica o filtro após o usuário parar de digitar
  const handleSearchChange = useCallback((text: string) => {
    setSearchInput(text);
    isSearchActiveRef.current = !!text.trim();

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (!text.trim()) {
      // Se limpou, aplica imediatamente e reativa sync
      setDebouncedQuery('');
      isSearchActiveRef.current = false;
      // Sincronizar dados que podem ter sido acumulados durante a busca
      const loaded = getAllLoadedCategories();
      setCategories(loaded);
      setTotalLoaded(getTotalLoadedCount());
      return;
    }

    searchTimerRef.current = setTimeout(() => {
      if (mountedRef.current) {
        setDebouncedQuery(text);
      }
    }, SEARCH_DEBOUNCE);
  }, []);

  const clearSearch = useCallback(() => {
    setSearchInput('');
    setDebouncedQuery('');
    isSearchActiveRef.current = false;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    // Sincronizar dados acumulados
    const loaded = getAllLoadedCategories();
    setCategories(loaded);
    setTotalLoaded(getTotalLoadedCount());
  }, []);

  // Carregar dados online ao abrir
  useEffect(() => {
    loadCatalog(false);
  }, [adultUnlocked]);

  // Ref para saber se search está ativo (evita re-renders pesados durante busca)
  const isSearchActiveRef = useRef(false);

  // Sync periódico do cache → UI durante background loading
  // NÃO faz sync se a busca está ativa (evita recomputar allItems+filteredItems)
  const syncFromCache = useCallback(() => {
    if (!mountedRef.current) return;
    if (isSearchActiveRef.current) return; // Pula sync durante busca
    const now = Date.now();
    if (now - lastSyncRef.current < BG_SYNC_INTERVAL) return;
    lastSyncRef.current = now;

    const loaded = getAllLoadedCategories();
    setCategories(loaded);
    setTotalLoaded(getTotalLoadedCount());
  }, []);

  // Carrega tendências lazily após o catálogo ter dados (sem bloquear UI)
  const loadTrending = useCallback(() => {
    if (trendingLoadedRef.current) return;
    trendingLoadedRef.current = true;

    InteractionManager.runAfterInteractions(() => {
      if (!mountedRef.current) return;
      setTrendingLoading(true);
      Promise.all([getTrendingToday(), getTrendingWeek()])
        .then(([today, week]) => {
          if (!mountedRef.current) return;
          setTrendingToday(today);
          setTrendingWeek(week);
        })
        .catch(e => console.warn('[Trending] Load failed:', e))
        .finally(() => {
          if (mountedRef.current) setTrendingLoading(false);
        });
    });
  }, []);

  // Iniciar background loading (separado para poder reusar)
  const startBgLoad = useCallback(() => {
    InteractionManager.runAfterInteractions(() => {
      if (!mountedRef.current) return;
      setBgLoading(true);

      startBackgroundLoading(() => {
        if (mountedRef.current) syncFromCache();
      }).then(() => {
        if (mountedRef.current) {
          const loaded = getAllLoadedCategories();
          setCategories(loaded);
          setTotalLoaded(getTotalLoadedCount());
          setBgLoading(false);
        }
      });
    });
  }, [syncFromCache]);

  const loadCatalog = async (isRefresh: boolean) => {
    // Na primeira abertura, restaurar cache do disco (instantâneo)
    // Na primeira abertura, restaurar cache do disco (agora async para não congelar)
    if (!isRefresh && !catalogLoadedRef.current) {
      setLoading(true); // Garante spinner enquanto hidrata
      const hydrated = await hydrateFromDisk();
      console.log('[Movies] Hydration result:', hydrated);
    }

    // Verificar se já tem dados na memória (do disco ou sessão anterior)
    const cachedCategories = getAllLoadedCategories();
    const cachedCount = getTotalLoadedCount();
    const hasCache = cachedCategories.size > 0;

    if (hasCache && !isRefresh) {
      // Tem cache do disco: mostrar imediatamente
      console.log('[Movies] Using disk cache:', cachedCount, 'items');
      setCategories(cachedCategories);
      setTotalLoaded(cachedCount);
      setLoading(false);
      // Continuar background loading para páginas restantes
      startBgLoad();
      catalogLoadedRef.current = true;
      // Carregar tendências após o catálogo estar disponível
      loadTrending();
      return;
    }

    // Sem cache ou refresh: carregar tudo da rede
    setLoading(true);

    try {
      const relevantCategories = CATEGORIES.filter(cat => {
        if (!adultUnlocked && ADULT_CATEGORY_IDS.includes(cat.id)) return false;
        return true;
      });

      // Parar background loading anterior se existir
      await stopLoading();

      // Carregar p1 de cada categoria em batches
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

        if (!mountedRef.current) return;

        setCategories(prev => {
          const newMap = new Map(prev);
          batchResults.forEach(({ id, items }) => {
            if (items.length > 0) {
              newMap.set(id, items);
            }
          });
          return newMap;
        });

        if (i === 0) {
          setLoading(false);
          // Carregar tendências assim que o primeiro batch estiver disponível
          loadTrending();
        }
      }

      setTotalLoaded(getTotalLoadedCount());
      catalogLoadedRef.current = true;

      // Iniciar background loading para páginas restantes
      startBgLoad();

    } catch (e) {
      console.error('Erro ao carregar catálogo:', e);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  // Pull-to-refresh (swipe down): NÃO limpa nada, apenas atualiza o spinner
  // O catálogo já está carregado e salvo em cache — não precisa recarregar
  const handlePullRefresh = useCallback(() => {
    setRefreshing(true);
    // Apenas sincronizar dados do cache na tela (caso background tenha novos)
    const loaded = getAllLoadedCategories();
    setCategories(loaded);
    setTotalLoaded(getTotalLoadedCount());
    setRefreshing(false);
  }, []);

  // Botão reload no header: limpa TUDO (memória + disco) e recarrega do zero
  const handleHardReload = useCallback(() => {
    setRefreshing(true);
    stopLoading();
    clearAllCaches();
    clearTrendingCache();
    setCategories(new Map());
    setTotalLoaded(0);
    setTrendingToday([]);
    setTrendingWeek([]);
    catalogLoadedRef.current = false;
    trendingLoadedRef.current = false;
    loadCatalog(true);
  }, [adultUnlocked]);

  // Dados para a FlatList de categorias (view de rows)
  const categoryData = useMemo((): CategoryRowData[] => {
    return CATEGORIES
      .filter(cat => {
        if (!adultUnlocked && ADULT_CATEGORY_IDS.includes(cat.id)) return false;
        const items = categories.get(cat.id);
        return items && items.length > 0;
      })
      .map(cat => ({
        id: cat.id,
        name: cat.name,
        items: (categories.get(cat.id) || []).slice(0, 10),
      }));
  }, [categories, adultUnlocked]);

  // Todos os itens combinados (para filtros/busca)
  // Usa loop seguro em vez de push(...spread) que causa stack overflow com arrays grandes
  const allItems = useMemo(() => {
    let total = 0;
    categories.forEach(catItems => { total += catItems.length; });
    const items = new Array<MediaItem>(total);
    let idx = 0;
    categories.forEach(catItems => {
      for (let i = 0; i < catItems.length; i++) {
        items[idx++] = catItems[i];
      }
    });
    return deduplicateByName(items);
  }, [categories]);

  // Gêneros disponíveis
  const genres = useMemo(() => getAllGenres(allItems), [allItems]);

  // Itens filtrados — SÓ para filtros (tipo/gênero), NÃO para busca
  // A busca é assíncrona via useEffect acima (evita bloquear o render)
  const filteredItems = useMemo(() => {
    // Se tem busca ativa, resultados vêm do searchResults (async)
    if (debouncedQuery.trim()) return [];

    try {
      let items = allItems;

      if (activeFilter !== 'all') {
        items = filterMedia(items, activeFilter);
      }

      if (activeGenre) {
        items = filterMedia(items, undefined, activeGenre);
      }

      items = sortMedia(items, activeSort);

      if (items.length > MAX_GRID_RESULTS) {
        items = items.slice(0, MAX_GRID_RESULTS);
      }

      return items;
    } catch (e) {
      console.warn('[Movies] Erro ao filtrar:', e);
      return [];
    }
  }, [allItems, debouncedQuery, activeFilter, activeGenre, activeSort]);

  // Dados da grid: busca (async) ou filtros (sync)
  const gridData = debouncedQuery.trim() ? searchResults : filteredItems;

  // showGrid usa debouncedQuery para não trocar de view enquanto digita
  const showGrid = debouncedQuery.trim() || activeFilter !== 'all' || activeGenre;

  // Render functions para FlatLists
  const renderCategoryRow = useCallback(({ item }: { item: CategoryRowData }) => (
    <MediaRow
      title={item.name}
      categoryId={item.id}
      items={item.items}
    />
  ), []);

  const renderGridItem = useCallback(({ item }: { item: MediaItem }) => (
    <MediaCard item={item} size="small" />
  ), []);

  const keyExtractorCategory = useCallback((item: CategoryRowData) => item.id, []);
  const keyExtractorGrid = useCallback((item: MediaItem) => item.id, []);

  const refreshControl = useMemo(() => (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={handlePullRefresh}
      tintColor={Colors.primary}
      colors={[Colors.primary]}
    />
  ), [refreshing, handlePullRefresh]);

  // Seção de tendências — aparece no topo da lista de categorias
  // Lazy: só renderiza quando tiver dados ou estiver carregando
  const TrendingSection = useMemo(() => {
    const hasAny = trendingToday.length > 0 || trendingWeek.length > 0;
    if (!trendingLoading && !hasAny) return null;

    return (
      <View>
        {/* Tendências de Hoje */}
        {trendingLoading && trendingToday.length === 0 ? (
          <View style={styles.trendingPlaceholder}>
            <Text style={styles.trendingPlaceholderTitle}>🔥 Tendências de Hoje</Text>
            <ActivityIndicator size="small" color={Colors.primary} style={styles.trendingSpinner} />
          </View>
        ) : (
          <MediaRow title="🔥 Tendências de Hoje" items={trendingToday} />
        )}
        {/* Tendências da Semana */}
        {trendingLoading && trendingWeek.length === 0 ? (
          <View style={styles.trendingPlaceholder}>
            <Text style={styles.trendingPlaceholderTitle}>📅 Tendências da Semana</Text>
            <ActivityIndicator size="small" color={Colors.primary} style={styles.trendingSpinner} />
          </View>
        ) : (
          <MediaRow title="📅 Tendências da Semana" items={trendingWeek} />
        )}
      </View>
    );
  }, [trendingToday, trendingWeek, trendingLoading]);

  // Header component para a grid view
  const GridHeader = useMemo(() => {
    if (searching) {
      return (
        <View style={styles.searchingRow}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.resultsText}>Buscando...</Text>
        </View>
      );
    }
    return (
      <Text style={styles.resultsText}>
        {gridData.length} resultado{gridData.length !== 1 ? 's' : ''}
      </Text>
    );
  }, [gridData.length, searching]);

  // Footer com indicador de background loading
  const ListFooter = useMemo(() => {
    if (!bgLoading) return null;
    return (
      <View style={styles.bgLoadingContainer}>
        <ActivityIndicator size="small" color={Colors.primary} />
        <Text style={styles.bgLoadingText}>
          Carregando mais títulos... ({totalLoaded})
        </Text>
      </View>
    );
  }, [bgLoading, totalLoaded]);

  // Tela de carregamento (só na primeira vez, sem cache)
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
              {categories.size} categorias • {totalLoaded} títulos
              {bgLoading ? ' (carregando...)' : ''}
            </Text>
          </View>
          <View style={styles.headerButtons}>
            <TouchableOpacity
              style={styles.headerButton}
              onPress={() => {
                if (showSearch) {
                  clearSearch();
                  setShowSearch(false);
                } else {
                  setShowSearch(true);
                }
              }}
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
              onPress={handleHardReload}
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
              value={searchInput}
              onChangeText={handleSearchChange}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchInput.length > 0 && (
              <TouchableOpacity onPress={clearSearch}>
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

      {/* Content - Virtualized Lists (key prop forces unmount/remount on view switch) */}
      {showGrid ? (
        // Grid view - FlashList virtualizado com colunas
        <FlashList
          key="grid-view"
          data={gridData}
          keyExtractor={keyExtractorGrid}
          numColumns={3}
          renderItem={renderGridItem}
          contentContainerStyle={[styles.gridContainer, { paddingBottom: insets.bottom + 80 }]}
          // columnWrapperStyle not supported in FlashList? FlashList handles numColumns differently but might not support columnWrapperStyle directly.
          // FlashList doesn't support columnWrapperStyle. We need to check if we can remove it or if we need a workaround.
          // Actually FlashList handles layout inside. We should check if we really need columnWrapperStyle for gap. 
          // FlashList doesn't support columnWrapperStyle. We can use ItemSeparatorComponent or padding in the item.
          // For now I will remove columnWrapperStyle and see.
          showsVerticalScrollIndicator={false}
          refreshControl={refreshControl}
          ListHeaderComponent={GridHeader}
          ListFooterComponent={ListFooter}
          estimatedItemSize={GRID_ITEM_HEIGHT}
          initialNumToRender={12}
          // maxToRenderPerBatch not used in FlashList
          // windowSize not used in FlashList
          // removeClippedSubviews handled by FlashList
        />
      ) : (
        // Category rows view - FlashList virtualizado
        <FlashList
          key="category-view"
          data={categoryData}
          keyExtractor={keyExtractorCategory}
          renderItem={renderCategoryRow}
          contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
          showsVerticalScrollIndicator={false}
          refreshControl={refreshControl}
          ListHeaderComponent={TrendingSection}
          ListFooterComponent={ListFooter}
          estimatedItemSize={ROW_HEIGHT}
          initialNumToRender={2}
        />
      )}
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
  gridContainer: {
    paddingHorizontal: Spacing.lg,
  },
  searchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  resultsText: {
    color: Colors.textSecondary,
    fontSize: Typography.caption.fontSize,
    marginBottom: Spacing.md,
  },
  gridRow: {
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  bgLoadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.lg,
    gap: Spacing.sm,
  },
  bgLoadingText: {
    color: Colors.textSecondary,
    fontSize: Typography.caption.fontSize,
  },
  trendingPlaceholder: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
    height: 36,
    gap: Spacing.sm,
  },
  trendingPlaceholderTitle: {
    color: Colors.text,
    fontSize: Typography.h3.fontSize,
    fontWeight: '700',
  },
  trendingSpinner: {
    marginLeft: Spacing.sm,
  },
});
