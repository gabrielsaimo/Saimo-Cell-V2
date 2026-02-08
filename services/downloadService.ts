// Serviço de download de mídia - ULTRA OTIMIZADO
// Usa expo-file-system para armazenamento
// Downloads sequenciais para estabilidade, processamento otimizado
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MediaItem } from '../types';

const GITHUB_BASE = 'https://raw.githubusercontent.com/gabrielsaimo/free-tv/main/public/data/enriched/';
const CACHE_DIR = FileSystem.documentDirectory + 'media_cache/';

// Limite de itens por categoria (para manter performance)
const MAX_ITEMS_PER_CATEGORY = 9999;

// TODAS as categorias
export const DOWNLOAD_CATEGORIES = [
    { id: 'globoplay', name: 'Globoplay', sizeMB: 15 },
    { id: 'crunchyroll', name: 'Crunchyroll', sizeMB: 18 },
    { id: 'max', name: 'Max', sizeMB: 19 },
    { id: 'documentario', name: '📚 Documentário', sizeMB: 20 },
    { id: 'disney', name: 'Disney+', sizeMB: 23 },
    { id: 'terror', name: '👻 Terror', sizeMB: 36 },
    { id: 'prime-video', name: 'Prime Video', sizeMB: 27 },
    { id: 'suspense', name: '🔍 Suspense', sizeMB: 30 },
    { id: 'romance', name: '💕 Romance', sizeMB: 35 },
    { id: 'animacao', name: '🎨 Animação', sizeMB: 40 },
    { id: 'comedia', name: '😂 Comédia', sizeMB: 63 },
    { id: 'drama', name: '🎭 Drama', sizeMB: 55 },
    { id: 'netflix', name: 'Netflix', sizeMB: 60 },
    { id: 'acao', name: '💥 Ação', sizeMB: 65 },
];

export type DownloadCallback = (
    categoryId: string,
    progress: number,
    status: 'downloading' | 'processing' | 'completed' | 'error',
    itemCount?: number,
    bytesDownloaded?: number
) => void;

// Garantir que o diretório existe
async function ensureCacheDir() {
    const dirInfo = await FileSystem.getInfoAsync(CACHE_DIR);
    if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
    }
}

// Caminho do cache
function getCachePath(categoryId: string): string {
    return CACHE_DIR + categoryId + '.json';
}

// Baixar categoria - OTIMIZADO
export async function downloadCategory(
    categoryId: string,
    onProgress?: DownloadCallback
): Promise<MediaItem[]> {
    onProgress?.(categoryId, 0, 'downloading');

    try {
        await ensureCacheDir();

        const cachePath = getCachePath(categoryId);

        // Verificar cache primeiro
        const cacheInfo = await FileSystem.getInfoAsync(cachePath);
        if (cacheInfo.exists) {
            try {
                const cached = await FileSystem.readAsStringAsync(cachePath);
                const items = JSON.parse(cached) as MediaItem[];
                onProgress?.(categoryId, 100, 'completed', items.length);
                return items;
            } catch (e) {
                await FileSystem.deleteAsync(cachePath, { idempotent: true });
            }
        }

        const url = `${GITHUB_BASE}${categoryId}.json`;
        const tempPath = CACHE_DIR + categoryId + '_temp.json';

        onProgress?.(categoryId, 5, 'downloading');

        // Baixar arquivo
        const downloadResumable = FileSystem.createDownloadResumable(
            url,
            tempPath,
            {},
            (progress) => {
                const percent = Math.round(
                    (progress.totalBytesWritten / progress.totalBytesExpectedToWrite) * 60
                );
                onProgress?.(categoryId, 5 + percent, 'downloading', undefined, progress.totalBytesWritten);
            }
        );

        const result = await downloadResumable.downloadAsync();

        if (!result || result.status !== 200) {
            throw new Error(`Download falhou: ${result?.status}`);
        }

        // Verificar arquivo temp
        const tempInfo = await FileSystem.getInfoAsync(tempPath);
        if (!tempInfo.exists) {
            throw new Error('Arquivo temporário não encontrado');
        }

        const fileSize = (tempInfo as any).size || 0;

        onProgress?.(categoryId, 70, 'processing');

        // Processar - estratégia baseada no tamanho
        let items: MediaItem[];

        if (fileSize < 15 * 1024 * 1024) {
            // Arquivos pequenos (< 15MB): ler tudo de uma vez
            items = await extractItemsFast(tempPath, MAX_ITEMS_PER_CATEGORY);
        } else {
            // Arquivos grandes: ler em chunks maiores (4MB)
            items = await extractItemsChunked(tempPath, MAX_ITEMS_PER_CATEGORY);
        }

        onProgress?.(categoryId, 95, 'processing');

        // Salvar cache apenas itens (muito menor que arquivo original)
        if (items.length > 0) {
            await FileSystem.writeAsStringAsync(cachePath, JSON.stringify(items));
        }

        // Remover temp
        await FileSystem.deleteAsync(tempPath, { idempotent: true });

        onProgress?.(categoryId, 100, 'completed', items.length);

        return items;

    } catch (error: any) {
        console.warn(`[DownloadService] Erro em ${categoryId}:`, error.message);
        onProgress?.(categoryId, 0, 'error');
        return [];
    }
}

// Extração RÁPIDA para arquivos pequenos - lê tudo de uma vez
async function extractItemsFast(filePath: string, maxItems: number): Promise<MediaItem[]> {
    try {
        // Ler arquivo inteiro
        const content = await FileSystem.readAsStringAsync(filePath);

        // Parse rápido
        const items: MediaItem[] = [];
        let depth = 0;
        let inString = false;
        let escape = false;
        let objectStart = -1;
        let arrayStarted = false;

        for (let i = 0; i < content.length && items.length < maxItems; i++) {
            const char = content[i];

            if (escape) { escape = false; continue; }
            if (char === '\\' && inString) { escape = true; continue; }
            if (char === '"') { inString = !inString; continue; }
            if (inString) continue;
            if (char === '[' && !arrayStarted) { arrayStarted = true; continue; }

            if (char === '{') {
                if (depth === 0) objectStart = i;
                depth++;
            } else if (char === '}') {
                depth--;
                if (depth === 0 && objectStart !== -1) {
                    try {
                        const obj = JSON.parse(content.slice(objectStart, i + 1));
                        items.push(createMediaItem(obj, items.length));
                    } catch (e) { /* skip */ }
                    objectStart = -1;
                }
            }
        }

        return items;
    } catch (e) {
        return [];
    }
}

// Extração em chunks para arquivos grandes (4MB por chunk)
async function extractItemsChunked(filePath: string, maxItems: number): Promise<MediaItem[]> {
    const items: MediaItem[] = [];

    try {
        const fileInfo = await FileSystem.getInfoAsync(filePath);
        if (!fileInfo.exists) return [];

        const fileSize = (fileInfo as any).size || 0;
        const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB - chunks maiores = menos I/O

        let position = 0;
        let buffer = '';
        let depth = 0;
        let inString = false;
        let escape = false;
        let objectStart = -1;
        let bufferOffset = 0;
        let arrayStarted = false;

        while (position < fileSize && items.length < maxItems) {
            const readSize = Math.min(CHUNK_SIZE, fileSize - position);

            // Ler chunk
            const base64 = await FileSystem.readAsStringAsync(filePath, {
                encoding: FileSystem.EncodingType.Base64,
                position,
                length: readSize,
            });

            const text = atob(base64);
            buffer += text;
            position += readSize;

            // Parse
            for (let i = 0; i < buffer.length && items.length < maxItems; i++) {
                const char = buffer[i];

                if (escape) { escape = false; continue; }
                if (char === '\\' && inString) { escape = true; continue; }
                if (char === '"') { inString = !inString; continue; }
                if (inString) continue;
                if (char === '[' && !arrayStarted) { arrayStarted = true; continue; }

                if (char === '{') {
                    if (depth === 0) objectStart = bufferOffset + i;
                    depth++;
                } else if (char === '}') {
                    depth--;
                    if (depth === 0 && objectStart !== -1) {
                        const start = objectStart - bufferOffset;
                        if (start >= 0) {
                            try {
                                const obj = JSON.parse(buffer.slice(start, i + 1));
                                items.push(createMediaItem(obj, items.length));
                            } catch (e) { /* skip */ }
                        }
                        objectStart = -1;
                    }
                }
            }

            // Limpar buffer
            if (objectStart === -1) {
                bufferOffset += buffer.length;
                buffer = '';
            } else {
                const keepFrom = Math.max(0, objectStart - bufferOffset);
                buffer = buffer.slice(keepFrom);
                bufferOffset += keepFrom;
            }
        }
    } catch (e) {
        // Silently fail
    }

    return items;
}

// Criar MediaItem - apenas campos essenciais
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

// Baixar todas - SEQUENCIAL mas otimizado
export async function downloadAllCategories(
    onProgress?: DownloadCallback,
    onOverallProgress?: (current: number, total: number) => void
): Promise<Map<string, MediaItem[]>> {
    const result = new Map<string, MediaItem[]>();

    for (let i = 0; i < DOWNLOAD_CATEGORIES.length; i++) {
        const cat = DOWNLOAD_CATEGORIES[i];
        onOverallProgress?.(i, DOWNLOAD_CATEGORIES.length);

        try {
            const items = await downloadCategory(cat.id, onProgress);
            if (items.length > 0) {
                result.set(cat.id, items);
            }
        } catch (e) {
            console.warn(`[DownloadService] Falha em ${cat.id}`);
        }

        // Pausa mínima para GC
        await new Promise(resolve => setTimeout(resolve, 50));
    }

    onOverallProgress?.(DOWNLOAD_CATEGORIES.length, DOWNLOAD_CATEGORIES.length);
    return result;
}

// Verificar categorias baixadas
export async function getDownloadedCategories(): Promise<Set<string>> {
    const downloaded = new Set<string>();

    try {
        await ensureCacheDir();
        const files = await FileSystem.readDirectoryAsync(CACHE_DIR);

        for (const file of files) {
            if (file.endsWith('.json') && !file.includes('_temp')) {
                downloaded.add(file.replace('.json', ''));
            }
        }
    } catch (e) { /* ignore */ }

    return downloaded;
}

// Carregar categoria do cache
export async function loadCachedCategory(categoryId: string): Promise<MediaItem[]> {
    try {
        const cachePath = getCachePath(categoryId);
        const info = await FileSystem.getInfoAsync(cachePath);

        if (info.exists) {
            const cached = await FileSystem.readAsStringAsync(cachePath);
            return JSON.parse(cached) as MediaItem[];
        }
    } catch (e) { /* ignore */ }
    return [];
}

// Carregar todas do cache
export async function loadAllCachedCategories(): Promise<Map<string, MediaItem[]>> {
    const result = new Map<string, MediaItem[]>();

    for (const cat of DOWNLOAD_CATEGORIES) {
        const items = await loadCachedCategory(cat.id);
        if (items.length > 0) {
            result.set(cat.id, items);
        }
    }

    return result;
}

// Limpar downloads
export async function clearAllDownloads(): Promise<void> {
    try {
        const dirInfo = await FileSystem.getInfoAsync(CACHE_DIR);
        if (dirInfo.exists) {
            await FileSystem.deleteAsync(CACHE_DIR, { idempotent: true });
        }
        await AsyncStorage.removeItem('@saimo_download_complete');
        await AsyncStorage.removeItem('@saimo_first_check_done');
    } catch (e) { /* ignore */ }
}

// Verificar se há dados
export async function hasDownloadedData(): Promise<boolean> {
    try {
        return (await getDownloadedCategories()).size > 0;
    } catch (e) {
        return false;
    }
}
