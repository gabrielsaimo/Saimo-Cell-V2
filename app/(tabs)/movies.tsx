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
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Colors, Typography, Spacing, BorderRadius } from '../../constants/Colors';
import { useMediaStore } from '../../stores/mediaStore';
import {
  downloadAllCategories,
  loadAllCachedCategories,
  getDownloadedCategories,
  DOWNLOAD_CATEGORIES,
  clearAllDownloads,
} from '../../services/downloadService';
import {
  searchMedia,
  filterMedia,
  sortMedia,
  getAllGenres,
} from '../../services/mediaService';
import type { MediaItem } from '../../types';
import MediaRow from '../../components/MediaRow';
import MediaCard from '../../components/MediaCard';
import FilterBar from '../../components/FilterBar';

const DOWNLOAD_COMPLETE_KEY = '@saimo_download_complete';

export default function MoviesScreen() {
  const insets = useSafeAreaInsets();
  
  // Download state
  const [checkingDownload, setCheckingDownload] = useState(true);
  const [downloadComplete, setDownloadComplete] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [currentCategory, setCurrentCategory] = useState('');
  const [categoryProgress, setCategoryProgress] = useState(0);
  const [overallProgress, setOverallProgress] = useState({ current: 0, total: DOWNLOAD_CATEGORIES.length });
  const [categoryStatuses, setCategoryStatuses] = useState<Map<string, 'pending' | 'downloading' | 'completed' | 'error'>>(new Map());
  
  // Content state
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [categories, setCategories] = useState<Map<string, MediaItem[]>>(new Map());
  
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  
  const { 
    activeFilter, activeSort, activeGenre,
    setFilter, setSort, setGenre, clearFilters 
  } = useMediaStore();

  // Verificar se já foi feito download
  useEffect(() => {
    const checkDownloadStatus = async () => {
      try {
        // IMPORTANTE: Limpar qualquer cache antigo na primeira execução
        const hasCheckedBefore = await AsyncStorage.getItem('@saimo_first_check_done');
        if (!hasCheckedBefore) {
          // Primeira execução - limpar tudo
          await clearAllDownloads();
          await AsyncStorage.removeItem(DOWNLOAD_COMPLETE_KEY);
          await AsyncStorage.setItem('@saimo_first_check_done', 'true');
          setDownloadComplete(false);
          setCheckingDownload(false);
          return;
        }

        const complete = await AsyncStorage.getItem(DOWNLOAD_COMPLETE_KEY);
        if (complete === 'true') {
          // Verificar se realmente tem dados
          const downloaded = await getDownloadedCategories();
          if (downloaded.size > 0) {
            setDownloadComplete(true);
          }
        }
      } catch (e) {
        console.warn('Erro ao verificar download:', e);
      } finally {
        setCheckingDownload(false);
      }
    };
    checkDownloadStatus();
  }, []);

  // Carregar dados após download completo
  useEffect(() => {
    if (downloadComplete && !loading) {
      loadCatalog();
    }
  }, [downloadComplete]);

  const loadCatalog = async () => {
    setLoading(true);
    try {
      const data = await loadAllCachedCategories();
      setCategories(data);
    } catch (e) {
      console.error('Erro ao carregar catálogo:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Iniciar download
  const startDownload = async () => {
    setDownloading(true);
    
    // Inicializar status de todas as categorias
    const initialStatuses = new Map<string, 'pending' | 'downloading' | 'completed' | 'error'>();
    DOWNLOAD_CATEGORIES.forEach(cat => initialStatuses.set(cat.id, 'pending'));
    setCategoryStatuses(initialStatuses);
    
    try {
      await downloadAllCategories(
        // Callback por categoria
        (categoryId, progress, status, itemCount, bytesDownloaded) => {
          const cat = DOWNLOAD_CATEGORIES.find(c => c.id === categoryId);
          if (cat) {
            const mbDownloaded = bytesDownloaded ? (bytesDownloaded / (1024 * 1024)).toFixed(1) : '0';
            const statusText = status === 'processing' ? 'Processando' : 'Baixando';
            setCurrentCategory(`${statusText} ${cat.name} (${mbDownloaded}MB)`);
          }
          setCategoryProgress(progress);
          setCategoryStatuses(prev => {
            const newMap = new Map(prev);
            const newStatus = status === 'completed' ? 'completed' : status === 'error' ? 'error' : 'downloading';
            newMap.set(categoryId, newStatus);
            return newMap;
          });
        },
        // Callback de progresso geral
        (current, total) => {
          setOverallProgress({ current, total });
        }
      );
      
      // Marcar como completo
      await AsyncStorage.setItem(DOWNLOAD_COMPLETE_KEY, 'true');
      setDownloadComplete(true);
      
    } catch (e) {
      console.error('Erro no download:', e);
    } finally {
      setDownloading(false);
    }
  };

  // Resetar downloads
  const resetDownloads = async () => {
    await clearAllDownloads();
    await AsyncStorage.removeItem(DOWNLOAD_COMPLETE_KEY);
    setDownloadComplete(false);
    setCategories(new Map());
    setCategoryStatuses(new Map());
    setOverallProgress({ current: 0, total: DOWNLOAD_CATEGORIES.length });
  };

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
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

  // Tela de carregamento inicial
  if (checkingDownload) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  // Tela de download
  if (!downloadComplete) {
    const completedCount = Array.from(categoryStatuses.values()).filter(s => s === 'completed').length;
    const overallPercent = DOWNLOAD_CATEGORIES.length > 0 
      ? Math.round((overallProgress.current / DOWNLOAD_CATEGORIES.length) * 100)
      : 0;

    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
        
        <ScrollView 
          contentContainerStyle={styles.downloadContainer}
          showsVerticalScrollIndicator={false}
        >
          <Ionicons name="cloud-download" size={48} color={Colors.primary} />
          <Text style={styles.downloadTitle}>Baixar Catálogo</Text>
          <Text style={styles.downloadDesc}>
            Baixe as listas de filmes e séries para visualizar o catálogo completo.
          </Text>
          
          {!downloading ? (
            <TouchableOpacity style={styles.downloadButton} onPress={startDownload}>
              <Ionicons name="download" size={24} color="#000" />
              <Text style={styles.downloadButtonText}>Iniciar Download</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.progressSection}>
              {/* Barra de progresso geral */}
              <View style={styles.overallProgress}>
                <Text style={styles.overallProgressText}>
                  {completedCount}/{DOWNLOAD_CATEGORIES.length} categorias
                </Text>
                <View style={styles.progressBarContainer}>
                  <View style={[styles.progressBar, { width: `${overallPercent}%` }]} />
                </View>
              </View>
              
              {/* Categoria atual */}
              <View style={styles.currentCategorySection}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={styles.currentCategoryText}>{currentCategory}</Text>
              </View>
            </View>
          )}
          
          {/* Lista de categorias */}
          <View style={styles.categoryList}>
            {DOWNLOAD_CATEGORIES.map((cat) => {
              const status = categoryStatuses.get(cat.id) || 'pending';
              return (
                <View key={cat.id} style={styles.categoryItem}>
                  <View style={styles.categoryInfo}>
                    <Text style={styles.categoryName}>{cat.name}</Text>
                    <Text style={styles.categorySize}>~{cat.sizeMB}MB</Text>
                  </View>
                  <View style={styles.categoryStatus}>
                    {status === 'completed' && (
                      <Ionicons name="checkmark-circle" size={20} color="#10B981" />
                    )}
                    {status === 'downloading' && (
                      <ActivityIndicator size="small" color={Colors.primary} />
                    )}
                    {status === 'error' && (
                      <Ionicons name="alert-circle" size={20} color="#EF4444" />
                    )}
                    {status === 'pending' && (
                      <Ionicons name="cloud-outline" size={20} color={Colors.textSecondary} />
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>
    );
  }

  // Tela de carregamento do catálogo
  if (loading) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
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
              {filteredItems.slice(0, 50).map((item) => (
                <MediaCard key={item.id} item={item} size="small" />
              ))}
            </View>
          </View>
        ) : (
          DOWNLOAD_CATEGORIES.map((cat) => {
            const items = categories.get(cat.id) || [];
            if (items.length === 0) return null;
            return (
              <MediaRow
                key={cat.id}
                title={cat.name}
                categoryId={cat.id}
                items={items}
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
  downloadContainer: {
    flexGrow: 1,
    padding: Spacing.xl,
    paddingBottom: 120, // Espaço para o menu inferior
    alignItems: 'center',
  },
  downloadTitle: {
    color: Colors.text,
    fontSize: Typography.h1.fontSize,
    fontWeight: '700',
    marginTop: Spacing.lg,
    textAlign: 'center',
  },
  downloadDesc: {
    color: Colors.textSecondary,
    fontSize: Typography.body.fontSize,
    textAlign: 'center',
    marginTop: Spacing.sm,
    lineHeight: 22,
    maxWidth: 300,
  },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    marginTop: Spacing.xl,
    gap: Spacing.sm,
  },
  downloadButtonText: {
    color: '#000',
    fontSize: Typography.body.fontSize,
    fontWeight: '700',
  },
  progressSection: {
    width: '100%',
    marginTop: Spacing.xl,
    alignItems: 'center',
  },
  overallProgress: {
    width: '100%',
    alignItems: 'center',
  },
  overallProgressText: {
    color: Colors.text,
    fontSize: Typography.h2.fontSize,
    fontWeight: '700',
    marginBottom: Spacing.sm,
  },
  progressBarContainer: {
    width: '100%',
    height: 8,
    backgroundColor: Colors.surface,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 4,
  },
  currentCategorySection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.md,
    gap: Spacing.sm,
  },
  currentCategoryText: {
    color: Colors.textSecondary,
    fontSize: Typography.body.fontSize,
  },
  categoryList: {
    width: '100%',
    marginTop: Spacing.xl,
  },
  categoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface,
  },
  categoryInfo: {
    flex: 1,
  },
  categoryName: {
    color: Colors.text,
    fontSize: Typography.body.fontSize,
  },
  categorySize: {
    color: Colors.textSecondary,
    fontSize: Typography.caption.fontSize,
  },
  categoryStatus: {
    width: 24,
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
