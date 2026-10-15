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
  initialPositionMs?: number;
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

function SingleAudioTrack({
  source,
  volume,
  liveOffsetMs,
  userOffsetMs = 0,
  initialPositionMs,
}: AudioTrackProps) {
  const [streamData, setStreamData] = useState<{
    uri: string;
    headers?: Record<string, string>;
    type?: 'm3u8' | 'mpd';
    drm?: { type: DRMType; licenseServer: string };
  } | null>(null);

  const [keyCounter, setKeyCounter] = useState(0);
  const videoRef = useRef<any>(null);

  const [isTemporarilyPaused, setIsTemporarilyPaused] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);

  const pauseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevUserOffsetRef = useRef<number>(userOffsetMs);

  // Se o liveOffsetMs da TV não vier ou for inválido (<= 0), usamos 12.000ms (~12s)
  // que é o atraso médio padrão do buffer do ExoPlayer na TV Box
  const effectiveTvOffsetMs = liveOffsetMs && liveOffsetMs > 0 ? liveOffsetMs : 12000;
  const totalTargetDelayMs = Math.max(1000, effectiveTvOffsetMs + userOffsetMs);

  useEffect(() => {
    let ativo = true;

    resolveAudioStream(source)
      .then((data) => {
        if (ativo) {
          setStreamData(data);
        }
      })
      .catch((err) => {
        console.warn('[ConnectAudio] Falha ao resolver áudio:', err);
      });

    return () => {
      ativo = false;
    };
  }, [source.url, source.keyId, source.key, source.referer, source.userAgent, keyCounter]);

  // Aplicação instantânea, perceptível e garantida de ajustes de delay
  useEffect(() => {
    const delta = userOffsetMs - prevUserOffsetRef.current;
    prevUserOffsetRef.current = userOffsetMs;

    if (delta === 0) return;

    if (delta > 0) {
      // O usuário quer MAIS atraso (+0.2s, +1s, +5s, etc.):
      // Pausa imediatamente o áudio no celular por exatamente `delta` ms.
      // A imagem da TV na sala continua avançando; quando o som do celular voltar,
      // ele estará atrasado com precisão física exata de `delta` ms.
      if (rateTimeoutRef.current) {
        clearTimeout(rateTimeoutRef.current);
        rateTimeoutRef.current = null;
        setPlaybackRate(1.0);
      }

      setIsTemporarilyPaused(true);

      if (pauseTimeoutRef.current) {
        clearTimeout(pauseTimeoutRef.current);
      }

      pauseTimeoutRef.current = setTimeout(() => {
        setIsTemporarilyPaused(false);
        pauseTimeoutRef.current = null;
      }, delta);
    } else if (delta < 0) {
      // O usuário quer MENOS atraso (adiantar o áudio para alcançar a TV)
      if (pauseTimeoutRef.current) {
        clearTimeout(pauseTimeoutRef.current);
        pauseTimeoutRef.current = null;
        setIsTemporarilyPaused(false);
      }

      if (delta >= -2000) {
        // Ajuste fino (-0.2s ou -1s): acelera temporariamente a reprodução
        const speed = Math.abs(delta) > 500 ? 1.5 : 1.25;
        const speedFactor = speed - 1.0;
        const durationMs = Math.round(Math.abs(delta) / speedFactor);

        setPlaybackRate(speed);
        if (rateTimeoutRef.current) clearTimeout(rateTimeoutRef.current);
        rateTimeoutRef.current = setTimeout(() => {
          setPlaybackRate(1.0);
          rateTimeoutRef.current = null;
        }, durationMs);
      } else {
        // Salto negativo grande ou botão "Zerar": recarrega o stream alinhado ao vivo
        if (rateTimeoutRef.current) {
          clearTimeout(rateTimeoutRef.current);
          rateTimeoutRef.current = null;
        }
        setPlaybackRate(1.0);
        setKeyCounter((k) => k + 1);
      }
    }
  }, [userOffsetMs]);

  useEffect(() => {
    return () => {
      if (pauseTimeoutRef.current) clearTimeout(pauseTimeoutRef.current);
      if (rateTimeoutRef.current) clearTimeout(rateTimeoutRef.current);
    };
  }, []);

  if (!streamData) return null;

  const bufferConfig = {
    minBufferMs: Math.max(30000, totalTargetDelayMs + 20000),
    maxBufferMs: Math.max(60000, totalTargetDelayMs + 40000),
    bufferForPlaybackMs: 2500,
    bufferForPlaybackAfterRebufferMs: 5000,
    live: {
      targetOffsetMs: totalTargetDelayMs,
      minOffsetMs: Math.max(1000, totalTargetDelayMs - 3000),
      maxOffsetMs: totalTargetDelayMs + 5000,
      minPlaybackSpeed: 0.95,
      maxPlaybackSpeed: 1.05,
    },
  };

  return (
    <Video
      ref={videoRef}
      key={`audio-video-${streamData.uri}-${keyCounter}`}
      source={{
        uri: streamData.uri,
        type: streamData.type,
        headers: streamData.headers,
        startPosition: initialPositionMs && initialPositionMs > 0 ? Math.round(initialPositionMs) : undefined,
        bufferConfig,
      }}
      bufferConfig={bufferConfig}
      drm={streamData.drm}
      paused={isTemporarilyPaused}
      rate={playbackRate}
      volume={volume}
      muted={volume <= 0}
      playInBackground={true}
      playWhenInactive={true}
      ignoreSilentSwitch="ignore"
      disableFocus={true}
      preventsDisplaySleepDuringVideoPlayback={false}
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

  const isVod = tvState.mode === 'vod';
  const vodPos = tvState.vod?.pos;

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
          initialPositionMs={isVod ? vodPos : undefined}
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
