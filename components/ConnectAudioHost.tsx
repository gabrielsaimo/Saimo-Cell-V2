import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import Video, { DRMType } from 'react-native-video';
import { useConnectStore, TvSource } from '../stores/connectStore';
import { configureClearKey } from '../services/clearKeyServer';

interface AudioTrackProps {
  source: TvSource;
  volume: number;
  liveOffsetMs?: number;
  userOffsetMs?: number;
}

const dadinhoCache = new Map<string, { resolved: string; timestamp: number }>();
const DADINHO_CACHE_TTL_MS = 90 * 60 * 1000; // 90 min

async function resolveAudioStream(source: TvSource): Promise<{
  uri: string;
  headers?: Record<string, string>;
  type?: 'm3u8' | 'mpd';
  drm?: { type: DRMType; licenseServer: string };
}> {
  let uri = source.url;
  let headers: Record<string, string> = {};
  if (source.referer) headers.Referer = source.referer;
  if (source.userAgent) headers['User-Agent'] = source.userAgent;

  // 1. Resolução dinâmica de Dadinho / TikTok CDN
  if (uri.includes('dadinhodetapioca.fun/play/')) {
    const cached = dadinhoCache.get(uri);
    const now = Date.now();
    if (cached && now - cached.timestamp < DADINHO_CACHE_TTL_MS) {
      uri = cached.resolved;
    } else {
      try {
        const resp = await fetch(uri, {
          headers: {
            Referer: 'https://rdcanais.org/',
            'User-Agent':
              source.userAgent ||
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });
        if (resp.ok) {
          const html = await resp.text();
          const match = html.match(/STREAM_URLS\s*=\s*\[\s*"([^"]+)"/);
          if (match && match[1]) {
            uri = match[1].replace(/\\\//g, '/');
            dadinhoCache.set(source.url, { resolved: uri, timestamp: now });
          }
        }
      } catch (e) {
        console.warn('[ConnectAudio] Erro ao resolver stream dadinho:', e);
      }
    }
  }

  // Se o stream for do dadinho ou tiktokcdn, injeta os cabeçalhos obrigatórios
  if (uri.includes('dadinhodetapioca.fun') || uri.includes('tiktokcdn.live')) {
    headers = {
      ...headers,
      Referer: 'https://dadinhodetapioca.fun/',
      Origin: 'https://dadinhodetapioca.fun',
    };
  }

  // 2. ClearKey DRM
  let drm: { type: DRMType; licenseServer: string } | undefined = undefined;
  if (source.keyId && source.key) {
    const licenseUrl = await configureClearKey(`${source.keyId}:${source.key}`);
    if (licenseUrl) {
      drm = {
        type: DRMType.CLEARKEY,
        licenseServer: licenseUrl,
      };
    }
  }

  // 3. Determina o tipo do fluxo para ExoPlayer
  const isHls =
    uri.split('?')[0].toLowerCase().endsWith('.m3u8') ||
    uri.split('?')[0].toLowerCase().endsWith('.txt') ||
    uri.includes('dadinhodetapioca.fun') ||
    uri.includes('tiktokcdn.live');

  const isDash =
    uri.split('?')[0].toLowerCase().endsWith('.mpd') ||
    Boolean(source.keyId && source.key);

  const type = isHls ? 'm3u8' : isDash ? 'mpd' : undefined;

  return {
    uri,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    type,
    drm,
  };
}

function SingleAudioTrack({ source, volume, liveOffsetMs, userOffsetMs = 0 }: AudioTrackProps) {
  const [streamData, setStreamData] = useState<{
    uri: string;
    headers?: Record<string, string>;
    type?: 'm3u8' | 'mpd';
    drm?: { type: DRMType; licenseServer: string };
  } | null>(null);

  const [keyCounter, setKeyCounter] = useState(0);
  const videoRef = useRef<any>(null);
  const hasInitialSynced = useRef(false);
  const lastSeekTimestamp = useRef(0);
  const lastAppliedTargetDelaySec = useRef(0);
  const pendingManualSeek = useRef(false);

  // Se o liveOffsetMs da TV não vier ou for inválido (<= 0), usamos 10.000ms (~10s)
  // que é a latência padrão do buffer de hardware da TV Box
  const effectiveTvOffsetMs = liveOffsetMs && liveOffsetMs > 0 ? liveOffsetMs : 10000;
  // targetDelaySec: tempo em segundos que o celular deve ficar atrás da borda viva
  const totalDelayMs = Math.max(500, effectiveTvOffsetMs + userOffsetMs);
  const targetDelaySec = totalDelayMs / 1000;

  // Quando o usuário ajusta o delay manual ou o atraso da TV muda expressivamente, agenda alinhamento
  useEffect(() => {
    if (Math.abs(targetDelaySec - lastAppliedTargetDelaySec.current) > 0.1) {
      pendingManualSeek.current = true;
    }
  }, [targetDelaySec]);

  useEffect(() => {
    let ativo = true;

    resolveAudioStream(source)
      .then((data) => {
        if (ativo) {
          setStreamData(data);
          hasInitialSynced.current = false;
        }
      })
      .catch((err) => {
        console.warn('[ConnectAudio] Falha ao resolver áudio:', err);
      });

    return () => {
      ativo = false;
    };
  }, [source.url, source.keyId, source.key, source.referer, source.userAgent, keyCounter]);

  const handleProgress = (data: { currentTime: number; seekableDuration: number }) => {
    if (!data || !data.seekableDuration || data.seekableDuration <= 3) return;

    const now = Date.now();
    // Atraso atual do celular em relação à borda viva do streaming:
    const phoneDelaySec = Math.max(0, data.seekableDuration - data.currentTime);
    const drift = Math.abs(phoneDelaySec - targetDelaySec);

    const shouldInitialSync = !hasInitialSynced.current && data.currentTime > 0.5;
    const shouldManualSync = pendingManualSeek.current && now - lastSeekTimestamp.current > 500;
    // Drift considerável (> 2.0s de diferença entre celular e TV) após sincronização inicial:
    const shouldDriftSync = hasInitialSynced.current && drift > 2.0 && now - lastSeekTimestamp.current > 7000;

    if (shouldInitialSync || shouldManualSync || shouldDriftSync) {
      const targetSeek = Math.max(0.5, data.seekableDuration - targetDelaySec);
      if (targetSeek < data.seekableDuration) {
        console.log(
          `[ConnectAudio] Sincronizando: phoneDelay=${phoneDelaySec.toFixed(2)}s, targetDelay=${targetDelaySec.toFixed(2)}s, seekTo=${targetSeek.toFixed(2)}s (${shouldInitialSync ? 'inicial' : shouldManualSync ? 'ajuste' : 'drift'})`
        );
        videoRef.current?.seek(targetSeek);
        lastSeekTimestamp.current = now;
        hasInitialSynced.current = true;
        pendingManualSeek.current = false;
        lastAppliedTargetDelaySec.current = targetDelaySec;
      }
    }
  };

  if (!streamData) return null;

  return (
    <Video
      ref={videoRef}
      key={`audio-video-${streamData.uri}-${keyCounter}`}
      source={{
        uri: streamData.uri,
        type: streamData.type,
        headers: streamData.headers,
      }}
      drm={streamData.drm}
      paused={false}
      volume={volume}
      muted={volume <= 0}
      playInBackground={true}
      playWhenInactive={true}
      ignoreSilentSwitch="ignore"
      disableFocus={true}
      preventsDisplaySleepDuringVideoPlayback={false}
      progressUpdateInterval={500}
      onProgress={handleProgress}
      style={styles.hiddenVideo}
      onError={(err) => {
        console.warn('[ConnectAudio] Erro ao tocar áudio no celular:', err);
        // Tenta reconectar após 2.5s se a playlist expirar
        setTimeout(() => {
          setKeyCounter((k) => k + 1);
        }, 2500);
      }}
    />
  );
}

/**
 * Host de áudio transparente montado no topo da árvore do app (_layout.tsx).
 * Toca apenas o som da fonte escolhida (Canal 1, Canal 2 ou ambos) com a tela
 * do celular desligada ou em segundo plano, sem desenhar vídeo.
 */
export default function ConnectAudioHost() {
  const phoneAudioMode = useConnectStore((s) => s.phoneAudioMode);
  const tvState = useConnectStore((s) => s.tvState);
  const status = useConnectStore((s) => s.status);
  const audioSyncDelayMs = useConnectStore((s) => s.audioSyncDelayMs);

  if (status !== 'connected' || !tvState || phoneAudioMode === 'none') {
    return null;
  }

  const sc0 = tvState.screens?.find((s) => s.idx === 0);
  const sc1 = tvState.screens?.find((s) => s.idx === 1);
  const s0 = sc0?.source;
  const s1 = sc1?.source;

  const playScreen0 = (phoneAudioMode === '0' || phoneAudioMode === 'both') && s0?.url;
  const playScreen1 = (phoneAudioMode === '1' || phoneAudioMode === 'both') && s1?.url;

  return (
    <View pointerEvents="none" style={styles.container}>
      {playScreen0 && s0 && (
        <SingleAudioTrack
          key={`audio-0-${sc0?.channel || 'c0'}-${sc0?.sourceIndex || 0}-${s0.url}`}
          source={s0}
          volume={1.0}
          liveOffsetMs={sc0?.liveOffset}
          userOffsetMs={audioSyncDelayMs}
        />
      )}
      {playScreen1 && s1 && (
        <SingleAudioTrack
          key={`audio-1-${sc1?.channel || 'c1'}-${sc1?.sourceIndex || 0}-${s1.url}`}
          source={s1}
          volume={1.0}
          liveOffsetMs={sc1?.liveOffset}
          userOffsetMs={audioSyncDelayMs}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: -100,
    left: -100,
    width: 2,
    height: 2,
    opacity: 0.01,
    overflow: 'hidden',
  },
  hiddenVideo: {
    width: 2,
    height: 2,
  },
});
