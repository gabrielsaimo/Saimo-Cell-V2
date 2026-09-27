# Saimo TV — celular (Android)

Canais ao vivo, guia de programação, filmes e séries no celular. Versão atual:
**2.0.0**. Expo SDK 54, React Native 0.81, react-native-video.

O APK (`SaimoCell.apk`) sai no release único de
[SaimoPlayer](https://github.com/gabrielsaimo/SaimoPlayer/releases/latest); o
app confere esse release e oferece a atualização sozinho.

## O que tem

- **TV ao vivo** com a mesma lista dos outros apps (`catalogo.txt` do
  SaimoPlayer), várias fontes por canal, ClearKey e troca automática de fonte
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
release. A versão fica em `app.json`, `package.json` e em `versionName` /
`versionCode` de `android/app/build.gradle` (2.0.0 = 20000).

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `app/(tabs)` | abas: início (canais), filmes, downloads, favoritos, ajustes |
| `app/media`, `app/series`, `app/actor` | fichas |
| `app/player`, `app/media-player` | player ao vivo e de filmes/séries |
| `services/` | catálogo, acervo, guia, TMDB, TheIntroDB, downloads, telemetria |
| `components/` | cartões, listas, player, escolha de fonte, atualizador |

Histórico de mudanças em [CHANGELOG.md](CHANGELOG.md).
