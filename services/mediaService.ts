// Serviço de mídia - funções auxiliares + wrappers para downloadService
import type { MediaItem, SeriesItem } from '../types';
import {
    loadAllCachedCategories,
    loadCachedCategory,
    DOWNLOAD_CATEGORIES
} from './downloadService';

// Re-exportar categorias do downloadService
export const MEDIA_CATEGORIES = DOWNLOAD_CATEGORIES;

// Wrapper para loadCategory - usa o cache do downloadService
export async function loadCategory(categoryId: string, forceRefresh = false): Promise<MediaItem[]> {
    return loadCachedCategory(categoryId);
}

// Wrapper para loadInitialCategories - usa o cache do downloadService
export async function loadInitialCategories(forceRefresh = false): Promise<Map<string, MediaItem[]>> {
    return loadAllCachedCategories();
}

// Buscar mídia por nome
export function searchMedia(query: string, items: MediaItem[]): MediaItem[] {
    const normalized = query.toLowerCase().trim();
    if (!normalized) return items;

    return items.filter(item => {
        const title = item.tmdb?.title || item.name;
        return title.toLowerCase().includes(normalized);
    });
}

// Filtrar mídia
export function filterMedia(
    items: MediaItem[],
    type?: 'movie' | 'tv',
    genre?: string,
    year?: string,
): MediaItem[] {
    return items.filter(item => {
        if (type && item.type !== type) return false;
        if (genre && !item.tmdb?.genres?.includes(genre)) return false;
        if (year && item.tmdb?.year !== year) return false;
        return true;
    });
}

// Ordenar mídia
export function sortMedia(
    items: MediaItem[],
    by: 'rating' | 'year' | 'name' | 'popularity' = 'rating'
): MediaItem[] {
    return [...items].sort((a, b) => {
        switch (by) {
            case 'rating':
                return (b.tmdb?.rating || 0) - (a.tmdb?.rating || 0);
            case 'year':
                return (b.tmdb?.year || '0').localeCompare(a.tmdb?.year || '0');
            case 'name':
                return (a.tmdb?.title || a.name).localeCompare(b.tmdb?.title || b.name);
            case 'popularity':
                return (b.tmdb?.popularity || 0) - (a.tmdb?.popularity || 0);
            default:
                return 0;
        }
    });
}

// Obter todos os gêneros únicos
export function getAllGenres(items: MediaItem[]): string[] {
    const genres = new Set<string>();
    items.forEach(item => {
        item.tmdb?.genres?.forEach(g => genres.add(g));
    });
    return Array.from(genres).sort();
}

// Obter todos os anos únicos
export function getAllYears(items: MediaItem[]): string[] {
    const years = new Set<string>();
    items.forEach(item => {
        if (item.tmdb?.year) years.add(item.tmdb.year);
    });
    return Array.from(years).sort((a, b) => b.localeCompare(a));
}

// Buscar filmes/séries por ator
export function getMediaByActor(actorId: number, items: MediaItem[]): MediaItem[] {
    return items.filter(item =>
        item.tmdb?.cast?.some((c: any) => c.id === actorId)
    );
}

// Buscar item por ID
export async function getMediaById(id: string): Promise<MediaItem | null> {
    const allCategories = await loadAllCachedCategories();
    for (const items of Array.from(allCategories.values())) {
        const found = items.find((item: MediaItem) => item.id === id);
        if (found) return found;
    }
    return null;
}

// Buscar série por ID
export async function getSeriesById(id: string): Promise<SeriesItem | null> {
    // Séries são armazenadas junto com as outras mídias
    const item = await getMediaById(id);
    if (item && isSeries(item)) {
        return item as unknown as SeriesItem;
    }
    return null;
}

// Verificar se um item é série
export function isSeries(item: any): boolean {
    return item.episodes && Object.keys(item.episodes).length > 0;
}
