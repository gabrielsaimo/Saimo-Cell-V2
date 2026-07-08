# Changelog — Saimo TV

## [1.0.4] — 2026-04-24

### Correção — Canais da lista Normal fechavam o app ao abrir

---

### Problema

Ao abrir qualquer canal da lista Normal, o app fechava imediatamente.
Apenas o **1º canal (A&E)** funcionava. Todos os outros causavam crash.

---

### Investigação

Todos os canais usam **ClearKey DRM** — um sistema de criptografia de vídeo onde cada segmento do stream é cifrado com uma chave. Para reproduzir, o ExoPlayer precisa obter essa chave de alguma forma.

**Por que só A&E funcionava?**

- A&E usa servidores da UOL (`mais.uol.com.br`) que **embute as chaves diretamente no manifesto `.mpd`**. O ExoPlayer lê e usa essas chaves automaticamente, sem precisar de servidor externo.
- Todos os outros canais usam servidores da VRIO (`vrioott.com`) que **não embute as chaves no manifesto**. O ExoPlayer tenta requisitar as chaves em um servidor de licença — mas nenhum estava configurado → tela preta ou crash.

**Causa raiz do crash:**

O crash era sempre o mesmo erro independente da biblioteca de vídeo utilizada:

```
java.lang.IllegalArgumentException: Out of range: 127963963175
  at androidx.media3.common.util.Util.percentInt
  at androidx.media3.common.BasePlayer.getBufferedPercentage
```

O ExoPlayer calcula a porcentagem do buffer com a fórmula:

```
bufferedPercentage = (posição_buffer × 100) / duração
```

Para streams **ao vivo**, a posição do buffer é um timestamp Unix em milissegundos (ex: `127.963.963.175 ms` ≈ 4 anos desde 1970). A duração de um stream ao vivo é indefinida (`TIME_UNSET = Long.MIN_VALUE`). O resultado da divisão estoura um `int` Java (limite: ~2,1 bilhões) → `IllegalArgumentException` → crash imediato do app.

Esse crash ocorria na chamada `updateProgress()` do `react-native-video` e também na `MediaSessionImpl` do `expo-video` quando `staysActiveInBackground = true`.

---

### Arquivos Alterados

#### `node_modules/react-native-video/android/src/main/java/com/brentvatne/exoplayer/ReactExoplayerView.java`

Linha 288 — função `updateProgress()`:

```java
// ANTES — crash em qualquer stream ao vivo
long bufferedDuration = player.getBufferedPercentage() * player.getDuration() / 100;
long duration = player.getDuration();

// DEPOIS — seguro para streams ao vivo
long duration = player.getDuration();
long bufferedDuration;
try {
    bufferedDuration = duration > 0 ? player.getBufferedPercentage() * duration / 100 : 0;
} catch (Exception e) {
    bufferedDuration = 0;
}
```

**Por quê:** `getBufferedPercentage()` chama `Util.percentInt()` do Media3 que lança `IllegalArgumentException` quando o valor não cabe em um `int`. A checagem `duration > 0` evita o cálculo para streams ao vivo (onde `getDuration()` retorna `TIME_UNSET = Long.MIN_VALUE`). O try-catch é uma segunda camada de segurança.

---

#### `android/app/src/main/assets/clearkey_keys.json` *(arquivo novo)*

Arquivo JSON com **136 pares de chaves ClearKey** extraídos do `offiline.json`, no formato:

```json
{
  "keys": [
    { "kid": "74481194bf32774e0cb44a1d71d6cc19", "key": "4bfd25bc9419f1c71e3ee8e6bf5ccf2a" },
    { "kid": "7dc3b6abe08d573883365f7d0b09fcb8", "key": "7f68828b12e6d739bff28fe2b50e8c94" },
    ...
  ]
}
```

Bundled como asset Android — disponível offline, sem depender de servidor externo.

---

#### `android/app/src/main/java/com/saimo/tvbox/ClearKeyServer.kt` *(arquivo novo)*

Servidor HTTP mínimo rodando em `http://127.0.0.1:8765` dentro do próprio processo do app.

**Funcionamento:**

1. Na inicialização, lê `clearkey_keys.json` e constrói um `Map<kidHex, keyHex>` em memória.
2. Quando o ExoPlayer requisita uma licença ClearKey, faz um HTTP POST com o corpo:
   ```json
   { "kids": ["<base64url-kid>"], "type": "temporary" }
   ```
3. O servidor decodifica o `kid` de base64url para hex, busca a chave no map e responde com:
   ```json
   { "keys": [{ "kty": "oct", "k": "<base64url-key>", "kid": "<base64url-kid>" }], "type": "temporary" }
   ```
4. O ExoPlayer recebe as chaves e decifra o vídeo normalmente.

**Características:**
- Sem dependências externas — usa apenas `ServerSocket` da JDK padrão
- Thread daemon (não impede o app de fechar)
- Resposta em < 1ms (lookup em memória)
- Sem acesso à internet — funciona 100% offline

---

#### `android/app/src/main/java/com/saimo/tvbox/MainApplication.kt`

Adicionada a inicialização do servidor no `onCreate()`:

```kotlin
override fun onCreate() {
    super.onCreate()
    // ...
    ClearKeyServer.start(this)  // ← linha adicionada
}
```

---

#### `app/player/[id].tsx`

Player reescrito de `expo-video` para `react-native-video`.

**Motivo da troca:** `expo-video` não suporta fornecer chaves ClearKey externamente — só aceita uma URL de servidor de licença como string, sem callback JS para interceptar a requisição. `react-native-video` permite configurar o `licenseServer` diretamente.

**Configuração DRM:**

```typescript
// Para canais com ClearKey DRM
const drmConfig = {
  type: DRMType.CLEARKEY,
  licenseServer: 'http://127.0.0.1:8765',  // servidor local
};
```

**Estratégia de troca de canal:**
- Cada abertura de canal usa `key={videoKey}` no componente `<Video>` para forçar remontagem limpa.
- Ao trocar de canal, incrementa `videoKey` com debounce de 200ms para evitar múltiplas montagens em scrolls rápidos.

---

### Por que `getLicense` callback (JS) não foi usado no Android?

O react-native-video possui um callback `getLicense` que permite interceptar a requisição de licença em JavaScript. Porém, analisando o código-fonte:

```typescript
useExternalGetLicense?: boolean; // ios
```

O comentário `// ios` confirma: **esse callback é exclusivo do iOS** (usado com FairPlay DRM). No Android, a biblioteca exige uma URL de servidor HTTP real no campo `licenseServer`. Por isso foi necessário criar o servidor local em Kotlin.

---

### Resultado dos Testes

Testes realizados via ADB no dispositivo Moto G04 (Android 14):

| Canal | Antes (1.0.3) | Depois (1.0.4) |
|-------|---------------|----------------|
| A&E (1) | ✅ Funcionava | ✅ Funcionando |
| Adult Swim (2) | ❌ App fechava | ✅ Funcionando |
| AMC (3) | ❌ App fechava | ✅ Funcionando |
| Canal 4+ | ❌ App fechava | ✅ Funcionando |
| PID do processo | Mudava (crash) | Mantido (sem crash) |
| Erros no logcat | `IllegalArgumentException` | Nenhum |

---

### Resumo das Mudanças

| Arquivo | Tipo | Descrição |
|---------|------|-----------|
| `ReactExoplayerView.java` | Patch | Fix overflow `getBufferedPercentage()` em live streams |
| `clearkey_keys.json` | Novo | 136 chaves ClearKey de todos os canais |
| `ClearKeyServer.kt` | Novo | Servidor HTTP local para licenças ClearKey |
| `MainApplication.kt` | Alterado | Inicialização do servidor ClearKey |
| `app/player/[id].tsx` | Reescrito | Player com react-native-video + DRM local |
| `app.json` | Alterado | Versão 1.0.3 → 1.0.4 |
| `android/app/build.gradle` | Alterado | versionCode 1→4, versionName 1.0.3→1.0.4 |
