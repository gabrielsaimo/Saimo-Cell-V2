# Saimo TV — celular (Android)

Canais ao vivo, guia de programação, filmes e séries no celular. Versão atual:
**2.0.2**. Expo SDK 57, React Native 0.86, React 19.2, react-native-video.

O APK (`SaimoCell.apk`) sai no release único de
[SaimoPlayer](https://github.com/gabrielsaimo/SaimoPlayer/releases/latest); o
app confere esse release e oferece a atualização sozinho.

## O que tem

- **TV ao vivo** com a mesma lista dos outros apps (`catalogo.txt` do
  SaimoPlayer), várias fontes por canal, ClearKey e troca automática de fonte;
  ao vivo não tem pausa
- **Guia de programação** por canal
- **Filmes e séries** do acervo compartilhado (`vod/` do SaimoPlayer), com
  ficha, episódios, atores e escolha de fonte
- **Pular abertura e créditos** com os tempos do
  [TheIntroDB](https://theintrodb.org) (`services/pulos.ts`), e cartão do
  próximo episódio quando os créditos começam
- **Continuar assistindo** na aba de filmes
- **Downloads** para ver sem internet, com notificação de andamento
- **Chromecast**, favoritos e busca
- Versão mostrada em Ajustes lida do próprio app (`app.json`)

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
2.0.2 = 20002) e em `package.json`.

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
| `services/` | catálogo, acervo, guia, TMDB, TheIntroDB, downloads, telemetria |
| `components/` | cartões, listas, player, escolha de fonte, atualizador |

Histórico de mudanças em [CHANGELOG.md](CHANGELOG.md).
