import React, { useEffect, useState, useRef, useMemo } from 'react';
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

const AUDIO_BUFFER_CONFIG = {
  minBufferMs: 30000,
  maxBufferMs: 60000,
  bufferForPlaybackMs: 2500,
  bufferForPlaybackAfterRebufferMs: 5000,
  live: {
    targetOffsetMs: 12000,
    minOffsetMs: 2000,
    maxOffsetMs: 25000,
    minPlaybackSpeed: 0.95,
    maxPlaybackSpeed: 1.05,
  },
};

const SingleAudioTrack = React.memo(
  function SingleAudioTrack({
    source,
    volume,
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

    // Captura a posição inicial no momento da montagem/mudança de canal para não reiniciar a cada tick
    const startPosRef = useRef<number | undefined>(
      initialPositionMs && initialPositionMs > 0 ? Math.round(initialPositionMs) : undefined
    );

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
        // Pausa imediatamente o áudio no celular por exatamente delta ms.
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

    // Objeto estável e memoizado para o react-native-video nunca recriar o player sem necessidade
    const sourceProp = useMemo(() => {
      if (!streamData) return null;
      return {
        uri: streamData.uri,
        type: streamData.type,
        headers: streamData.headers,
        startPosition: startPosRef.current,
        bufferConfig: AUDIO_BUFFER_CONFIG,
      };
    }, [streamData?.uri, streamData?.type, streamData?.headers]);

    if (!streamData || !sourceProp) return null;

    return (
      <Video
        ref={videoRef}
        key={`audio-video-${streamData.uri}-${keyCounter}`}
        source={sourceProp}
        bufferConfig={AUDIO_BUFFER_CONFIG}
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
          setTimeout(() => {
            setKeyCounter((k) => k + 1);
          }, 2500);
        }}
      />
    );
  },
  (prev, next) => {
    return (
      prev.source.url === next.source.url &&
      prev.source.keyId === next.source.keyId &&
      prev.source.key === next.source.key &&
      prev.source.referer === next.source.referer &&
      prev.source.userAgent === next.source.userAgent &&
      prev.volume === next.volume &&
      prev.userOffsetMs === next.userOffsetMs
    );
  }
);

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

  const playScreen0 = (phoneAudioMode === '0' || phoneAudioMode === 'both') && Boolean(s0?.url);
  const playScreen1 = (phoneAudioMode === '1' || phoneAudioMode === 'both') && Boolean(s1?.url);

  return (
    <View pointerEvents="none" style={styles.container}>
      {playScreen0 && s0 && (
        <SingleAudioTrack
          key={`audio-track-0-${s0.url}`}
          source={s0}
          volume={1.0}
          userOffsetMs={audioSyncDelayMs}
          initialPositionMs={isVod ? vodPos : undefined}
        />
      )}
      {playScreen1 && s1 && (
        <SingleAudioTrack
          key={`audio-track-1-${s1.url}`}
          source={s1}
          volume={1.0}
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
