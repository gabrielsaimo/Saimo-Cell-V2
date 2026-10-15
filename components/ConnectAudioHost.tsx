import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import Video, { DRMType } from 'react-native-video';
import { useConnectStore, TvSource } from '../stores/connectStore';
import { configureClearKey } from '../services/clearKeyServer';

interface AudioTrackProps {
  source: TvSource;
  volume: number;
}

function SingleAudioTrack({ source, volume }: AudioTrackProps) {
  const [drmLicenseUrl, setDrmLicenseUrl] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    if (source.keyId && source.key) {
      configureClearKey(`${source.keyId}:${source.key}`).then((url) => {
        if (ativo) setDrmLicenseUrl(url);
      });
    } else {
      setDrmLicenseUrl(null);
    }
    return () => {
      ativo = false;
    };
  }, [source.keyId, source.key, source.url]);

  const headers: Record<string, string> = {};
  if (source.referer) headers.Referer = source.referer;
  if (source.userAgent) headers['User-Agent'] = source.userAgent;

  const drm = drmLicenseUrl
    ? {
        type: DRMType.CLEARKEY,
        licenseServer: drmLicenseUrl,
      }
    : undefined;

  return (
    <Video
      source={{
        uri: source.url,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      }}
      drm={drm}
      paused={false}
      volume={volume}
      muted={volume <= 0}
      playInBackground={true}
      playWhenInactive={true}
      ignoreSilentSwitch="ignore"
      style={styles.hiddenVideo}
      onError={(err) => {
        console.warn('[ConnectAudio] Erro ao tocar áudio no celular:', err);
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
        <SingleAudioTrack key={`audio-0-${sc0?.channel || 'c0'}-${sc0?.sourceIndex || 0}-${s0.url}`} source={s0} volume={1.0} />
      )}
      {playScreen1 && s1 && (
        <SingleAudioTrack key={`audio-1-${sc1?.channel || 'c1'}-${sc1?.sourceIndex || 0}-${s1.url}`} source={s1} volume={1.0} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 0,
    height: 0,
    position: 'absolute',
  },
  hiddenVideo: {
    width: 0,
    height: 0,
    position: 'absolute',
    opacity: 0,
  },
});
