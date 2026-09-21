/**
 * Servidores desligados à mão, no painel do monitor.
 *
 * Quando um provedor cai, cai inteiro: não é a fonte 3 de um canal que morreu,
 * é o servidor que parou de responder para todo mundo. Editar o catálogo
 * publicado a cada queda é lento e some com o link, que depois precisa voltar.
 * Desligar o servidor no painel some com ele de todo canal e de todo filme, em
 * todos os aplicativos, e religar devolve tudo.
 *
 * A lista é baixada sem chave nenhuma: são nomes de servidor, que o catálogo
 * publicado já mostra, e exigir segredo significaria embutir um segredo num
 * aplicativo que qualquer um baixa.
 *
 * Sem rede a lista fica vazia e nada é escondido — o erro certo a cometer: um
 * canal a mais na tela é melhor que a lista inteira sumindo porque o monitor
 * não respondeu.
 */

const ENDERECO = 'https://saimo-monitor.gabrielsaimo68.workers.dev/v1/fontes';
/** Desligar um servidor tem que valer em minutos, que é o tempo que alguém
 *  aguenta um canal quebrado. */
export const VALIDADE_MS = 120_000;

let hosts = new Set<string>();
let lidoEm = 0;

/** Os servidores desligados agora, sem ir à rede. */
export function atuais(): ReadonlySet<string> {
  return hosts;
}

/**
 * Busca a lista quando ela envelheceu.
 *
 * Devolve `true` quando mudou, que é quando quem chamou precisa remontar a
 * lista de canais.
 */
export async function atualizar(): Promise<boolean> {
  if (Date.now() - lidoEm < VALIDADE_MS) return false;
  try {
    const controle = new AbortController();
    const prazo = setTimeout(() => controle.abort(), 10_000);
    const resposta = await fetch(ENDERECO, {
      // A resposta vem com `max-age` de dois minutos, e a camada de cache o
      // respeita: somado ao relógio daqui, a lista podia demorar o dobro para
      // mudar. Quem manda no ritmo é este relógio, um só.
      headers: { Accept: '*/*', 'Cache-Control': 'no-cache' },
      signal: controle.signal,
    }).finally(() => clearTimeout(prazo));
    if (!resposta.ok) return false;
    const corpo = (await resposta.json()) as { desativados?: unknown };
    if (!Array.isArray(corpo.desativados)) return false;

    lidoEm = Date.now();
    const novos = new Set(
      corpo.desativados
        .filter((h): h is string => typeof h === 'string')
        .map(h => h.trim().toLowerCase())
        .filter(Boolean),
    );
    if (novos.size === hosts.size && [...novos].every(h => hosts.has(h))) return false;
    hosts = novos;
    console.log(
      novos.size
        ? `servidores desligados: ${[...novos].sort().join(', ')}`
        : 'nenhum servidor desligado',
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * O servidor de um endereço, em minúsculas: o pedaço entre "//" e a primeira
 * barra, sem usuário nem porta.
 *
 * Sem `new URL()`: no Hermes ele existe mas engasga com endereço estranho, e
 * um endereço estranho não pode derrubar a lista inteira.
 */
function servidor(url: string): string | null {
  const resto = url.includes('://') ? url.slice(url.indexOf('://') + 3) : url;
  const autoridade = resto.split(/[/?#]/)[0] ?? '';
  const semUsuario = autoridade.includes('@')
    ? autoridade.slice(autoridade.lastIndexOf('@') + 1)
    : autoridade;
  const soHost = semUsuario.split(':')[0]?.toLowerCase() ?? '';
  return soHost || null;
}

export function desligado(url: string): boolean {
  if (!hosts.size || !url) return false;
  const host = servidor(url);
  return host !== null && hosts.has(host);
}

/** As fontes de um filme ou episódio sem as que estão desligadas. */
export function peneirar<T extends { url: string }>(fontes: T[]): T[] {
  return hosts.size ? fontes.filter(f => !desligado(f.url)) : fontes;
}

/**
 * O catálogo sem o que está desligado.
 *
 * Canal que fica sem nenhuma fonte sai da lista: ele não abriria mesmo, e
 * deixá-lo ali só rende clique frustrado. Volta sozinho quando o servidor for
 * religado.
 *
 * O `url` do canal é a primeira fonte viva: era a fonte 1 que o player tocava
 * antes de qualquer escolha, e ela pode ser justamente a que morreu.
 */
export function peneirarCanais<T extends { url: string; streams?: { url: string }[] }>(
  canais: T[],
): T[] {
  if (!hosts.size) return canais;
  const out: T[] = [];
  for (const canal of canais) {
    const streams = canal.streams ?? [];
    if (!streams.length) {
      if (!desligado(canal.url)) out.push(canal);
      continue;
    }
    const vivas = streams.filter(s => !desligado(s.url));
    if (!vivas.length) continue;
    out.push(
      vivas.length === streams.length
        ? canal
        : { ...canal, streams: vivas, url: vivas[0].url },
    );
  }
  return out;
}
