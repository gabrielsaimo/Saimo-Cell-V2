# Saimo TV — celular (Android)

<p align="center">
  Saimo TV: <a href="https://github.com/gabrielsaimo/SaimoTV-Android">TV Box</a> · <b>Celular</b> · <a href="https://github.com/gabrielsaimo/SaimoWin">Windows</a> · <a href="https://github.com/gabrielsaimo/SaimoPlayer">Mac e catálogo</a> · <a href="https://github.com/gabrielsaimo/Saimo-TV">Site</a> · <a href="https://github.com/gabrielsaimo">todos os apps</a>
</p>

Canais ao vivo, guia de programação, filmes e séries no celular. Versão atual:
**2.1.1**. Expo SDK 57, React Native 0.86, React 19.2, react-native-video.

O APK (`SaimoCell.apk`) sai no release único de
[SaimoPlayer](https://github.com/gabrielsaimo/SaimoPlayer/releases/latest); o
app confere esse release e oferece a atualização sozinho.

## O que tem

- **TV ao vivo** com a mesma lista dos outros apps (`catalogo.txt` do
  SaimoPlayer), várias fontes por canal, ClearKey e troca automática de fonte;
  ao vivo não tem pausa
- **Guia de programação** por canal (XMLTV do iptv-epg.org e da Pluto TV).
  O XML vai direto para o disco e é lido em blocos de 256 KB
  (`services/epgService.ts`); só os programas dos canais do app ficam na
  memória, então o guia de ~16 MB não derruba aparelho de heap pequeno
- **Filmes e séries** do acervo compartilhado (`vod/` do SaimoPlayer), com
  ficha, episódios, atores e escolha de fonte
- **Legendas do OpenSubtitles** em filmes e séries (pt-BR, pt-PT, inglês, espanhol), com
  ajuste de sincronia (`services/legendas.ts`); sem chave nem cadastro
- **Pular abertura e créditos** com os tempos do
  [TheIntroDB](https://theintrodb.org) (`services/pulos.ts`), e cartão do
  próximo episódio quando os créditos começam
- **Continuar assistindo** na aba de filmes, e um banner do primeiro destaque
  no topo: com trailer direto no catálogo (MP4/HLS) ele toca sem som depois
  de 5 s, e a ficha abre se o trailer tocou e a aba ficou na frente por mais
  15 s
- **Janela flutuante** (picture-in-picture) no player ao vivo, no Android
- **Downloads** para ver sem internet, com notificação de andamento
- **Chromecast**, favoritos e busca
- Versão mostrada em Ajustes e usada pelo atualizador lida do próprio app
  (`app.json`)

## Rodar

```bash
npm install
npx expo run:android
```

## APK de release

```bash
cd android
ANDROID_HOME="/Volumes/SSD 1TB/DEV/AndroidDev/sdk" JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew assembleRelease
```

Sai em `android/app/build/outputs/apk/release/app-release.apk`. O
`release.sh` do SaimoPlayer copia esse arquivo como `SaimoCell.apk` para o
release. A versão fica em `app.json` (`version` e `android.versionCode`,
2.0.4 = 20004) e em `package.json`.

A pasta `android/` é gerada pelo Expo (`npx expo prebuild --clean`) e não vai
para o Git. O que precisa sobreviver a isso fica em plugins:

- `plugins/withSaimoSigning.js`: assina o release com a chave de sempre
  (`../chaves/saimo-cell.jks`, fora do repositório). Com outra chave o
  Android recusa instalar por cima da versão que as pessoas já têm.
- `plugins/withSaimoArquiteturas.js`: código nativo só para ARM
  (`arm64-v8a`, `armeabi-v7a`). Celular é ARM; sem x86 o build leva perto da
  metade do tempo e o APK fica menor. Emulador x86 não roda esse APK.

compileSdk e targetSdk 37 vêm do `expo-build-properties` no `app.json`.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `app/(tabs)` | abas: início (canais), filmes, downloads, favoritos, ajustes |
| `app/media`, `app/series`, `app/actor` | fichas |
| `app/player`, `app/media-player` | player ao vivo e de filmes/séries |
| `services/` | catálogo, acervo, guia, TMDB, TheIntroDB, legendas, downloads, telemetria |
| `components/` | cartões, listas, player, escolha de fonte, atualizador |

Histórico de mudanças em [CHANGELOG.md](CHANGELOG.md).
