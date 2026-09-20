import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Channel, ChannelStream, MediaItem, TMDBData } from '../types';

export const SAIMO_REPOSITORY = 'gabrielsaimo/SaimoPlayer';
export const SAIMO_RAW_BASE = `https://raw.githubusercontent.com/${SAIMO_REPOSITORY}/main/`;
export const SAIMO_VOD_BASE = `${SAIMO_RAW_BASE}vod/`;

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const CACHE_PREFIX = 'saimo-source-v5:';
const CACHE_TTL = 6 * 60 * 60 * 1000;

interface CachedText {
  savedAt: number;
  text: string;
}

export interface VodIndexEntry {
  letter: string;
  movies: number;
  series: number;
  reserved: number;
}

export interface VodIndex {
  bases: string[];
  entries: VodIndexEntry[];
}

interface VodSearchEntry {
  title: string;
  series: boolean;
  letter: string;
  year: string;
}

function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalise(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Ordem das seções da lista, a mesma do Mac e do site. */
export const ORDEM_CATEGORIAS = [
  'TV Aberta', 'Filmes e Séries', 'Esportes', 'Notícias', 'Infantil',
  'Documentários', 'Pluto TV', '24 Horas', 'Variedades', 'Adulto',
];

/**
 * Seção pelo nome, para canal sem `categoria:` — a mesma regra do Mac
 * (Categoria.de em Model.swift), para os três apps concordarem.
 */
export function categoriaPeloNome(nome: string): string {
  const n = normalise(nome);
  const tem = (termos: string[]) => termos.some(t => n.includes(t));
  if (tem(['pluto tv'])) return 'Pluto TV';
  if (tem(['adulto', 'sexy hot', 'playboy', 'sex prive', 'penthouse', 'venus', 'hustler', 'private', 'brasileirinhas'])) return 'Adulto';
  if (tem(['premiere', 'sportv', 'espn', 'combate', 'band sports', 'nsports', 'n sports', 'xsports', 'x sports', 'caze', 'tnt sports', 'fuel', 'ge tv', 'fox sports']) && !tem(['universal'])) return 'Esportes';
  if (tem(['telecine', 'hbo', 'megapix', 'cinemax', 'paramount', 'space', 'tnt', 'amc', 'studio universal', 'sony', 'warner', 'axn', 'universal', 'cinemonde', 'darkflix', 'tcm', 'prime box', 'movies', 'cine'])) return 'Filmes e Séries';
  if (tem(['cartoon', 'gloob', 'nick', 'discovery kids', 'boomerang', 'tooncast', 'infantil', 'kids', 'cartoonito', 'box kids', 'ra tim bum', 'babyfirst', 'dumdum', 'anime'])) return 'Infantil';
  if (tem(['discovery', 'history', 'animal planet', 'nat geo', 'investigacao', 'h2', 'a e', 'curta', 'documenta', 'science', 'theater', 'turbo', 'world', 'id '])) return 'Documentários';
  if (tem(['news', 'globonews', 'cnn', 'record news', 'jovem pan', 'bandnews', 'band news', 'cnbc', 'euronews', 'dw', 'times brasil', 'uol'])) return 'Notícias';
  if (tem(['globo', 'sbt', 'record', 'band', 'redetv', 'rede tv', 'tv brasil', 'cultura', 'gazeta', 'rede vida', 'cancao nova', 'aparecida', 'senado', 'camara', 'justica', 'escola', 'futura', 'pampa', 'cnt', 'rede brasil', 'play tv', 'playtv', 'sesc'])) return 'TV Aberta';
  return 'Variedades';
}

/** `group-title` do M3U de reservas reduzido às mesmas seções. */
function categoriaDoGrupo(rotulo: string): string | null {
  const n = normalise(rotulo);
  if (!n) return null;
  if (/(esporte|espn|premiere|sportv|combate)/.test(n)) return 'Esportes';
  if (/(filme|serie|hbo|telecine|novela|reality)/.test(n)) return 'Filmes e Séries';
  if (/document/.test(n)) return 'Documentários';
  if (/(infanti|kids)/.test(n)) return 'Infantil';
  if (/(notic|news)/.test(n)) return 'Notícias';
  if (/aberta/.test(n)) return 'TV Aberta';
  if (/adulto/.test(n)) return 'Adulto';
  if (/pluto/.test(n)) return 'Pluto TV';
  if (/24 horas/.test(n)) return '24 Horas';
  if (/variedade/.test(n)) return 'Variedades';
  return null;
}

function channelId(name: string): string {
  return `remote-${slug(name)}`;
}

function cacheKey(name: string): string {
  return `${CACHE_PREFIX}${name.replace(/[^a-zA-Z0-9_.#-]/g, '_')}`;
}

async function readCache(name: string): Promise<CachedText | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(name));
    return raw ? (JSON.parse(raw) as CachedText) : null;
  } catch {
    return null;
  }
}

async function writeCache(name: string, text: string): Promise<void> {
  try {
    await AsyncStorage.setItem(cacheKey(name), JSON.stringify({ savedAt: Date.now(), text }));
  } catch {
    // A resposta da rede continua válida mesmo quando o aparelho está sem espaço.
  }
}

async function fetchText(url: string, name: string, force = false): Promise<string> {
  const cached = await readCache(name);
  if (!force && cached && Date.now() - cached.savedAt < CACHE_TTL && cached.text.trim()) {
    return cached.text;
  }

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        Accept: 'text/plain,*/*',
        'Cache-Control': 'no-cache',
        'User-Agent': DEFAULT_USER_AGENT,
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!text.trim()) throw new Error('resposta vazia');
    await writeCache(name, text);
    return text;
  } catch (error) {
    if (cached?.text.trim()) return cached.text;
    throw error;
  }
}

function streamHeaders(stream: ChannelStream): Record<string, string> | undefined {
  // O `Accept` vai sempre: o player não manda nenhum por conta própria, e há
  // origem que recusa quem não manda — ver a nota em playerStrategies.ts.
  return { Accept: '*/*', ...(stream.headers ?? {}) };
}

function channelFrom(name: string, logo: string, category: string, streams: ChannelStream[]): Channel {
  const primary = streams[0];
  return {
    id: channelId(name),
    name,
    logo,
    category: category || 'TV',
    url: primary?.url ?? '',
    headers: primary ? streamHeaders(primary) : undefined,
    drm: primary?.drm,
    streams,
  };
}

/** Parser do formato rico de catalogo.txt (fonte/referer/agente/chave). */
export function parseChannelCatalog(text: string): Channel[] {
  if (text.trimStart().startsWith('#EXTM3U')) return parseM3U(text);

  const result: Channel[] = [];
  let name = '';
  let logo = '';
  let categoria = '';
  let streams: ChannelStream[] = [];

  const flush = () => {
    if (name && streams.length) {
      result.push(channelFrom(name, logo, categoria || categoriaPeloNome(name), streams));
    }
    name = '';
    logo = '';
    categoria = '';
    streams = [];
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const field = line.slice(0, colon).toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (!value) continue;

    if (field === 'canal') {
      flush();
      name = value;
    } else if (field === 'logo') {
      logo = value;
    } else if (field === 'categoria') {
      categoria = value;
    } else if (field === 'fonte') {
      streams.push({ url: value });
    } else if ((field === 'referer' || field === 'agente') && streams.length) {
      const current = streams[streams.length - 1];
      current.headers = {
        ...(current.headers ?? {}),
        [field === 'referer' ? 'Referer' : 'User-Agent']: value,
      };
    } else if (field === 'chave' && streams.length) {
      const parts = value.split(':').map(part => part.trim());
      if (parts.length === 2 && parts.every(Boolean)) {
        streams[streams.length - 1].drm = {
          clearKey: `${parts[0]}:${parts[1]}`,
        };
      } else {
        streams.pop();
      }
    }
  }
  flush();
  return result;
}

function readM3UAttribute(line: string, attribute: string): string {
  const match = new RegExp(`${attribute}="([^"]*)"`, 'i').exec(line);
  return match?.[1]?.trim() ?? '';
}

function m3uDisplayName(line: string): string {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') quoted = !quoted;
    if (line[index] === ',' && !quoted) return line.slice(index + 1).trim();
  }
  return line.slice(line.lastIndexOf(',') + 1).trim();
}

/** Parser da lista M3U de reservas. Entradas com o mesmo tvg-id viram fontes. */
export function parseM3U(text: string): Channel[] {
  const result = new Map<string, Channel>();
  let pending: { name: string; logo: string; category: string } | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line === '#EXTM3U') continue;
    if (line.startsWith('#EXTINF:')) {
      const tvgId = readM3UAttribute(line, 'tvg-id');
      const rawName = m3uDisplayName(line);
      pending = {
        name: tvgId || rawName.replace(/\s*\([^)]+\)$/, '').trim(),
        logo: readM3UAttribute(line, 'tvg-logo'),
        category:
          categoriaDoGrupo(readM3UAttribute(line, 'group-title')) ||
          categoriaPeloNome(tvgId || rawName),
      };
      continue;
    }
    if (line.startsWith('#') || !pending?.name) continue;

    const key = normalise(pending.name);
    const current = result.get(key);
    if (current) {
      if (!current.streams?.some(stream => stream.url === line)) {
        current.streams = [...(current.streams ?? []), { url: line }];
      }
    } else {
      result.set(key, channelFrom(pending.name, pending.logo, pending.category, [{ url: line }]));
    }
    pending = null;
  }
  return [...result.values()];
}

/** O catálogo rico manda; o M3U apenas completa categorias, logos e reservas. */
export function mergeChannels(primary: Channel[], extras: Channel[]): Channel[] {
  if (!primary.length) return extras.map((channel, index) => ({ ...channel, channelNumber: index + 1 }));
  const byName = new Map(extras.map(channel => [normalise(channel.name), channel]));
  const used = new Set<string>();
  const merged = primary.map(channel => {
    const key = normalise(channel.name);
    const extra = byName.get(key);
    if (!extra) return channel;
    used.add(key);
    const known = new Set((channel.streams ?? []).map(stream => stream.url));
    const additional = (extra.streams ?? []).filter(stream => !known.has(stream.url));
    // O catálogo rico publicado permanece na frente; as entradas do M3U Git
    // são reservas. O Android adapta nativamente os hosts especiais Telecine.
    const streams = [...(channel.streams ?? []), ...additional];
    const first = streams[0];
    return {
      ...channel,
      // O catálogo declara a seção de cada canal; o M3U só completa.
      category: channel.category || extra.category,
      logo: channel.logo || extra.logo,
      streams,
      url: first?.url ?? channel.url,
      headers: first ? streamHeaders(first) : channel.headers,
      drm: first?.drm ?? channel.drm,
    };
  });
  merged.push(...extras.filter(channel => !used.has(normalise(channel.name))));
  return merged.map((channel, index) => ({ ...channel, channelNumber: index + 1 }));
}

export async function loadRemoteChannels(force = false): Promise<Channel[]> {
  const [catalog, extras, restritos] = await Promise.allSettled([
    fetchText(`${SAIMO_RAW_BASE}catalogo.txt`, 'catalogo.txt', force),
    fetchText(`${SAIMO_RAW_BASE}canais.txt`, 'canais.txt', force),
    fetchText(`${SAIMO_RAW_BASE}restritos.txt`, 'restritos.txt', force),
  ]);
  const primary = catalog.status === 'fulfilled' ? parseChannelCatalog(catalog.value) : [];
  const reserves = extras.status === 'fulfilled' ? parseM3U(extras.value) : [];
  const merged = mergeChannels(primary, reserves);
  if (!merged.length) throw new Error('A lista remota não contém canais válidos');
  // Os adultos moram à parte, iguais aos do Mac e do TV Box; a tela só os
  // mostra depois do PIN (channelStore filtra a categoria 'Adulto').
  if (restritos.status === 'fulfilled') {
    const nomes = new Set(merged.map(channel => normalise(channel.name)));
    for (const channel of parseChannelCatalog(restritos.value)) {
      if (nomes.has(normalise(channel.name))) continue;
      merged.push({ ...channel, category: 'Adulto' });
    }
  }
  // Seção por seção, como no Mac e no site, e o número acompanha a ordem.
  const posicao = (categoria: string) => {
    const i = ORDEM_CATEGORIAS.indexOf(categoria);
    return i < 0 ? ORDEM_CATEGORIAS.length : i;
  };
  return [...merged]
    .sort((a, b) => posicao(a.category) - posicao(b.category) || a.name.localeCompare(b.name, 'pt-BR'))
    .map((channel, index) => ({ ...channel, channelNumber: index + 1 }));
}

export function parseVodIndex(text: string): VodIndex {
  const bases: string[] = [];
  const entries: VodIndexEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith('base:')) {
      const match = /^base:\s+(\d+)\s+(.+)$/.exec(raw.trim());
      if (match) bases[Number(match[1])] = match[2].trim();
      continue;
    }
    const fields = raw.split('\t');
    if (fields.length >= 3 && fields[0].trim()) {
      entries.push({
        letter: fields[0].trim(),
        movies: Number(fields[1]) || 0,
        series: Number(fields[2]) || 0,
        reserved: Number(fields[3]) || 0,
      });
    }
  }
  return { bases, entries };
}

let vodIndex: VodIndex | null = null;

export async function loadVodIndex(force = false): Promise<VodIndex> {
  if (vodIndex && !force) return vodIndex;
  const text = await fetchText(`${SAIMO_VOD_BASE}indice.txt`, 'vod-indice.txt', force);
  const parsed = parseVodIndex(text);
  if (!parsed.bases.length || !parsed.entries.length) throw new Error('Índice VOD inválido');
  vodIndex = parsed;
  return parsed;
}

function vodUrl(value: string, bases: string[]): string {
  if (/^https?:\/\//i.test(value)) return value;
  const colon = value.indexOf(':');
  if (colon <= 0) return '';
  const base = bases[Number(value.slice(0, colon))];
  if (!base) return '';
  const rest = value.slice(colon + 1);
  return `${base}${rest}${rest.includes('.') ? '' : '.mp4'}`;
}

function makeVodId(type: 'movie' | 'series', letter: string, title: string, year = ''): string {
  return `saimo|${type === 'series' ? 's' : 'm'}|${encodeURIComponent(letter)}|${encodeURIComponent(title)}|${encodeURIComponent(year)}`;
}

export function parseVodId(id: string): { type: 'movie' | 'series'; letter: string; title: string; year: string } | null {
  const fields = id.split('|');
  if (fields.length !== 5 || fields[0] !== 'saimo' || !['m', 's'].includes(fields[1])) return null;
  try {
    return {
      type: fields[1] === 's' ? 'series' : 'movie',
      letter: decodeURIComponent(fields[2]),
      title: decodeURIComponent(fields[3]),
      year: decodeURIComponent(fields[4]),
    };
  } catch {
    return null;
  }
}

function basicTmdb(title: string, year = ''): TMDBData {
  return {
    id: 0,
    title,
    overview: '',
    year,
    rating: 0,
    genres: [],
    poster: '',
    cast: [],
  };
}

function movieItems(text: string, letter: string, bases: string[]): MediaItem[] {
  const result: MediaItem[] = [];
  for (const line of text.split(/\r?\n/)) {
    const fields = line.split('\t');
    const title = fields[0]?.trim();
    if (!title || fields.length < 2) continue;
    const sources = fields.slice(1).flatMap(field => {
      const equals = field.indexOf('=');
      if (equals <= 0) return [];
      const label = field.slice(0, equals).trim();
      return field.slice(equals + 1).split(',')
        .map(value => vodUrl(value.trim(), bases))
        .filter(Boolean)
        .map(url => ({ url, label }));
    });
    if (!sources.length) continue;
    const year = /(?:19|20)\d{2}/.exec(title)?.[0] ?? '';
    result.push({
      id: makeVodId('movie', letter, title),
      name: title,
      url: sources[0].url,
      sources,
      category: `filmes-${letter}`,
      categoryLabel: `Filmes • ${letter}`,
      type: 'movie',
      isAdult: false,
      tmdb: basicTmdb(title, year),
    });
  }
  return result;
}

function seriesItems(text: string, letter: string): MediaItem[] {
  const result: MediaItem[] = [];
  for (const line of text.split(/\r?\n/)) {
    const fields = line.split('\t');
    const title = fields[0]?.trim();
    if (!title || fields.length < 4) continue;
    const year = fields[1]?.trim() ?? '';
    const chunk = Number(fields[2]) || 0;
    const totalEpisodes = Number(fields[3]) || 0;
    result.push({
      id: makeVodId('series', letter, title, year),
      name: title,
      url: '',
      category: `series-${letter}`,
      categoryLabel: `Séries • ${letter}`,
      type: 'tv',
      isAdult: false,
      totalEpisodes,
      vodChunk: chunk,
      tmdb: basicTmdb(title, year),
    });
  }
  return result;
}

/** Animes e doramas publicados com os episódios no próprio arquivo. */
export async function loadVodCollection(
  kind: 'animes' | 'doramas',
  force = false,
): Promise<MediaItem[]> {
  const index = await loadVodIndex(force);
  const text = await fetchText(
    `${SAIMO_VOD_BASE}redeflix/links-${kind}.txt`,
    `vod-redeflix-${kind}.txt`,
    force,
  );
  const result: MediaItem[] = [];
  let current: MediaItem | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line.startsWith('@')) {
      const [title = '', year = '', tmdbId = ''] = line.slice(1).split('\t');
      if (!title.trim()) { current = null; continue; }
      current = {
        id: makeVodId('series', `redeflix-${kind}`, title.trim(), year.trim()),
        name: title.trim(),
        url: '',
        category: kind,
        categoryLabel: kind === 'animes' ? 'Animes' : 'Doramas',
        type: 'tv',
        isAdult: false,
        tmdb: { ...basicTmdb(title.trim(), year.trim()), id: Number(tmdbId) || 0 },
        episodes: {},
      };
      result.push(current);
      continue;
    }
    if (!current?.episodes) continue;
    const fields = line.split('\t');
    if (fields.length < 4) continue;
    const season = String(Number(fields[0]) || 0);
    const episode = Number(fields[1]) || 0;
    const label = fields[2] || 'dub';
    const sources = fields[3].split(',')
      .map(url => vodUrl(url.trim(), index.bases))
      .filter(Boolean)
      .map(url => ({ url, label }));
    if (!sources.length) continue;
    if (!current.episodes[season]) current.episodes[season] = [];
    current.episodes[season].push({
      id: `${current.id}|e|${season}|${episode}`,
      episode,
      name: label === 'leg' ? 'Legendado' : 'Dublado',
      url: sources[0].url,
      sources,
    });
  }
  return result.filter(item => Object.keys(item.episodes || {}).length > 0).map(item => ({
    ...item,
    totalSeasons: Object.keys(item.episodes || {}).length,
    totalEpisodes: Object.values(item.episodes || {}).reduce((total, episodes) => total + episodes.length, 0),
  }));
}

export async function loadVodCategory(
  type: 'movie' | 'series',
  letter: string,
  force = false,
): Promise<MediaItem[]> {
  const index = await loadVodIndex(force);
  const safeLetter = letter === '#' ? '%23' : encodeURIComponent(letter);
  const file = `${type === 'movie' ? 'filmes' : 'series'}-${safeLetter}.txt`;
  const text = await fetchText(`${SAIMO_VOD_BASE}${file}`, `vod-${file}`, force);
  return type === 'movie' ? movieItems(text, letter, index.bases) : seriesItems(text, letter);
}

async function loadSeriesEpisodes(item: MediaItem, letter: string): Promise<MediaItem> {
  const index = await loadVodIndex();
  const safeLetter = letter === '#' ? '%23' : encodeURIComponent(letter);
  const chunk = item.vodChunk ?? 0;
  const file = `series-${safeLetter}-${chunk}.txt`;
  const text = await fetchText(`${SAIMO_VOD_BASE}${file}`, `vod-${file}`);
  const parsed = parseVodId(item.id);
  if (!parsed) return item;

  let inside = false;
  const episodes: NonNullable<MediaItem['episodes']> = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('@')) {
      if (inside) break;
      const [title, year = ''] = line.slice(1).split('\t');
      inside = title === parsed.title && year === parsed.year;
      continue;
    }
    if (!inside) continue;
    const fields = line.split('\t');
    if (fields.length < 4) continue;
    const season = String(Number(fields[0]) || 0);
    const episode = Number(fields[1]) || 0;
    const label = fields[2] || '';
    const sources = fields[3].split(',')
      .map(value => vodUrl(value.trim(), index.bases))
      .filter(Boolean)
      .map(url => ({ url, label }));
    if (!sources.length) continue;
    if (!episodes[season]) episodes[season] = [];
    episodes[season].push({
      id: `${item.id}|e|${season}|${episode}`,
      episode,
      name: `${label === 'leg' ? 'Legendado' : 'Dublado'}`,
      url: sources[0].url,
      sources,
    });
  }
  return { ...item, episodes, totalSeasons: Object.keys(episodes).length };
}

// Buscava no Cinemeta e ficava com o primeiro resultado, sem comparar nome
// nenhum. `getTMDBData` (services/tmdbService.ts) pontua por título, ano e
// popularidade com o mesmo algoritmo do api-saimo-tv, que alimenta o
// catálogo do Supabase — o nome `getCinemetaData` ficou só para não mexer
// nos dois lugares que já chamam por ele.
import { getTMDBData, clearTMDBCache } from './tmdbService';
export { getTMDBData as getCinemetaData } from './tmdbService';

export async function enrichVodItem(item: MediaItem): Promise<MediaItem> {
  const meta = await getTMDBData(item.name, item.type === 'tv');
  return { ...item, tmdb: { ...basicTmdb(item.name, item.tmdb?.year), ...item.tmdb, ...meta } };
}

export async function getVodItem(id: string): Promise<MediaItem> {
  const parsed = parseVodId(id);
  if (!parsed) throw new Error('Identificador VOD inválido');
  if (parsed.letter === 'redeflix-animes' || parsed.letter === 'redeflix-doramas') {
    const kind = parsed.letter.endsWith('animes') ? 'animes' : 'doramas';
    const items = await loadVodCollection(kind);
    const item = items.find(candidate => candidate.name === parsed.title
      && (candidate.tmdb?.year ?? '') === parsed.year);
    if (!item) throw new Error('Título não encontrado na coleção atual');
    return enrichVodItem(item);
  }
  const items = await loadVodCategory(parsed.type, parsed.letter);
  // Expo Router decodifica os parâmetros da rota. O nome e o ano são a
  // identidade canônica no arquivo da categoria e não dependem de quantas
  // vezes caracteres reservados (#, %, ?, etc.) foram decodificados.
  let item = items.find(candidate => candidate.name === parsed.title
    && (parsed.type === 'movie' || (candidate.tmdb?.year ?? '') === parsed.year));
  if (!item) throw new Error('Título não encontrado no catálogo atual');
  if (parsed.type === 'series') item = await loadSeriesEpisodes(item, parsed.letter);
  return enrichVodItem(item);
}

let searchIndex: VodSearchEntry[] | null = null;

async function loadSearchIndex(): Promise<VodSearchEntry[]> {
  if (searchIndex) return searchIndex;
  const text = await fetchText(`${SAIMO_VOD_BASE}busca.txt`, 'vod-busca.txt');
  searchIndex = text.split(/\r?\n/).flatMap(line => {
    const fields = line.split('\t');
    if (fields.length < 3 || !fields[0]) return [];
    return [{ title: fields[0], series: fields[1] === 's', letter: fields[2], year: fields[3] || '' }];
  });
  return searchIndex;
}

export async function searchVod(query: string, type?: 'movie' | 'series'): Promise<MediaItem[]> {
  const wanted = normalise(query);
  const index = await loadSearchIndex();
  return index
    .filter(entry => (!type || (entry.series ? 'series' : 'movie') === type))
    .filter(entry => !wanted || normalise(`${entry.title} ${entry.year}`).includes(wanted))
    .slice(0, 500)
    .map(entry => ({
      id: makeVodId(entry.series ? 'series' : 'movie', entry.letter, entry.title, entry.year),
      name: entry.title,
      url: '',
      category: `${entry.series ? 'series' : 'filmes'}-${entry.letter}`,
      categoryLabel: `${entry.series ? 'Séries' : 'Filmes'} • ${entry.letter}`,
      type: entry.series ? 'tv' : 'movie',
      isAdult: false,
      tmdb: basicTmdb(entry.title, entry.year),
    }));
}

export async function clearSaimoSourceCache(): Promise<void> {
  vodIndex = null;
  searchIndex = null;
  clearTMDBCache();
  const keys = await AsyncStorage.getAllKeys();
  const sourceKeys = keys.filter(key => key.startsWith(CACHE_PREFIX));
  if (sourceKeys.length) await AsyncStorage.multiRemove(sourceKeys);
}
