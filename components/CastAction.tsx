import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, StyleProp, ViewStyle } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import GoogleCast, { CastButton, useRemoteMediaClient } from 'react-native-google-cast';

import { Colors } from '../constants/Colors';

export interface CastPayload {
  url: string;
  title: string;
  poster?: string;
  /** Segundos já assistidos, para a TV continuar de onde parou. */
  startTime?: number;
}

interface CastActionProps {
  /** O que transmitir no momento do toque, ou nulo quando não há nada. */
  resolve?: () => CastPayload | null;
  /**
   * Quando a tela já tem o seu próprio efeito que envia o vídeo assim que a
   * sessão nasce — como o player de canais, que reenvia a cada troca de canal
   * —, o botão só abre a lista de aparelhos e não manda nada por conta.
   */
  onlyDialog?: boolean;
  style?: StyleProp<ViewStyle>;
  color?: string;
  size?: number;
}

/**
 * O botão "Transmitir".
 *
 * Antes este botão só funcionava quando já existia uma sessão de Cast aberta —
 * e não havia, em tela nenhuma do aplicativo, como abrir uma: o botão nativo
 * que lista os aparelhos só existia dentro do player. Tocar em transmitir num
 * filme, portanto, nunca fazia nada além de avisar que não havia aparelho
 * conectado.
 *
 * Agora o toque abre a lista de aparelhos do próprio Google Cast quando não há
 * sessão, e assim que a sessão nasce o título entra sozinho. O `CastButton`
 * nativo continua montado, invisível: no Android, `showCastDialog` só abre se
 * ele estiver em algum lugar da tela.
 */
/** Por que a lista não abriu: Play Services fora, ou nenhum aparelho na rede. */
async function avisarSemAparelho(): Promise<void> {
  const estado = await GoogleCast.getPlayServicesState().catch(() => null);
  if (estado && estado !== 'success') {
    await GoogleCast.showPlayServicesErrorDialog(estado).catch(() => false);
    return;
  }
  Alert.alert(
    'Transmitir',
    'Nenhum aparelho Cast encontrado. Confira se a TV está ligada e na mesma rede Wi-Fi.',
  );
}

export default function CastAction({
  resolve, onlyDialog = false, style, color = Colors.text, size = 24,
}: CastActionProps) {
  const client = useRemoteMediaClient();
  const [pending, setPending] = useState<CastPayload | null>(null);
  const lastSent = useRef<string>('');

  const enviar = useCallback((payload: CastPayload, client_: NonNullable<typeof client>) => {
    const marca = `${payload.url}@${Math.round(payload.startTime ?? 0)}`;
    if (lastSent.current === marca) return;
    lastSent.current = marca;
    client_.loadMedia({
      mediaInfo: {
        contentUrl: payload.url,
        metadata: {
          type: 'movie',
          title: payload.title,
          images: payload.poster ? [{ url: payload.poster }] : [],
        },
      },
      startTime: payload.startTime,
      autoplay: true,
    }).catch((e: unknown) => {
      Alert.alert('Transmitir', 'Não foi possível enviar para a TV. Tente de novo.');
      console.warn('[Cast] loadMedia falhou:', e);
    });
  }, []);

  // A sessão nasce depois do toque: o título esperava aqui.
  useEffect(() => {
    if (!client || !pending) return;
    enviar(pending, client);
    setPending(null);
  }, [client, pending, enviar]);

  const aoTocar = useCallback(async () => {
    if (onlyDialog) {
      const abriu = await GoogleCast.showCastDialog().catch(() => false);
      if (!abriu) await avisarSemAparelho();
      return;
    }
    const payload = resolve?.() ?? null;
    if (!payload?.url) {
      Alert.alert('Transmitir', 'Este título ainda não tem uma fonte para enviar à TV.');
      return;
    }
    if (client) {
      enviar(payload, client);
      return;
    }
    setPending(payload);
    const abriu = await GoogleCast.showCastDialog().catch(() => false);
    if (!abriu) {
      setPending(null);
      await avisarSemAparelho();
    }
  }, [resolve, onlyDialog, client, enviar]);

  return (
    <View style={styles.wrapper}>
      <TouchableOpacity style={style} onPress={aoTocar} accessibilityLabel="Transmitir">
        <MaterialIcons name="cast" size={size} color={client ? Colors.primary : color} />
      </TouchableOpacity>
      {/* Invisível, mas montado: sem ele o Android não abre a lista. */}
      <CastButton style={styles.hidden} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: 'relative' },
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0 },
});
