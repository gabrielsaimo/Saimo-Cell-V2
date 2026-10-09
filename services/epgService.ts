// EPG Service — Robust, instant cache load, auto-reload, guaranteed to work

import type { Channel, Program, CurrentProgram } from '../types';
import { Paths, File as FSFile, Directory } from 'expo-file-system';

const EPG_XML_URL = 'https://iptv-epg.org/files/epg-br.xml';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

// Guia da própria Pluto TV, montado pelo i.mjh.nz. Casa pelo id da Pluto, que
// já está no link do canal (jmp2.uk/plu-<id>) ou no logo: pelo nome, "Pluto TV
// Novelas" pegaria a programação de outro canal. Direto no raw.githubusercontent
// porque o redirecionamento do i.mjh.nz passa por uma página sem CORS.
const PLUTO_URL = 'https://raw.githubusercontent.com/matthuisman/i.mjh.nz/master/PlutoTV/br.xml';
const PLUTO_TTL_MS = 6 * 60 * 60 * 1000;
const PLUTO_ID = /(?:plu-|images\.pluto\.tv\/channels\/)([0-9a-f]{24})/;

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
/** Canal do app -> id da Pluto, para quem é da Pluto. */
const plutoIds = new Map<string, string>();
/** Canais em que a Pluto é a fonte principal; nos outros ela é só reserva. */
const plutoPrincipais = new Set<string>();
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

export interface PlutoDoCanal {
    id: string;
    /**
     * A Pluto é a fonte principal (a primeira, ou está só no logo). Onde ela é
     * reserva (TV Cultura, CNBC…) a grade dela é genérica e só entra na falta
     * de outra.
     */
    principal: boolean;
}

/** id da Pluto do canal, pelo link de alguma fonte ou pelo logo. */
export function plutoIdDe(channel: Pick<Channel, 'url' | 'logo' | 'streams'>): PlutoDoCanal | undefined {
    const links = channel.streams?.length ? channel.streams.map(s => s.url) : [channel.url];
    const doLink = links.map(l => PLUTO_ID.exec(l ?? '')?.[1]).find(Boolean);
    const id = doLink ?? PLUTO_ID.exec(channel.logo ?? '')?.[1];
    if (!id) return undefined;
    return { id, principal: !doLink || PLUTO_ID.test(links[0] ?? '') };
}

export function registerChannel(appId: string, name: string, pluto?: PlutoDoCanal): void {
    appChannelNames.set(appId, name);
    if (pluto) plutoIds.set(appId, pluto.id);
    else plutoIds.delete(appId);
    if (pluto?.principal) plutoPrincipais.add(appId);
    else plutoPrincipais.delete(appId);
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

// O guia nunca passa inteiro pela memória: o XML (~16 MB) vira uma string de
// ~32 MB no Java ao sair do fetch e derruba, com OutOfMemoryError, aparelho de
// heap pequeno (Android 9 com 48 MB). Ele vai direto para o disco e é lido em
// blocos; da memória só passam os programas dos canais que o app tem.

function getCacheDir(): Directory {
    const dir = new Directory(Paths.document, 'epg_xmltv');
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    return dir;
}

function getCacheFile(): FSFile {
    return new FSFile(getCacheDir(), 'epg-br.xml');
}

/** Arquivo do cache se existe e é mais novo que `ttl`; a idade é a data de gravação. */
function cachedFile(file: FSFile, ttl: number): FSFile | null {
    try {
        if (!file.exists) {
            console.log('[EPG] Cache file does not exist:', file.name);
            return null;
        }
        if (file.size < 1000) {
            console.log('[EPG] Cache file too small:', file.size);
            return null;
        }
        const age = Date.now() - (file.lastModified ?? 0);
        if (age >= ttl) {
            console.log(`[EPG] Cache expired (${Math.floor(age / 3600000)}h old)`);
            return null;
        }
        console.log(`[EPG] Cache valid (${Math.floor(age / 3600000)}h old)`);
        return file;
    } catch (e) {
        console.error('[EPG] Cache read error:', e);
        return null;
    }
}

/**
 * Baixa direto para o disco: o download nativo copia a resposta para o arquivo
 * sem montar o texto na memória. Grava num `.part` e só troca o cache quando o
 * download termina, para uma queda no meio não deixar um guia cortado.
 */
async function downloadToCache(url: string, name: string): Promise<FSFile> {
    const dir = getCacheDir();
    const part = new FSFile(dir, `${name}.part`);
    if (part.exists) part.delete();
    await FSFile.downloadFileAsync(url, part, { idempotent: true });
    await part.move(new FSFile(dir, name), { overwrite: true });
    return new FSFile(dir, name);
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

const CHUNK_BYTES = 256 * 1024;
/** Um elemento maior que isto está quebrado; é descartado para o resto não crescer sem fim. */
const MAX_REST = 1024 * 1024;

/**
 * UTF-8 para texto. O Hermes nem sempre traz TextDecoder; sem ele a conversão
 * é feita aqui. `end` é onde o último caractere inteiro do bloco termina.
 */
function decodeUtf8(b: Uint8Array, end: number): string {
    const parts: string[] = [];
    const units: number[] = [];
    let i = 0;
    while (i < end) {
        let c = b[i++];
        if (c >= 0x80) {
            if (c >= 0xf0) c = ((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
            else if (c >= 0xe0) c = ((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
            else if (c >= 0xc0) c = ((c & 31) << 6) | (b[i++] & 63);
            else c = 0xfffd;
            if (c > 0xffff) {
                c -= 0x10000;
                units.push(0xd800 | (c >> 10));
                c = 0xdc00 | (c & 0x3ff);
            }
        }
        units.push(c);
        if (units.length >= 8192) {
            parts.push(String.fromCharCode.apply(null, units));
            units.length = 0;
        }
    }
    if (units.length) parts.push(String.fromCharCode.apply(null, units));
    return parts.join('');
}

/** Até onde o bloco tem caracteres inteiros; o que sobra é o começo de um caractere cortado. */
function utf8Boundary(b: Uint8Array): number {
    const n = b.length;
    for (let back = 1; back <= 3 && back <= n; back++) {
        const c = b[n - back];
        if ((c & 0xc0) === 0x80) continue;
        const len = c >= 0xf0 ? 4 : c >= 0xe0 ? 3 : c >= 0xc0 ? 2 : 1;
        return len > back ? n - back : n;
    }
    return n;
}

/**
 * Lê o arquivo em blocos e entrega o texto a `consume`, que devolve até onde
 * processou: o resto (um elemento cortado no fim do bloco) volta no começo do
 * próximo. Devolver -1 encerra a leitura. `frac` é quanto do arquivo já foi lido.
 */
async function scanFile(file: FSFile, consume: (buf: string, frac: number) => number): Promise<void> {
    const handle = file.open();
    try {
        const total = handle.size ?? file.size;
        const decoder = typeof TextDecoder === 'function' ? new TextDecoder('utf-8') : null;
        let read = 0;
        let pending: Uint8Array | null = null;
        let rest = '';
        while (true) {
            const chunk = handle.readBytes(CHUNK_BYTES);
            const last = chunk.length === 0;
            read += chunk.length;
            let text: string;
            if (decoder) {
                text = decoder.decode(chunk, { stream: !last });
            } else {
                let bytes: Uint8Array = chunk;
                if (pending) {
                    bytes = new Uint8Array(pending.length + chunk.length);
                    bytes.set(pending);
                    bytes.set(chunk, pending.length);
                }
                const cut = last ? bytes.length : utf8Boundary(bytes);
                text = decodeUtf8(bytes, cut);
                pending = cut < bytes.length ? bytes.slice(cut) : null;
            }
            const buf = rest + text;
            const used = consume(buf, total ? read / total : 0);
            if (used < 0 || last) break;
            rest = buf.length - used > MAX_REST ? '' : buf.slice(used);
            await yieldNow();
        }
    } finally {
        handle.close();
    }
}

async function extractChannels(file: FSFile): Promise<void> {
    nameIndex.clear();
    let count = 0;

    await scanFile(file, buf => {
        let cursor = 0;
        while (true) {
            const tagStart = buf.indexOf('<channel id="', cursor);
            if (tagStart < 0) {
                // Os canais vêm todos antes dos programas: chegou no primeiro, acabou.
                if (buf.indexOf('<programme ', cursor) >= 0) return -1;
                return Math.max(cursor, buf.length - 16);
            }
            const closeTag = buf.indexOf('</channel>', tagStart);
            if (closeTag < 0) return tagStart;
            const idEnd = buf.indexOf('"', tagStart + 13);

            const id = buf.slice(tagStart + 13, idEnd);
            const inner = buf.slice(idEnd + 1, closeTag);
            const dn = inner.match(/<display-name[^>]*>([^<]+)<\/display-name>/);
            if (dn) {
                nameIndex.set(norm(dec(dn[1]).trim()), id);
                count++;
            }
            cursor = closeTag + 10;
        }
    });
    console.log(`[EPG] Extracted ${count} channels from XML, index size: ${nameIndex.size}`);
}

function matchChannels(): Set<string> {
    const matched = new Set<string>();
    for (const [appId, appName] of appChannelNames) {
        // Canal da Pluto fica com o guia da Pluto (fillPluto), nunca com um
        // canal do feed que só se parece no nome.
        if (plutoPrincipais.has(appId)) { resolvedIds.set(appId, null); continue; }
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

async function extractProgrammes(file: FSFile, targetIds: Set<string>, pluto = false): Promise<void> {
    if (!pluto) channelPrograms.clear();
    if (targetIds.size === 0) {
        console.log('[EPG] No target channels to extract programmes');
        return;
    }

    targetIds.forEach(id => channelPrograms.set(id, []));

    const now = Date.now();
    const win0 = now - 3600000;
    const win1 = now + 7 * 86400000;

    let processed = 0;
    let kept = 0;

    await scanFile(file, (xml, frac) => {
        let cursor = 0;
        while (true) {
            const tagStart = xml.indexOf('<programme ', cursor);
            if (tagStart < 0) return Math.max(cursor, xml.length - 11);
            const tagEnd = xml.indexOf('>', tagStart + 11);
            if (tagEnd < 0) return tagStart;
            const closeTag = xml.indexOf('</programme>', tagEnd);
            if (closeTag < 0) return tagStart;

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
                                    const iM = inner.match(/<icon[^>]*src="([^"]+)"/);
                                    channelPrograms.get(channelId)?.push({
                                        id: `${channelId}-${startTime.getTime()}`,
                                        title,
                                        description: dM ? dec(dM[1]).trim() : '',
                                        category: cM ? dec(cM[1]).trim() : '',
                                        startTime,
                                        endTime,
                                        ...(iM ? { thumbnail: dec(iM[1]) } : {}),
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
            if (!pluto && processed % 4000 === 0) {
                const pct = 50 + Math.floor(frac * 49);
                notifyProgress(Math.min(99, pct), channelPrograms.size, targetIds.size);
            }
        }
    });

    channelPrograms.forEach(p => p.sort((a, b) => a.startTime.getTime() - b.startTime.getTime()));
    console.log(`[EPG] Scanned ${processed} programmes, kept ${kept} for ${channelPrograms.size} channels`);
}
// ─── Reserva: guiadetv.com ─────────────────────────────────────────────────────
//
// O feed XMLTV não lista Sony Movies (nem mais cinco canais do catálogo:
// SBT News, Terra Viva, Box Kids TV, X Sports, N Sports) — varri as sete
// categorias do guiadetv.com para achar quem tinha página lá. Só entra para
// quem o feed já não trouxe nada; os prefixados "gdt:" nunca colidem com um
// id do XMLTV, então injetar direto em `channelPrograms`/`resolvedIds` é
// seguro mesmo sem esses dois mapas saberem da existência um do outro.

const GUIADETV_SLUGS: Record<string, string> = {
    'sony movies': 'sony-movies',
    'sbt news': 'sbt-news',
    'terra viva': 'terra-viva',
    'box kids tv': 'box-kids',
    'x sports': 'xsports',
    'n sports': 'nsports',
};

/**
 * `data-dt="AAAA-MM-DD HH:MM:SS-03:00"` seguido, adiante, de um link
 * `/programa/...` cujo texto é o título. O fim não é publicado — mesma regra
 * do resto do guia: vai até o próximo começar.
 */
function parseGuiaDeTv(html: string, channelId: string): Program[] {
    const padrao = /data-dt="(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):\d{2}[^"]*"[\s\S]*?<a[^>]*href="[^"]*programa\/[^"]+"[^>]*>[\s\S]*?([A-Za-zÀ-ÿ0-9][^<]{2,150})/g;

    const vistos = new Map<number, string>();
    for (const m of html.matchAll(padrao)) {
        const [, ano, mes, dia, hora, minuto] = m;
        // O guiadetv publica sempre em horário de Brasília (-03:00, sem
        // horário de verão desde 2019). `new Date(y,m,d,h,min)` leria isso no
        // fuso do aparelho — certo só por acaso, para quem está no Brasil.
        const inicio = Date.UTC(Number(ano), Number(mes) - 1, Number(dia), Number(hora) + 3, Number(minuto));
        const titulo = dec(m[6]).trim().replace(/\s+/g, ' ');
        if (titulo.length < 2) continue;
        // O mesmo instante pode repetir na página — o link do programa carrega
        // metadados extras que também casam com o padrão.
        if (!vistos.has(inicio)) vistos.set(inicio, titulo);
    }

    const ordenados = [...vistos.entries()].sort((a, b) => a[0] - b[0]);
    return ordenados.map(([inicio, titulo], posicao) => {
        const fim = posicao + 1 < ordenados.length ? ordenados[posicao + 1][0] : inicio + 3_600_000;
        return {
            id: `${channelId}-${inicio}`,
            title: titulo,
            description: '',
            category: '',
            startTime: new Date(inicio),
            endTime: new Date(fim),
        };
    });
}

/** Busca o guiadetv só para quem ficou sem programação nenhuma do feed. */
async function fillGuiaDeTvGaps(): Promise<void> {
    const alvos = [...appChannelNames.entries()].filter(([appId, name]) => {
        if (getChannelEPG(appId).length > 0) return false;
        return norm(name) in GUIADETV_SLUGS;
    });
    if (!alvos.length) return;

    let algumPreenchido = false;
    await Promise.all(alvos.map(async ([appId, name]) => {
        const slug = GUIADETV_SLUGS[norm(name)];
        const synthId = `gdt:${slug}`;
        try {
            const res = await fetch(`https://www.guiadetv.com/canal/${slug}`);
            if (!res.ok) return;
            const html = await res.text();
            const programas = parseGuiaDeTv(html, synthId);
            if (!programas.length) return;
            channelPrograms.set(synthId, programas);
            resolvedIds.set(appId, synthId);
            algumPreenchido = true;
        } catch {
            // Sem sorte desta vez; a próxima recarga tenta de novo.
        }
    }));

    if (algumPreenchido) {
        console.log(`[EPG] guiadetv preencheu ${alvos.length} lacuna(s)`);
        notifyUpdate();
    }
}

/**
 * Guia da Pluto para os canais da Pluto. O documento fica no disco por seis
 * horas: registrar um canal recarrega o guia, e baixar de novo a cada recarga
 * seria desperdício.
 */
async function fillPluto(): Promise<void> {
    if (plutoIds.size === 0) return;
    try {
        const file = cachedFile(new FSFile(getCacheDir(), 'pluto-br.xml'), PLUTO_TTL_MS)
            ?? await downloadToCache(PLUTO_URL, 'pluto-br.xml');
        const ids = new Set(plutoIds.values());
        await extractProgrammes(file, ids, true);
        let preenchidos = 0;
        for (const [appId, id] of plutoIds) {
            if (!channelPrograms.get(id)?.length) continue;
            const atual = resolvedIds.get(appId);
            if (!plutoPrincipais.has(appId) && atual && channelPrograms.get(atual)?.length) continue;
            resolvedIds.set(appId, id);
            preenchidos++;
        }
        console.log(`[EPG] Pluto: ${preenchidos} de ${plutoIds.size} canais`);
        if (preenchidos) notifyUpdate();
    } catch (e) {
        console.log('[EPG] Pluto falhou:', e);
    }
}

// ─── Load ─────────────────────────────────────────────────────────────────────

async function doLoadSync(xml: FSFile): Promise<void> {
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
        void fillGuiaDeTvGaps();
        void fillPluto();

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

    const cached = cachedFile(getCacheFile(), CACHE_TTL_MS);
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
        const xml = await downloadToCache(EPG_XML_URL, 'epg-br.xml');
        console.log(`[EPG] Fetched ${xml.size} bytes`);

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

async function doLoadSilent(xml: FSFile): Promise<void> {
    // Parse without flipping state — useful for background refresh of already-loaded data
    try {
        await extractChannels(xml);
        const matched = matchChannels();
        await extractProgrammes(xml, matched);
        notifyUpdate();
        await fillPluto();
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
