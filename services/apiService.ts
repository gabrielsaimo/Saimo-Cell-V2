// Serviço de API Supabase — substitui o streamingService baseado em JSON do GitHub
import type { MediaItem } from '../types';
import { Paths, File as FSFile, Directory } from 'expo-file-system';

const ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNmdW1heXBxaHh6anNzYXJteXJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MDU1ODUsImV4cCI6MjA4Nzk4MTU4NX0.Ff3DMipcepJuFXuhaXLsievmPG-Czu6FutHZJVxJTO8';
const BASE_URL = 'https://sfumaypqhxzjssarmyrn.supabase.co/rest/v1/rpc';

// ============================================================
// Tipos internos da API
// ============================================================

interface APITMDBSlim {
    id: number;
    title: string;
    year: string;
    rating: number;
    certification: string | null;
    poster: string;
    posterHD: string;
    backdrop: string;
    backdropHD: string;
}

interface APITMDBFull extends APITMDBSlim {
    originalTitle: string;
    overview: string;
    releaseDate: string;
    voteCount: number;
    genres: string[];
    directors: string[];
    cast: { id: number; name: string; character: string; photo: string | null }[];
}

interface APISlimItem {
    id: string;
    name: string;
    type: 'movie' | 'series';
    category: string;
    categoryLabel: string;
    isAdult: boolean;
    logo: string;
    totalSeasons: number | null;
    totalEpisodes: number | null;
    tmdb: APITMDBSlim;
}

interface APIFullItem extends Omit<APISlimItem, 'tmdb'> {
    url: string;
    active: boolean;
    tmdb: APITMDBFull;
    episodes?: {
        [season: string]: { id: string; episode: number; name: string; url: string; logo: string | null }[];
    };
}

interface APIHomeCategory {
    id: string;
    label: string;
    type: 'movie' | 'series';
    items: APISlimItem[];
}

interface APICatalogResult {
    items: APISlimItem[];
    total: number;
    page: number;
    totalPages: number;
}

export interface APICategories {
    movies: { id: string; label: string; count: number }[];
    series: { id: string; label: string; count: number }[];
}

// ============================================================
// Cache em disco — catálogo (TTL 12h)
// ============================================================

const CATALOG_DISK_TTL = 12 * 60 * 60 * 1000; // 12 horas
let _catalogDir: Directory | null = null;
let _catalogDiskReady = false;

interface CatalogDiskEntry {
    savedAt: number;
    categories: { id: string; items: MediaItem[] }[];
}

function getCatalogDir(): Directory {
    if (!_catalogDir) {
        _catalogDir = new Directory(Paths.document, 'catalog');
    }
    return _catalogDir;
}

function ensureCatalogDisk(): boolean {
    if (_catalogDiskReady) return true;
    try {
        const dir = getCatalogDir();
        if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
        _catalogDiskReady = true;
        return true;
    } catch {
        return false;
    }
}

// Controle de save agendado (evita múltiplos saves em sequência)
let _savePending = false;

function saveCatalogToDisk(): void {
    // Agrupa chamadas em 2s — salva apenas uma vez após o último trigger
    if (_savePending) return;
    _savePending = true;
    setTimeout(() => {
        _savePending = false;
        try {
            if (!ensureCatalogDisk() || HOME_CACHE.size === 0) return;
            // Limita a 20 itens por categoria para manter o arquivo pequeno (<300KB)
            const categories = Array.from(HOME_CACHE.entries()).map(([id, items]) => ({
                id,
                items: items.slice(0, 20),
            }));
            const entry: CatalogDiskEntry = { savedAt: Date.now(), categories };
            const file = new FSFile(getCatalogDir(), 'home.json');
            file.create({ overwrite: true });
            file.write(JSON.stringify(entry));
        } catch (e) {
            console.warn('[CatalogDisk] saveCatalogToDisk falhou:', e);
        }
    }, 2000); // 2s após o último trigger, fora do ciclo de render crítico
}

function loadCatalogFromDisk(): boolean {
    try {
        if (!ensureCatalogDisk()) return false;
        const file = new FSFile(getCatalogDir(), 'home.json');
        if (!file.exists || file.size === 0) return false;
        const raw = file.textSync();
        if (!raw || raw.length < 10) return false;
        const entry: CatalogDiskEntry = JSON.parse(raw);
        if (Date.now() - entry.savedAt > CATALOG_DISK_TTL) return false; // expirado
        for (const { id, items } of entry.categories) {
            HOME_CACHE.set(id, items);
        }
        console.log(`[CatalogDisk] Carregado do disco: ${HOME_CACHE.size} categorias`);
        return true;
    } catch (e) {
        console.warn('[CatalogDisk] loadCatalogFromDisk falhou:', e);
        return false;
    }
}

function clearCatalogDisk(): void {
    try {
        const dir = getCatalogDir();
        if (dir.exists) dir.delete();
        _catalogDiskReady = false;
    } catch (e) {
        console.warn('[CatalogDisk] clearCatalogDisk falhou:', e);
    }
}

// ============================================================
// Cache em memória
// ============================================================

// Cache de home: categoryId → items (dados slim normalizados)
const HOME_CACHE = new Map<string, MediaItem[]>();

// Cache de catálogo paginado: "categoryId-pN" → items
const CATALOG_CACHE = new Map<string, MediaItem[]>();

// Controle de paginação: categoryId → { totalPages, lastPage }
const CAT_PAGES = new Map<string, { totalPages: number; lastPage: number }>();

// Cache de itens completos: id → MediaItem (máx 10 — séries com episódios são pesadas)
const ITEM_CACHE = new Map<string, MediaItem>();
const ITEM_CACHE_MAX = 10;

// Categorias disponíveis (resultado do get_categories)
let _categories: APICategories | null = null;

// Flag de controle do background loading
let _stopBackground = false;

// ============================================================
// RPC helper — with in-flight dedup
// ============================================================

const _inflight = new Map<string, Promise<any>>();

async function rpc<T = any>(fn: string, body: Record<string, any> = {}): Promise<T> {
    const key = `${fn}:${JSON.stringify(body)}`;
    if (_inflight.has(key)) return _inflight.get(key)! as Promise<T>;

    const promise = fetch(`${BASE_URL}/${fn}`, {
        method: 'POST',
        headers: {
            apikey: ANON_KEY,
            Authorization: `Bearer ${ANON_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    })
        .then(res => {
            if (!res.ok) throw new Error(`[API] Erro ${res.status} em ${fn}`);
            return res.json() as Promise<T>;
        })
        .finally(() => _inflight.delete(key));

    _inflight.set(key, promise);
    return promise;
}

// ============================================================
// Normalização: formato da API → MediaItem
// ============================================================

function normalizeItem(obj: APISlimItem | APIFullItem): MediaItem {
    const full = obj as APIFullItem;
    const tmdbFull = obj.tmdb as APITMDBFull;
    return {
        id: obj.id,
        name: obj.name,
        url: full.url || '',
        category: obj.category,
        categoryLabel: obj.categoryLabel,
        // Normaliza 'series' → 'tv' para compatibilidade com o código existente
        type: obj.type === 'series' ? 'tv' : 'movie',
        isAdult: obj.isAdult,
        logo: obj.logo,
        totalSeasons: obj.totalSeasons ?? undefined,
        totalEpisodes: obj.totalEpisodes ?? undefined,
        episodes: full.episodes
            ? Object.fromEntries(
                Object.entries(full.episodes).map(([s, eps]) => [
                    s,
                    eps.map(e => ({ ...e, logo: e.logo ?? undefined })),
                ])
            )
            : undefined,
        tmdb: obj.tmdb
            ? {
                  id: obj.tmdb.id,
                  title: obj.tmdb.title || obj.name,
                  year: obj.tmdb.year || '',
                  rating: obj.tmdb.rating || 0,
                  certification: obj.tmdb.certification || undefined,
                  poster: obj.tmdb.poster || '',
                  posterHD: obj.tmdb.posterHD,
                  backdrop: obj.tmdb.backdrop,
                  backdropHD: obj.tmdb.backdropHD,
                  // Campos completos — só presentes em get_item
                  originalTitle: tmdbFull.originalTitle,
                  overview: tmdbFull.overview || '',
                  releaseDate: tmdbFull.releaseDate,
                  voteCount: tmdbFull.voteCount,
                  genres: tmdbFull.genres || [],
                  directors: tmdbFull.directors,
                  cast: tmdbFull.cast || [],
              }
            : undefined,
    };
}

// ============================================================
// Endpoints públicos da API
// ============================================================

/** get_home — tela inicial com categorias e seus itens slim */
export async function getHome(params: {
    p_type?: 'movie' | 'series' | null;
    p_limit?: number;
    p_order_by?: 'rating' | 'new' | 'name';
} = {}): Promise<APIHomeCategory[]> {
    return rpc<APIHomeCategory[]>('get_home', params);
}

/** get_catalog — catálogo paginado com filtros. Retorna itens já normalizados */
export async function getCatalog(params: {
    p_type?: 'movie' | 'series' | null;
    p_category?: string | null;
    p_page?: number;
    p_search?: string | null;
    p_actor?: string | null;
    p_order_by?: 'name' | 'rating' | 'new';
    p_is_adult?: boolean;
} = {}): Promise<{ items: MediaItem[]; total: number; page: number; totalPages: number }> {
    const data = await rpc<APICatalogResult>('get_catalog', params);
    return {
        ...data,
        items: data.items.map(normalizeItem),
    };
}

/** get_item — detalhes completos de um título (url, sinopse, elenco, episódios) */
export function invalidateItemCache(id: string): void {
    ITEM_CACHE.delete(id);
}

export async function getItemAPI(id: string): Promise<MediaItem> {
    if (ITEM_CACHE.has(id)) {
        // Move para o final do Map (LRU: mais recente = último)
        const hit = ITEM_CACHE.get(id)!;
        ITEM_CACHE.delete(id);
        ITEM_CACHE.set(id, hit);
        return hit;
    }
    const data = await rpc<APIFullItem>('get_item', { p_id: id });
    const item = normalizeItem(data);
    // Evicção LRU: remove o item mais antigo se estiver cheio
    if (ITEM_CACHE.size >= ITEM_CACHE_MAX) {
        const oldestKey = ITEM_CACHE.keys().next().value;
        if (oldestKey) ITEM_CACHE.delete(oldestKey);
    }
    ITEM_CACHE.set(id, item);
    return item;
}

/** get_categories — lista de categorias disponíveis com contagens */
export async function getCategories(): Promise<APICategories> {
    if (_categories) return _categories;
    _categories = await rpc<APICategories>('get_categories');
    return _categories;
}

/** get_filmography — filmografia paginada de um ator. Retorna itens já normalizados */
export async function getFilmography(params: {
    p_actor_id?: number;
    p_actor?: string;
    p_page?: number;
}): Promise<{ items: MediaItem[]; total: number; page: number; totalPages: number }> {
    const data = await rpc<APICatalogResult>('get_filmography', params);
    return {
        ...data,
        items: data.items.map(normalizeItem),
    };
}

// ============================================================
// Funções de compatibilidade (usadas por mediaService / movies.tsx)
// ============================================================

/**
 * Carrega todos os previews da home e popula o HOME_CACHE.
 * Substitui loadAllPreviews do streamingService.
 * Retorna Map<categoryId, items>
 */
export async function loadAllPreviews(): Promise<Map<string, MediaItem[]>> {
    // Helper para injetar a categoria adulto
    const ensureAdultCategory = async (resultMap: Map<string, MediaItem[]>) => {
        if (!HOME_CACHE.has('adulto')) {
            try {
                const adultData = await getCatalog({ p_category: 'adulto', p_page: 1, p_is_adult: true });
                if (adultData.items && adultData.items.length > 0) {
                    const items = adultData.items.slice(0, 20);
                    HOME_CACHE.set('adulto', items);
                    resultMap.set('adulto', items);
                    saveCatalogToDisk();
                }
            } catch (e) {
                console.warn('[API] Falha ao carregar categoria adulto:', e);
            }
        }
    };

    // 1. Cache em memória (mais rápido)
    if (HOME_CACHE.size > 0) {
        const resultMap = new Map(HOME_CACHE);
        await ensureAdultCategory(resultMap);
        return resultMap;
    }

    // 2. Cache em disco (persiste entre sessões, TTL 12h)
    if (loadCatalogFromDisk() && HOME_CACHE.size > 0) {
        const resultMap = new Map(HOME_CACHE);
        await ensureAdultCategory(resultMap);
        return resultMap;
    }

    // 3. Busca na API Supabase
    const apiCategories = await getHome({ p_limit: 20, p_order_by: 'rating' });
    const result = new Map<string, MediaItem[]>();

    for (const cat of apiCategories) {
        const items = cat.items.map(normalizeItem);
        HOME_CACHE.set(cat.id, items);
        result.set(cat.id, items);
    }

    await ensureAdultCategory(result);

    // Salva em disco para próxima sessão
    saveCatalogToDisk();
    return result;
}

/**
 * Busca uma página de uma categoria via get_catalog.
 * Popula HOME_CACHE e CATALOG_CACHE.
 */
export async function fetchCategoryPage(
    categoryId: string,
    page: number,
): Promise<MediaItem[]> {
    const cacheKey = `${categoryId}-p${page}`;
    if (CATALOG_CACHE.has(cacheKey)) return CATALOG_CACHE.get(cacheKey)!;

    try {
        const data = await getCatalog({ p_category: categoryId, p_page: page, p_is_adult: true });
        CATALOG_CACHE.set(cacheKey, data.items);

        // Atualiza cache consolidado da categoria
        const existing = HOME_CACHE.get(categoryId) || [];
        HOME_CACHE.set(categoryId, deduplicateById([...existing, ...data.items]));

        CAT_PAGES.set(categoryId, { totalPages: data.totalPages, lastPage: page });
        return data.items;
    } catch (e) {
        console.warn(`[API] fetchCategoryPage falhou ${categoryId}-p${page}:`, e);
        return [];
    }
}

/** Retorna todos os itens carregados de uma categoria */
export function getCategoryItems(categoryId: string): MediaItem[] {
    return HOME_CACHE.get(categoryId) || [];
}

/** Verifica se há mais páginas para uma categoria */
export function categoryHasMore(categoryId: string): boolean {
    const pages = CAT_PAGES.get(categoryId);
    if (!pages) return true;
    return pages.lastPage < pages.totalPages;
}

/** Carrega a próxima página de uma categoria */
export async function loadNextPage(categoryId: string): Promise<{
    items: MediaItem[];
    hasMore: boolean;
}> {
    const pages = CAT_PAGES.get(categoryId);
    if (pages && pages.lastPage >= pages.totalPages) {
        return { items: HOME_CACHE.get(categoryId) || [], hasMore: false };
    }
    const nextPage = pages ? pages.lastPage + 1 : 2;
    await fetchCategoryPage(categoryId, nextPage);
    return {
        items: HOME_CACHE.get(categoryId) || [],
        hasMore: categoryHasMore(categoryId),
    };
}

/** Busca nos itens carregados na home (cache em memória) */
export function searchInLoadedData(query: string): MediaItem[] {
    const normalized = query.toLowerCase().trim();
    if (!normalized) return [];

    const results: MediaItem[] = [];
    const seen = new Set<string>();

    HOME_CACHE.forEach(items => {
        for (const item of items) {
            if (seen.has(item.id)) continue;
            const title = (item.tmdb?.title || item.name).toLowerCase();
            if (title.includes(normalized)) {
                results.push(item);
                seen.add(item.id);
            }
        }
    });
    return results;
}

/** Snapshot de todas as categorias carregadas */
export function getAllLoadedCategories(): Map<string, MediaItem[]> {
    return new Map(HOME_CACHE);
}

/** Total de itens em memória */
export function getTotalLoadedCount(): number {
    let count = 0;
    HOME_CACHE.forEach(items => { count += items.length; });
    return count;
}

/** Limpa todos os caches em memória e em disco */
export function clearAllCaches(): void {
    HOME_CACHE.clear();
    CATALOG_CACHE.clear();
    CAT_PAGES.clear();
    ITEM_CACHE.clear();
    _categories = null;
    _stopBackground = false;
    clearCatalogDisk();
}

/** Sinaliza para parar o background loading */
export async function stopLoading(): Promise<void> {
    _stopBackground = true;
}

/**
 * Carrega uma página adicional de cada categoria em background.
 * Muito mais simples do que o streamingService (sem disco, sem múltiplas páginas).
 */
export async function startBackgroundLoading(
    onNewData?: () => void,
): Promise<void> {
    _stopBackground = false;
    const categoryIds = Array.from(HOME_CACHE.keys());
    let loaded = 0;
    const BATCH_SIZE = 4; // notifica a UI a cada 4 categorias carregadas (reduz re-renders)

    for (const categoryId of categoryIds) {
        if (_stopBackground) break;
        if (!categoryHasMore(categoryId)) continue;

        try {
            await fetchCategoryPage(categoryId, 2);
            loaded++;
            // Notifica em lotes em vez de após cada categoria
            if (onNewData && loaded % BATCH_SIZE === 0) onNewData();
            await new Promise(r => setTimeout(r, 150)); // 150ms entre categorias
        } catch {
            // Continua mesmo com erro em uma categoria
        }
    }

    // Notificação final e salvamento em disco
    if (loaded > 0 && !_stopBackground) {
        if (onNewData) onNewData();
        saveCatalogToDisk();
    }
}

// ============================================================
// Helpers internos
// ============================================================

function deduplicateById(items: MediaItem[]): MediaItem[] {
    const seen = new Set<string>();
    return items.filter(item => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
    });
}
