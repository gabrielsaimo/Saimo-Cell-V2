// Serviço de streaming online - carrega dados sob demanda via fetch
// Substitui o downloadService.ts - sem downloads, tudo online
import type { MediaItem } from '../types';

const GITHUB_BASE = 'https://raw.githubusercontent.com/gabrielsaimo/free-tv/main/public/data/enriched/';

// Cache em memória por página: "categoryId-pN" → items
const PAGE_CACHE = new Map<string, MediaItem[]>();

// Cache consolidado por categoria: categoryId → todos items carregados
const CATEGORY_CACHE = new Map<string, MediaItem[]>();

// Controle de última página por categoria
const LAST_PAGE = new Map<string, number>(); // última página conhecida
const HAS_MORE = new Map<string, boolean>(); // se há mais páginas

// Número de categorias carregadas em paralelo
export const PARALLEL_BATCH_SIZE = 4; // Reduzido para mostrar itens mais rápido

// TODAS as categorias
export const CATEGORIES = [
    { id: 'acao', name: 'Ação' },
    { id: 'amc-plus', name: 'AMC+' },
    { id: 'animacao', name: 'Animação' },
    { id: 'apple-tv', name: 'Apple TV+' },
    { id: 'aventura', name: 'Aventura' },
    { id: 'brasil-paralelo', name: 'Brasil Paralelo' },
    { id: 'cinema', name: 'Cinema' },
    { id: 'claro-video', name: 'Claro Vídeo' },
    { id: 'comedia', name: 'Comédia' },
    { id: 'crime', name: 'Crime' },
    { id: 'crunchyroll', name: 'Crunchyroll' },
    { id: 'cursos', name: 'Cursos' },
    { id: 'directv', name: 'DirecTV' },
    { id: 'discovery', name: 'Discovery' },
    { id: 'disney', name: 'Disney+' },
    { id: 'docu', name: 'Documentários (Séries)' },
    { id: 'documentario', name: 'Documentários' },
    { id: 'doramas', name: 'Doramas' },
    { id: 'drama', name: 'Drama' },
    { id: 'dublagem-nao-oficial', name: 'Dublagem Não Oficial' },
    { id: 'especial-infantil', name: 'Especial Infantil' },
    { id: 'esportes', name: 'Esportes' },
    { id: 'familia', name: 'Família' },
    { id: 'fantasia', name: 'Fantasia' },
    { id: 'faroeste', name: 'Faroeste' },
    { id: 'ficcao-cientifica', name: 'Ficção Científica' },
    { id: 'funimation-now', name: 'Funimation' },
    { id: 'globoplay', name: 'Globoplay' },
    { id: 'guerra', name: 'Guerra' },
    { id: 'hot-adultos-bella-da-semana', name: 'Adultos - Bella da Semana' },
    { id: 'hot-adultos-legendado', name: 'Adultos - Legendado' },
    { id: 'hot-adultos', name: 'Adultos' },
    { id: 'lancamentos', name: 'Lançamentos' },
    { id: 'legendadas', name: 'Séries Legendadas' },
    { id: 'legendados', name: 'Filmes Legendados' },
    { id: 'lionsgate', name: 'Lionsgate' },
    { id: 'max', name: 'Max' },
    { id: 'nacionais', name: 'Nacionais' },
    { id: 'netflix', name: 'Netflix' },
    { id: 'novelas-turcas', name: 'Novelas Turcas' },
    { id: 'novelas', name: 'Novelas' },
    { id: 'oscar-2025', name: 'Oscar 2025' },
    { id: 'outras-produtoras', name: 'Outras Produtoras' },
    { id: 'outros', name: 'Outros' },
    { id: 'outros_filmes', name: 'Outros Filmes' },
    { id: 'paramount', name: 'Paramount+' },
    { id: 'plutotv', name: 'Pluto TV' },
    { id: 'prime-video', name: 'Prime Video' },
    { id: 'programas-de-tv', name: 'Programas de TV' },
    { id: 'religiosos', name: 'Religiosos' },
    { id: 'romance', name: 'Romance' },
    { id: 'sbt', name: 'SBT' },
    { id: 'shows', name: 'Shows' },
    { id: 'stand-up-comedy', name: 'Stand Up Comedy' },
    { id: 'star', name: 'Star+' },
    { id: 'sugestao-da-semana', name: 'Sugestão da Semana' },
    { id: 'suspense', name: 'Suspense' },
    { id: 'terror', name: 'Terror' },
    { id: 'uhd-4k', name: 'UHD 4K' },
    { id: 'univer', name: 'Univer' },
];

// ============================================================
// Funções de fetch
// ============================================================

/**
 * Busca uma página específica de uma categoria
 * Retorna array vazio se a página não existir (404)
 */
export async function fetchCategoryPage(
    categoryId: string,
    page: number
): Promise<MediaItem[]> {
    const cacheKey = `${categoryId}-p${page}`;

    // Cache hit
    if (PAGE_CACHE.has(cacheKey)) {
        return PAGE_CACHE.get(cacheKey)!;
    }

    try {
        const url = `${GITHUB_BASE}${categoryId}-p${page}.json`;
        const response = await fetch(url);

        if (!response.ok) {
            // 404 = não há mais páginas
            HAS_MORE.set(categoryId, false);
            return [];
        }

        const data = await response.json();

        if (!Array.isArray(data) || data.length === 0) {
            HAS_MORE.set(categoryId, false);
            return [];
        }

        // Processar itens (manter apenas campos essenciais)
        const items: MediaItem[] = data.map((obj: any, index: number) => createMediaItem(obj, index));

        // Cachear a página
        PAGE_CACHE.set(cacheKey, items);

        // Atualizar cache consolidado
        const existing = CATEGORY_CACHE.get(categoryId) || [];
        const merged = deduplicateItems([...existing, ...items]);
        CATEGORY_CACHE.set(categoryId, merged);

        // Atualizar controle de páginas
        const currentLast = LAST_PAGE.get(categoryId) || 0;
        if (page > currentLast) {
            LAST_PAGE.set(categoryId, page);
        }

        // Se retornou menos que 50, provavelmente é a última
        if (items.length < 50) {
            HAS_MORE.set(categoryId, false);
        } else {
            HAS_MORE.set(categoryId, true);
        }

        return items;

    } catch (error: any) {
        console.warn(`[StreamingService] Erro em ${categoryId}-p${page}:`, error.message);
        // Em caso de erro de rede, não marca como sem mais páginas
        return [];
    }
}

/**
 * Carrega a primeira página (preview) de todas as categorias
 * Usado na tela inicial - carrega em batches paralelos
 */
export async function loadAllPreviews(): Promise<Map<string, MediaItem[]>> {
    const result = new Map<string, MediaItem[]>();

    for (let i = 0; i < CATEGORIES.length; i += PARALLEL_BATCH_SIZE) {
        const batch = CATEGORIES.slice(i, i + PARALLEL_BATCH_SIZE);

        const batchResults = await Promise.all(
            batch.map(async (cat) => {
                // Se já tem no cache, retorna
                if (CATEGORY_CACHE.has(cat.id)) {
                    return { id: cat.id, items: CATEGORY_CACHE.get(cat.id)! };
                }
                const items = await fetchCategoryPage(cat.id, 1);
                return { id: cat.id, items };
            })
        );

        for (const { id, items } of batchResults) {
            if (items.length > 0) {
                result.set(id, items);
            }
        }
    }

    return result;
}

/**
 * Carrega a próxima página de uma categoria
 * Retorna todos os itens acumulados (não apenas os novos)
 */
export async function loadNextPage(categoryId: string): Promise<{
    items: MediaItem[];
    hasMore: boolean;
}> {
    const currentPage = LAST_PAGE.get(categoryId) || 1;
    const nextPage = currentPage + 1;

    // Verificar se já sabemos que não tem mais
    if (HAS_MORE.get(categoryId) === false) {
        return {
            items: CATEGORY_CACHE.get(categoryId) || [],
            hasMore: false,
        };
    }

    const newItems = await fetchCategoryPage(categoryId, nextPage);

    return {
        items: CATEGORY_CACHE.get(categoryId) || [],
        hasMore: HAS_MORE.get(categoryId) !== false,
    };
}

/**
 * Obtém todos os itens carregados de uma categoria
 */
export function getCategoryItems(categoryId: string): MediaItem[] {
    return CATEGORY_CACHE.get(categoryId) || [];
}

/**
 * Verifica se uma categoria tem mais páginas para carregar
 */
export function categoryHasMore(categoryId: string): boolean {
    return HAS_MORE.get(categoryId) !== false;
}

/**
 * Carrega todas as páginas de uma categoria (para busca completa)
 * Use com cuidado - carrega tudo na memória
 */
export async function loadAllPagesForCategory(categoryId: string): Promise<MediaItem[]> {
    let page = LAST_PAGE.get(categoryId) || 1;

    // Se p1 não foi carregada ainda, começar do 1
    if (!PAGE_CACHE.has(`${categoryId}-p1`)) {
        page = 1;
    } else {
        page = page + 1; // começar da próxima não carregada
    }

    while (HAS_MORE.get(categoryId) !== false) {
        const items = await fetchCategoryPage(categoryId, page);
        if (items.length === 0) break;
        page++;
    }

    return CATEGORY_CACHE.get(categoryId) || [];
}

/**
 * Busca em todas as categorias carregadas em memória
 */
export function searchInLoadedData(query: string): MediaItem[] {
    const normalized = query.toLowerCase().trim();
    if (!normalized) return [];

    const results: MediaItem[] = [];
    const seen = new Set<string>();

    CATEGORY_CACHE.forEach((items) => {
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

// ============================================================
// Cache management
// ============================================================

/**
 * Limpa todo o cache em memória
 */
HAS_MORE.clear();
}

/**
 * Inicia o carregamento em segundo plano de TODAS as páginas restantes.
 * Executa sequencialmente com delay para não travar a UI.
 */
let isBackgroundLoading = false;
let stopBackgroundLoading = false;

export async function stopLoading() {
    stopBackgroundLoading = true;
}

export async function startBackgroundLoading(
    onNewData?: () => void
): Promise<void> {
    if (isBackgroundLoading) return;
    isBackgroundLoading = true;
    stopBackgroundLoading = false;

    console.log('[BackgroundLoad] Iniciando carregamento profundo...');

    // Iterar por todas as categorias
    for (const cat of CATEGORIES) {
        if (stopBackgroundLoading) break;

        // Enquanto houver mais páginas nesta categoria...
        while (HAS_MORE.get(cat.id) !== false && !stopBackgroundLoading) {
            // Verificar se temos a próxima página no cache
            const currentPage = LAST_PAGE.get(cat.id) || 1;
            const nextPage = currentPage + 1;
            const key = `${cat.id}-p${nextPage}`;

            if (PAGE_CACHE.has(key)) {
                // Já tem, passa pra próxima
                continue;
            }

            try {
                // Carregar próxima página
                const newItems = await fetchCategoryPage(cat.id, nextPage);

                if (newItems.length > 0) {
                    // Notificar UI que tem dados novos (para busca)
                    if (onNewData) onNewData();

                    // Pequeno delay para respirar a thread JS
                    await new Promise(resolve => setTimeout(resolve, 500));
                } else {
                    // Se veio vazio, break o loop dessa categoria (HAS_MORE já foi setado false pelo fetch)
                    break;
                }
            } catch (err) {
                // Erro silencioso no background
                break;
            }
        }

        // Delay entre categorias
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    isBackgroundLoading = false;
    console.log('[BackgroundLoad] Finalizado.');
}

// ============================================================
// Helpers
// ============================================================

function createMediaItem(obj: any, index: number): MediaItem {
    return {
        id: obj.id || `item-${index}`,
        name: obj.name || 'Sem título',
        url: obj.url || '',
        category: obj.category || '',
        type: obj.type || 'movie',
        isAdult: obj.isAdult || false,
        episodes: obj.episodes,
        tmdb: obj.tmdb ? {
            id: obj.tmdb.id,
            imdbId: obj.tmdb.imdbId,
            title: obj.tmdb.title || obj.name || 'Sem título',
            originalTitle: obj.tmdb.originalTitle,
            tagline: obj.tmdb.tagline,
            overview: obj.tmdb.overview?.slice(0, 300) || '',
            status: obj.tmdb.status,
            language: obj.tmdb.language,
            releaseDate: obj.tmdb.releaseDate,
            year: obj.tmdb.year || '',
            runtime: obj.tmdb.runtime,
            rating: obj.tmdb.rating || 0,
            voteCount: obj.tmdb.voteCount,
            popularity: obj.tmdb.popularity,
            certification: obj.tmdb.certification,
            genres: obj.tmdb.genres?.slice(0, 3) || [],
            poster: obj.tmdb.poster || '',
            posterHD: obj.tmdb.posterHD,
            backdrop: obj.tmdb.backdrop,
            backdropHD: obj.tmdb.backdropHD,
            logo: obj.tmdb.logo,
            cast: obj.tmdb.cast?.slice(0, 10) || [],
        } : undefined,
    };
}

function deduplicateItems(items: MediaItem[]): MediaItem[] {
    const map = new Map<string, MediaItem>();
    for (const item of items) {
        const key = item.tmdb?.id?.toString() || item.id;
        if (!map.has(key)) {
            map.set(key, item);
        } else if (item.type === 'tv' && item.episodes) {
            // Mesclar episódios de séries
            const existing = map.get(key)!;
            if (existing.episodes && item.episodes) {
                Object.keys(item.episodes).forEach(season => {
                    if (!existing.episodes![season]) {
                        existing.episodes![season] = item.episodes![season];
                    } else {
                        const existingEps = existing.episodes![season];
                        const newEps = item.episodes![season];
                        newEps.forEach(ep => {
                            if (!existingEps.some(e => e.episode === ep.episode)) {
                                existingEps.push(ep);
                            }
                        });
                        existingEps.sort((a, b) => a.episode - b.episode);
                    }
                });
            }
        }
    }
    return Array.from(map.values());
}
