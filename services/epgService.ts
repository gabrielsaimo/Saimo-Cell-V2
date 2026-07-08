// EPG Service — Robust, instant cache load, auto-reload, guaranteed to work

import type { Program, CurrentProgram } from '../types';
import { Paths, File as FSFile, Directory } from 'expo-file-system';

const EPG_XML_URL = 'https://iptv-epg.org/files/epg-br.xml';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

// State
let loadState: 'idle' | 'loading' | 'loaded' | 'error' = 'idle';
let loadError: string | null = null;
let loadProgress: number = 0;
let isLoadingLocked = false;

// Data
const channelPrograms = new Map<string, Program[]>();
const nameIndex = new Map<string, string>();
const resolvedIds = new Map<string, string | null>();

// Registry
const appChannelNames = new Map<string, string>();
let needsReload = true;
let hasRegisteredChannels = false;
let initCalled = false;

// Listeners
type ProgressCallback = (progress: number, loaded: number, total: number) => void;
const progressListeners = new Set<ProgressCallback>();

type UpdateCallback = (appId: string) => void;
const updateListeners = new Set<UpdateCallback>();

type EPGState = 'idle' | 'loading' | 'loaded' | 'error';
type StateCallback = (state: EPGState) => void;
const stateListeners = new Set<StateCallback>();

function setState(s: EPGState): void {
    if (loadState === s) return;
    loadState = s;
    stateListeners.forEach(l => l(s));
}

// ─── Public State ─────────────────────────────────────────────────────────────

export function getEPGState(): string { return loadState; }
export function getEPGError(): string | null { return loadError; }
export function getEPGProgress(): number { return loadProgress; }
export function isEPGLoading(): boolean { return loadState === 'loading'; }
export function isEPGLoaded(): boolean { return loadState === 'loaded'; }

export function onEPGProgress(callback: ProgressCallback): () => void {
    progressListeners.add(callback);
    callback(loadProgress, channelPrograms.size, appChannelNames.size);
    return () => progressListeners.delete(callback);
}

export function onEPGUpdate(callback: UpdateCallback): () => void {
    updateListeners.add(callback);
    return () => { updateListeners.delete(callback); };
}

export function onEPGStateChange(callback: StateCallback): () => void {
    stateListeners.add(callback);
    callback(loadState);
    return () => { stateListeners.delete(callback); };
}

function notifyUpdate(): void {
    if (updateListeners.size === 0) return;
    for (const appId of appChannelNames.keys()) {
        const xmlId = resolvedIds.get(appId);
        if (xmlId && (channelPrograms.get(xmlId)?.length ?? 0) > 0) {
            updateListeners.forEach(l => l(appId));
        }
    }
}

// ─── Channel Registration ─────────────────────────────────────────────────────

export function registerChannel(appId: string, name: string): void {
    appChannelNames.set(appId, name);
    resolvedIds.delete(appId);
    needsReload = true;
    hasRegisteredChannels = true;

    console.log(`[EPG] Registered: ${name} (${appId}) - total: ${appChannelNames.size}`);

    // If EPG was already loaded, trigger reload with new channels
    if (loadState === 'loaded') {
        console.log('[EPG] Channel registered after load, triggering reload...');
        setState('idle');
        loadFromCacheOrFetch();
    } else if (initCalled && loadState === 'idle') {
        // If init was called but nothing loaded yet, trigger now
        console.log('[EPG] Init was called, loading now...');
        loadFromCacheOrFetch();
    }
}

export function registerEpgAlias(_c: string, _e: string): void {}

// ─── Disk Cache ───────────────────────────────────────────────────────────────

function getCacheFile(): FSFile {
    const dir = new Directory(Paths.document, 'epg_xmltv');
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    return new FSFile(dir, 'epg-br.xml');
}

function readCachedSync(): string | null {
    try {
        const file = getCacheFile();
        if (!file.exists) {
            console.log('[EPG] Cache file does not exist');
            return null;
        }
        if (file.size < 1000) {
            console.log('[EPG] Cache file too small:', file.size);
            return null;
        }
        const raw = file.textSync();
        const m = raw.match(/<!--fetchTime:(\d+)-->/);
        if (!m) {
            console.log('[EPG] Cache file missing timestamp');
            return null;
        }
        const fetchTime = parseInt(m[1]);
        const age = Date.now() - fetchTime;
        if (age >= CACHE_TTL_MS) {
            console.log(`[EPG] Cache expired (${Math.floor(age / 3600000)}h old)`);
            return null;
        }
        console.log(`[EPG] Cache valid (${Math.floor(age / 3600000)}h old)`);
        return raw.replace(/<!--fetchTime:\d+-->[\r\n]?/, '');
    } catch (e) {
        console.error('[EPG] Cache read error:', e);
        return null;
    }
}

function writeCachedSync(xml: string): void {
    try {
        const file = getCacheFile();
        file.create({ overwrite: true });
        file.write(`<!--fetchTime:${Date.now()}-->\n${xml}`);
        console.log('[EPG] Cache written');
    } catch (e) {
        console.error('[EPG] Cache write error:', e);
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseXmltvDate(s: string): Date {
    const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
    if (!m) return new Date(NaN);
    const tz = m[7] ?? '+0000';
    const sign = tz[0] === '-' ? -1 : 1;
    const off = sign * (parseInt(tz.slice(1, 3)) * 60 + parseInt(tz.slice(3, 5))) * 60000;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - off);
}

function norm(s: string): string {
    s = s.replace(/^BR\s*-\s*/i, '').replace(/^BR\s+/i, '').replace(/^[A-Z]{2}\s*-\s*/, '');
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function dec(s: string): string {
    return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, ' ');
}

function notifyProgress(progress: number, loaded: number, total: number): void {
    loadProgress = progress;
    progressListeners.forEach(l => l(progress, loaded, total));
}

// ─── Parser ───────────────────────────────────────────────────────────────────

const yieldNow = () => new Promise<void>(r => setTimeout(r, 0));

async function extractChannels(xml: string): Promise<void> {
    nameIndex.clear();
    let cursor = 0;
    let count = 0;
    let batch = 0;

    while (true) {
        const tagStart = xml.indexOf('<channel id="', cursor);
        if (tagStart < 0) break;
        const idEnd = xml.indexOf('"', tagStart + 13);
        if (idEnd < 0) break;
        const closeTag = xml.indexOf('</channel>', idEnd);
        if (closeTag < 0) break;

        const id = xml.slice(tagStart + 13, idEnd);
        const inner = xml.slice(idEnd + 1, closeTag);
        const dn = inner.match(/<display-name[^>]*>([^<]+)<\/display-name>/);
        if (dn) {
            nameIndex.set(norm(dec(dn[1]).trim()), id);
            count++;
        }
        cursor = closeTag + 10;

        if (++batch >= 1000) { batch = 0; await yieldNow(); }
    }
    console.log(`[EPG] Extracted ${count} channels from XML, index size: ${nameIndex.size}`);
}

function matchChannels(): Set<string> {
    const matched = new Set<string>();
    for (const [appId, appName] of appChannelNames) {
        const n = norm(appName);
        let xmlId = nameIndex.get(n) ?? null;

        if (!xmlId) {
            for (const [key, id] of nameIndex.entries()) {
                if (n.startsWith(key) || key.startsWith(n)) { xmlId = id; break; }
            }
        }

        resolvedIds.set(appId, xmlId);
        if (xmlId) matched.add(xmlId);
    }
    console.log(`[EPG] Matched ${matched.size} of ${appChannelNames.size} app channels`);
    return matched;
}

async function extractProgrammes(xml: string, targetIds: Set<string>): Promise<void> {
    channelPrograms.clear();
    if (targetIds.size === 0) {
        console.log('[EPG] No target channels to extract programmes');
        return;
    }

    targetIds.forEach(id => channelPrograms.set(id, []));

    const now = Date.now();
    const win0 = now - 3600000;
    const win1 = now + 7 * 86400000;

    const xmlLen = xml.length;
    let cursor = 0;
    let batch = 0;
    let processed = 0;
    let kept = 0;

    while (true) {
        const tagStart = xml.indexOf('<programme ', cursor);
        if (tagStart < 0) break;
        const tagEnd = xml.indexOf('>', tagStart + 11);
        if (tagEnd < 0) break;
        const closeTag = xml.indexOf('</programme>', tagEnd);
        if (closeTag < 0) break;

        const attrs = xml.slice(tagStart + 11, tagEnd);
        const chIdx = attrs.indexOf('channel="');
        if (chIdx >= 0) {
            const chEnd = attrs.indexOf('"', chIdx + 9);
            const channelId = chEnd > 0 ? attrs.slice(chIdx + 9, chEnd) : '';

            if (channelId && targetIds.has(channelId)) {
                const sIdx = attrs.indexOf('start="');
                const stIdx = attrs.indexOf('stop="');
                if (sIdx >= 0 && stIdx >= 0) {
                    const sEnd = attrs.indexOf('"', sIdx + 7);
                    const stEnd = attrs.indexOf('"', stIdx + 6);
                    const startTime = parseXmltvDate(attrs.slice(sIdx + 7, sEnd));
                    const endTime = parseXmltvDate(attrs.slice(stIdx + 6, stEnd));

                    if (!isNaN(startTime.getTime()) && endTime.getTime() >= win0 && startTime.getTime() <= win1) {
                        const inner = xml.slice(tagEnd + 1, closeTag);
                        const tM = inner.match(/<title[^>]*>([^<]+)<\/title>/);
                        if (tM) {
                            const title = dec(tM[1]).trim();
                            if (title) {
                                const dM = inner.match(/<desc[^>]*>([\s\S]*?)<\/desc>/);
                                const cM = inner.match(/<category[^>]*>([^<]+)<\/category>/);
                                channelPrograms.get(channelId)?.push({
                                    id: `${channelId}-${startTime.getTime()}`,
                                    title,
                                    description: dM ? dec(dM[1]).trim() : '',
                                    category: cM ? dec(cM[1]).trim() : '',
                                    startTime,
                                    endTime,
                                });
                                kept++;
                            }
                        }
                    }
                }
            }
        }

        cursor = closeTag + 12;
        processed++;

        if (++batch >= 4000) {
            batch = 0;
            const pct = 50 + Math.floor((cursor / xmlLen) * 49);
            notifyProgress(Math.min(99, pct), channelPrograms.size, targetIds.size);
            await yieldNow();
        }
    }

    channelPrograms.forEach(p => p.sort((a, b) => a.startTime.getTime() - b.startTime.getTime()));
    console.log(`[EPG] Scanned ${processed} programmes, kept ${kept} for ${channelPrograms.size} channels`);
}

// ─── Load ─────────────────────────────────────────────────────────────────────

async function doLoadSync(xml: string): Promise<void> {
    console.log('[EPG] Starting async load...');
    const channelsAtStart = appChannelNames.size;
    needsReload = false;
    notifyProgress(10, 0, appChannelNames.size);

    try {
        console.log(`[EPG] Registered channels: ${appChannelNames.size}`);

        await extractChannels(xml);
        notifyProgress(30, 0, appChannelNames.size);
        await yieldNow();

        const matched = matchChannels();
        notifyProgress(50, 0, matched.size);
        await yieldNow();

        await extractProgrammes(xml, matched);
        notifyProgress(100, channelPrograms.size, matched.size);

        loadError = null;
        setState('loaded');
        console.log(`[EPG] Load complete - ${channelPrograms.size} channels`);
        notifyUpdate();

        // If channels registered during loading, reload to pick them up
        if (appChannelNames.size > channelsAtStart || needsReload) {
            console.log('[EPG] New channels during load, scheduling reload');
            needsReload = false;
            setTimeout(() => {
                if (loadState === 'loaded') loadFromCacheOrFetch();
            }, 100);
        }
    } catch (e: any) {
        console.error('[EPG] Parse error:', e);
        loadError = e?.message || 'Erro ao processar EPG';
        setState('error');
        notifyProgress(0, 0, 0);
    }
}

function loadFromCacheOrFetch(): void {
    if (loadState === 'loading' || isLoadingLocked) {
        console.log('[EPG] Already loading, skip loadFromCacheOrFetch');
        return;
    }
    isLoadingLocked = true;
    setState('loading');
    loadError = null;

    const cached = readCachedSync();
    const promise = cached
        ? doLoadSync(cached)
        : fetchAndLoadAsync(false);

    promise
        .then(() => {
            console.log('[EPG] Load completed successfully');
        })
        .catch((e) => {
            console.error('[EPG] Load failed:', e);
            if (channelPrograms.size === 0) {
                loadError = e?.message || 'Erro ao carregar EPG';
                setState('error');
            }
        })
        .finally(() => {
            isLoadingLocked = false;
        });
}

async function fetchAndLoadAsync(silent: boolean = false): Promise<void> {
    console.log(`[EPG] Starting async fetch (silent=${silent})...`);
    if (!silent) {
        loadError = null;
        notifyProgress(0, channelPrograms.size, appChannelNames.size);
    }

    try {
        const res = await fetch(EPG_XML_URL, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const xml = await res.text();
        console.log(`[EPG] Fetched ${xml.length} bytes`);

        writeCachedSync(xml);
        if (silent) {
            // Parse silently — keep current loaded state, only emit update at end
            await doLoadSilent(xml);
        } else {
            await doLoadSync(xml);
        }
    } catch (e: any) {
        console.error('[EPG] Fetch error:', e);
        if (silent) return; // silent failure — keep cached data
        if (channelPrograms.size === 0) {
            loadError = e?.message || 'Erro de conexão';
            setState('error');
        } else {
            console.log('[EPG] Fetch failed but using cached data');
            setState('loaded');
        }
        notifyProgress(channelPrograms.size > 0 ? 100 : 0, channelPrograms.size, appChannelNames.size);
    }
}

async function doLoadSilent(xml: string): Promise<void> {
    // Parse without flipping state — useful for background refresh of already-loaded data
    try {
        await extractChannels(xml);
        const matched = matchChannels();
        await extractProgrammes(xml, matched);
        notifyUpdate();
        console.log('[EPG] Silent refresh complete');
    } catch (e) {
        console.error('[EPG] Silent refresh failed:', e);
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function initEPGService(): void {
    initCalled = true;
    console.log('[EPG] initEPGService called - state:', loadState, 'channels:', appChannelNames.size);

    if (loadState === 'loading') return;

    // Always load (with reload check)
    if (loadState === 'loaded' && !needsReload) {
        console.log('[EPG] Already loaded and no changes needed');
        notifyProgress(100, channelPrograms.size, appChannelNames.size);
        return;
    }

    loadFromCacheOrFetch();
}

export async function refreshEPG(): Promise<void> {
    console.log('[EPG] Manual refresh requested');
    isLoadingLocked = false;
    setState('idle');
    loadFromCacheOrFetch();
    // Wait for load to complete (simple polling)
    while (loadState === 'loading' || isLoadingLocked) {
        await new Promise(r => setTimeout(r, 50));
    }
}

export function getChannelEPG(appId: string): Program[] {
    if (loadState !== 'loaded') return [];

    const xmlId = resolvedIds.get(appId);
    if (!xmlId) return [];

    return channelPrograms.get(xmlId) ?? [];
}

export async function fetchChannelEPG(appId: string): Promise<Program[]> {
    return getChannelEPG(appId);
}

export function getCurrentProgram(appId: string): CurrentProgram | null {
    const programs = getChannelEPG(appId);
    if (!programs.length) return null;

    const now = new Date();
    const idx = programs.findIndex(p => p.startTime <= now && p.endTime > now);
    if (idx === -1) return null;

    const current = programs[idx];
    const next = programs[idx + 1] ?? null;
    const duration = current.endTime.getTime() - current.startTime.getTime();
    const elapsed = now.getTime() - current.startTime.getTime();

    return {
        current,
        next,
        progress: Math.min(100, Math.max(0, (elapsed / duration) * 100)),
        remaining: Math.round((current.endTime.getTime() - now.getTime()) / 60000),
    };
}

export function hasEPG(appId: string): boolean {
    if (loadState !== 'loaded') return false;
    const xmlId = resolvedIds.get(appId);
    return !!xmlId && (channelPrograms.get(xmlId)?.length ?? 0) > 0;
}

export function hasEPGMapping(appId: string): boolean { return hasEPG(appId); }
export function hasFreshCache(appId: string): boolean { return hasEPG(appId); }
export function getEPGLoadedCount(): number { return channelPrograms.size; }

export async function clearEPGCache(): Promise<void> {
    console.log('[EPG] Clearing cache');
    channelPrograms.clear();
    nameIndex.clear();
    resolvedIds.clear();
    needsReload = true;
    setState('idle');
    loadError = null;
    loadProgress = 0;
    try {
        const dir = new Directory(Paths.document, 'epg_xmltv');
        if (dir.exists) dir.delete();
    } catch {}
    notifyProgress(0, 0, 0);
}

export function getEPGStats() {
    return {
        state: loadState,
        error: loadError,
        progress: loadProgress,
        registeredChannels: appChannelNames.size,
        xmlChannels: nameIndex.size,
        matchedChannels: channelPrograms.size,
        programs: Array.from(channelPrograms.values()).reduce((s, p) => s + p.length, 0),
    };
}

export async function prefetchEPG(_ids: string[]): Promise<void> {}
