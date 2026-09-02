// Busca de metadados no TMDB, com o mesmo algoritmo de casamento do
// `api-saimo-tv` — o gerador que enriquece o catálogo do Supabase.
//
// O Cinemeta que este app usava antes ficava com o primeiro resultado da
// busca, sem comparar nome nenhum: "A 13ª Emenda" batia com qualquer coisa
// que a busca por esse texto trouxesse primeiro. Aqui cada resultado ganha
// uma pontuação — título exato, título contido, ano de lançamento,
// popularidade — e só o suficiente para valer a pena costuma vencer.
import type { TMDBData } from '../types';

const TMDB_API_KEY = '15d2ea6d0dc1d476efbca3eba2b9bbfb';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_MIN_SCORE = 10;
const IMG_BASE = 'https://image.tmdb.org/t/p/';

type TmdbTipo = 'movie' | 'tv';

interface TmdbResultado {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_count?: number;
  vote_average?: number;
  popularity?: number;
  genre_ids?: number[];
}

const GENRE_NAMES: Record<number, string> = {
  28: 'Ação', 12: 'Aventura', 16: 'Animação', 35: 'Comédia', 80: 'Crime',
  99: 'Documentário', 18: 'Drama', 10751: 'Família', 14: 'Fantasia',
  36: 'História', 27: 'Terror', 10402: 'Música', 9648: 'Mistério',
  10749: 'Romance', 878: 'Ficção científica', 10770: 'Cinema TV',
  53: 'Suspense', 10752: 'Guerra', 37: 'Faroeste',
  10759: 'Ação & Aventura', 10762: 'Infantil', 10763: 'Notícias',
  10764: 'Reality', 10765: 'Ficção & Fantasia', 10766: 'Novela',
  10767: 'Talk', 10768: 'Guerra & Política',
};

const LEADING_ARTICLES = /^(o|a|os|as|um|uma|the|an?)\s+/i;

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTitle(title: string): string {
  return title
    .replace(/\s*[([]\s*(leg|dub|dublado|legendado|dual|national|pt-br|pt-pt|eng|legendada)\s*[)\]]/gi, '')
    .replace(/\b(4K|UHD|HD|FHD|SD|BluRay|BDRip|WEB-DL|WEBRip|HDTV|DVDRip|CAM|HDR|SDR)\b/gi, '')
    .replace(/\s*[([]\d{4}[)\]]\s*/g, '')
    .replace(/\s+S\d{1,2}\s*(?:E|Ep)?\s*\d{1,3}.*/i, '')
    .replace(/\s+T\d{1,2}\s*(?:E|Ep)?\s*\d{1,3}.*/i, '')
    .replace(/\s+Temporada\s+\d+.*/i, '')
    .replace(/\s+\d{1,2}x\d{1,3}.*/i, '')
    .replace(/[\s.\-_]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSearchVariants(name: string): string[] {
  const cleaned = cleanTitle(name);
  const variants = [cleaned];
  const add = (s: string | null) => { if (s && s.length > 1) variants.push(s); };

  const withoutLang = cleaned.replace(/\s*[([](leg|dub|dublado|legendado|dual|national)[)\]]/gi, '').trim();
  add(withoutLang !== cleaned ? withoutLang : null);

  const withoutArticle = cleaned.replace(LEADING_ARTICLES, '').trim();
  add(withoutArticle !== cleaned ? withoutArticle : null);

  const withoutSubtitle = cleaned.split(/\s*[:-]\s+/)[0].trim();
  add(withoutSubtitle !== cleaned && withoutSubtitle.length > 2 ? withoutSubtitle : null);

  const ascii = cleaned.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  add(ascii !== cleaned ? ascii : null);

  const withoutRoman = cleaned.replace(/\s+(?:II|III|IV|V|VI|VII|VIII|IX|X)$/i, '').trim();
  add(withoutRoman !== cleaned ? withoutRoman : null);

  return [...new Set(variants)];
}

function extrairAno(titulo: string): number | null {
  const m = titulo.match(/\b(20\d{2}|19\d{2})\b/);
  return m ? Number(m[1]) : null;
}

function pontuar(
  nomeLocal: string,
  resultado: TmdbResultado,
  tipo: TmdbTipo,
  ano: number | null,
  unico: boolean,
): number {
  const localNorm = normalizeName(cleanTitle(nomeLocal));
  const titulo = tipo === 'tv' ? resultado.name : resultado.title;
  const original = tipo === 'tv' ? resultado.original_name : resultado.original_title;
  const tituloNorm = normalizeName(titulo || '');
  const originalNorm = normalizeName(original || '');

  let pontos = 0;

  if (localNorm === tituloNorm || localNorm === originalNorm) pontos += 100;
  else if (tituloNorm.startsWith(localNorm) || localNorm.startsWith(tituloNorm)) pontos += 70;
  else if (originalNorm.startsWith(localNorm) || localNorm.startsWith(originalNorm)) pontos += 65;
  else if (tituloNorm.includes(localNorm) || localNorm.includes(tituloNorm)) pontos += 50;
  else if (originalNorm.includes(localNorm) || localNorm.includes(originalNorm)) pontos += 45;
  // A busca do TMDB já casa por título traduzido que nem `name` nem
  // `original_name` revelam de volta (ex.: "A Amiga Genial" só bate com "My
  // Brilliant Friend" pelo apelido em italiano que o TMDB conhece por
  // dentro); um resultado único da busca já é sinal suficiente.
  else if (unico) pontos += 12;

  const votos = resultado.vote_count || 0;
  if (votos > 1000) pontos += 15;
  else if (votos > 100) pontos += 8;

  if (ano) {
    const dataLancamento = tipo === 'tv' ? resultado.first_air_date : resultado.release_date;
    const anoTmdb = dataLancamento ? Number(dataLancamento.slice(0, 4)) : null;
    if (anoTmdb) {
      const diff = Math.abs(ano - anoTmdb);
      if (diff === 0) pontos += 25;
      else if (diff === 1) pontos += 10;
      else if (diff > 2) pontos -= 25;
    }
  }

  return pontos;
}

async function buscarUmaVez(query: string, tipo: TmdbTipo, lang: string): Promise<TmdbResultado[]> {
  const endpoint = tipo === 'tv' ? 'search/tv' : 'search/movie';
  const url = `${TMDB_BASE}/${endpoint}?query=${encodeURIComponent(query)}&api_key=${TMDB_API_KEY}&language=${lang}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return [];
    const json = await r.json();
    return json?.results ?? [];
  } catch {
    return [];
  }
}

async function buscarTMDB(query: string, tipo: TmdbTipo): Promise<TmdbResultado[]> {
  const pt = await buscarUmaVez(query, tipo, 'pt-BR');
  if (pt.length) return pt;
  return buscarUmaVez(query, tipo, 'en-US');
}

interface MelhorMatch {
  resultado: TmdbResultado;
  tipo: TmdbTipo;
}

async function melhorMatch(nome: string, tipoPrincipal: TmdbTipo): Promise<MelhorMatch | null> {
  const ano = extrairAno(nome);
  const variantes = buildSearchVariants(nome);
  const tipoAlternativo: TmdbTipo = tipoPrincipal === 'movie' ? 'tv' : 'movie';

  let melhor: TmdbResultado | null = null;
  let melhorPontos = 0;
  let tipoEncontrado = tipoPrincipal;

  for (const variante of variantes) {
    const resultados = await buscarTMDB(variante, tipoPrincipal);
    const unico = resultados.length === 1;
    for (const r of resultados.slice(0, 5)) {
      const pontos = pontuar(nome, r, tipoPrincipal, ano, unico);
      if (pontos > melhorPontos) { melhorPontos = pontos; melhor = r; }
    }
    if (melhorPontos >= 90) break;
  }

  if (melhorPontos < TMDB_MIN_SCORE) {
    for (const variante of variantes) {
      const resultados = await buscarTMDB(variante, tipoAlternativo);
      const unico = resultados.length === 1;
      for (const r of resultados.slice(0, 5)) {
        const pontos = pontuar(nome, r, tipoAlternativo, ano, unico);
        if (pontos > melhorPontos) { melhorPontos = pontos; melhor = r; tipoEncontrado = tipoAlternativo; }
      }
      if (melhorPontos >= 90) break;
    }
  }

  if (!melhor || melhorPontos < TMDB_MIN_SCORE) return null;
  return { resultado: melhor, tipo: tipoEncontrado };
}

function posterUrl(path: string | null | undefined, largura = 'w500'): string | undefined {
  return path ? `${IMG_BASE}${largura}${path}` : undefined;
}

const cache = new Map<string, Promise<Partial<TMDBData>>>();

export function clearTMDBCache(): void {
  cache.clear();
}

/** Metadados de um filme ou série pelo nome — mesma assinatura de `getCinemetaData`. */
export function getTMDBData(title: string, series: boolean): Promise<Partial<TMDBData>> {
  const key = `${series ? 's' : 'm'}:${title}`;
  const existente = cache.get(key);
  if (existente) return existente;

  const promessa = (async (): Promise<Partial<TMDBData>> => {
    const match = await melhorMatch(title, series ? 'tv' : 'movie');
    if (!match) return {};
    const { resultado, tipo } = match;
    const nomeExibido = (tipo === 'tv' ? resultado.name : resultado.title) || title;
    const dataLancamento = tipo === 'tv' ? resultado.first_air_date : resultado.release_date;
    return {
      id: resultado.id,
      title: nomeExibido,
      originalTitle: (tipo === 'tv' ? resultado.original_name : resultado.original_title) || undefined,
      overview: resultado.overview || '',
      releaseDate: dataLancamento || undefined,
      year: dataLancamento?.slice(0, 4) || /(?:19|20)\d{2}/.exec(title)?.[0] || '',
      rating: resultado.vote_average || 0,
      voteCount: resultado.vote_count,
      popularity: resultado.popularity,
      genres: (resultado.genre_ids || []).map((id) => GENRE_NAMES[id]).filter(Boolean),
      poster: posterUrl(resultado.poster_path) || '',
      posterHD: posterUrl(resultado.poster_path, 'original'),
      backdrop: posterUrl(resultado.backdrop_path, 'w780'),
      backdropHD: posterUrl(resultado.backdrop_path, 'original'),
      cast: [],
    };
  })();

  cache.set(key, promessa);
  return promessa;
}
