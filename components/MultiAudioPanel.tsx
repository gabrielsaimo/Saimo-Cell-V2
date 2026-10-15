import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TouchableOpacity,
  ScrollView,
  Image,
} from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Typography } from '../constants/Colors';
import { useConnectStore, PhoneAudioMode } from '../stores/connectStore';
import { saimoConnect } from '../services/saimoConnect';

export default function MultiAudioPanel() {
  const visible = useConnectStore((s) => s.isMultiAudioVisible);
  const setVisible = useConnectStore((s) => s.setMultiAudioVisible);
  const tvState = useConnectStore((s) => s.tvState);
  const phoneAudioMode = useConnectStore((s) => s.phoneAudioMode);
  const audioSyncDelayMs = useConnectStore((s) => s.audioSyncDelayMs);
  const setAudioSyncDelayMs = useConnectStore((s) => s.setAudioSyncDelayMs);

  if (!visible) return null;

  const screen0 = tvState?.screens?.find((s) => s.idx === 0);
  const screen1 = tvState?.screens?.find((s) => s.idx === 1);
  const tvAudio = tvState?.tvAudio || (tvState?.active === 1 ? '1' : '0');
  const activeScreen = tvState?.active ?? 0;

  const handleTvAudio = (src: '0' | '1' | 'mute') => {
    saimoConnect.setTvAudio(src);
  };

  const handlePhoneAudio = (src: PhoneAudioMode) => {
    saimoConnect.setPhoneAudio(src);
  };

  const handleFocusScreen = (idx: number) => {
    saimoConnect.setActiveScreen(idx);
  };

  const handleAdjustDelay = (delta: number) => {
    const next = Math.max(-1000, Math.min(1000, audioSyncDelayMs + delta));
    setAudioSyncDelayMs(next);
  };

  // Mensagem descritiva do cenário atual
  let cenarioDica = '';
  if (tvAudio === '0' && phoneAudioMode === '1') {
    cenarioDica = '✨ Modo Duas Pessoas: A TV toca o Canal 1 na sala enquanto você ouve o Canal 2 no celular/fone!';
  } else if (tvAudio === '1' && phoneAudioMode === '0') {
    cenarioDica = '✨ Modo Duas Pessoas: A TV toca o Canal 2 na sala enquanto você ouve o Canal 1 no celular/fone!';
  } else if (tvAudio === 'mute' && (phoneAudioMode === '0' || phoneAudioMode === '1')) {
    cenarioDica = `🔇 Modo Silencioso: A TV está muda na sala e você ouve o Canal ${phoneAudioMode === '0' ? '1' : '2'} no fone.`;
  } else if (phoneAudioMode === 'both') {
    cenarioDica = '🎧 Ambos os canais estão mixados no seu celular.';
  } else if (phoneAudioMode === 'none') {
    cenarioDica = '📱 Som do celular desligado. Apenas a TV está emitindo som.';
  } else if (tvAudio === phoneAudioMode) {
    cenarioDica = `📢 TV e Celular estão ambos sintonizados no áudio do Canal ${tvAudio === '0' ? '1' : '2'}.`;
  }

  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={() => setVisible(false)}
    >
      <Pressable style={styles.backdrop} onPress={() => setVisible(false)}>
        <Pressable style={styles.container} onPress={() => {}}>
          <View style={styles.handle} />

          {/* Cabeçalho */}
          <View style={styles.header}>
            <View style={styles.headerTitles}>
              <Text style={styles.title}>Áudio Multi-Tela</Text>
              <Text style={styles.subtitle}>
                Controle o som da TV e do seu celular separadamente
              </Text>
            </View>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={() => setVisible(false)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="close" size={22} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scroll} bounces={false} showsVerticalScrollIndicator={false}>
            {/* Visualização dos 2 canais lado a lado */}
            <View style={styles.screensRow}>
              {/* Canal 1 */}
              <TouchableOpacity
                style={[
                  styles.screenCard,
                  activeScreen === 0 && styles.screenCardActive,
                ]}
                onPress={() => handleFocusScreen(0)}
                activeOpacity={0.8}
              >
                <View style={styles.screenCardHeader}>
                  <View style={[styles.badge, styles.badge1]}>
                    <Text style={styles.badgeText}>CANAL 1</Text>
                  </View>
                  {activeScreen === 0 && (
                    <View style={styles.focusBadge}>
                      <Text style={styles.focusBadgeText}>Foco TV</Text>
                    </View>
                  )}
                </View>

                <View style={styles.channelInfo}>
                  {screen0?.logo ? (
                    <Image source={{ uri: screen0.logo }} style={styles.channelLogo} resizeMode="contain" />
                  ) : (
                    <View style={styles.channelLogoFallback}>
                      <MaterialIcons name="tv" size={20} color={Colors.textSecondary} />
                    </View>
                  )}
                  <View style={styles.channelText}>
                    <Text style={styles.channelName} numberOfLines={1}>
                      {screen0?.channel || 'Canal 1'}
                    </Text>
                    <Text style={styles.programTitle} numberOfLines={1}>
                      {screen0?.program || 'Transmissão ao vivo'}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>

              {/* Canal 2 */}
              <TouchableOpacity
                style={[
                  styles.screenCard,
                  activeScreen === 1 && styles.screenCardActive,
                ]}
                onPress={() => handleFocusScreen(1)}
                activeOpacity={0.8}
              >
                <View style={styles.screenCardHeader}>
                  <View style={[styles.badge, styles.badge2]}>
                    <Text style={styles.badgeText}>CANAL 2</Text>
                  </View>
                  {activeScreen === 1 && (
                    <View style={styles.focusBadge}>
                      <Text style={styles.focusBadgeText}>Foco TV</Text>
                    </View>
                  )}
                </View>

                <View style={styles.channelInfo}>
                  {screen1?.logo ? (
                    <Image source={{ uri: screen1.logo }} style={styles.channelLogo} resizeMode="contain" />
                  ) : (
                    <View style={styles.channelLogoFallback}>
                      <MaterialIcons name="tv" size={20} color={Colors.textSecondary} />
                    </View>
                  )}
                  <View style={styles.channelText}>
                    <Text style={styles.channelName} numberOfLines={1}>
                      {screen1?.channel || 'Canal 2'}
                    </Text>
                    <Text style={styles.programTitle} numberOfLines={1}>
                      {screen1?.program || 'Transmissão ao vivo'}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            </View>

            {/* Balão de Dica / Cenário inteligente */}
            {cenarioDica ? (
              <View style={styles.tipCard}>
                <Text style={styles.tipText}>{cenarioDica}</Text>
              </View>
            ) : null}

            {/* SEÇÃO 1: SOM DA TV */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="volume-high" size={20} color={Colors.primary} />
                <Text style={styles.sectionTitle}>Som dos Alto-falantes da TV</Text>
              </View>
              <Text style={styles.sectionDesc}>
                Escolha o canal que vai sair pelo som da sua TV na sala:
              </Text>

              <View style={styles.buttonGroup}>
                <TouchableOpacity
                  style={[
                    styles.choiceBtn,
                    tvAudio === '0' && styles.choiceBtnActive,
                  ]}
                  onPress={() => handleTvAudio('0')}
                >
                  <MaterialIcons
                    name="volume-up"
                    size={20}
                    color={tvAudio === '0' ? '#fff' : Colors.textSecondary}
                  />
                  <Text style={[styles.choiceBtnText, tvAudio === '0' && styles.choiceBtnTextActive]}>
                    Canal 1
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.choiceBtn,
                    tvAudio === '1' && styles.choiceBtnActive,
                  ]}
                  onPress={() => handleTvAudio('1')}
                >
                  <MaterialIcons
                    name="volume-up"
                    size={20}
                    color={tvAudio === '1' ? '#fff' : Colors.textSecondary}
                  />
                  <Text style={[styles.choiceBtnText, tvAudio === '1' && styles.choiceBtnTextActive]}>
                    Canal 2
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.choiceBtn,
                    tvAudio === 'mute' && styles.choiceBtnMuteActive,
                  ]}
                  onPress={() => handleTvAudio('mute')}
                >
                  <MaterialIcons
                    name="volume-off"
                    size={20}
                    color={tvAudio === 'mute' ? '#fff' : Colors.textSecondary}
                  />
                  <Text style={[styles.choiceBtnText, tvAudio === 'mute' && styles.choiceBtnTextActive]}>
                    Mudo
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* SEÇÃO 2: SOM NESTE CELULAR */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="headset" size={20} color={Colors.secondary} />
                <Text style={styles.sectionTitle}>Som neste Celular / Fone</Text>
              </View>
              <Text style={styles.sectionDesc}>
                Ouça individualmente pelo alto-falante ou fone Bluetooth:
              </Text>

              <View style={styles.buttonGroup}>
                <TouchableOpacity
                  style={[
                    styles.choiceBtn,
                    phoneAudioMode === 'none' && styles.choiceBtnActiveSecondary,
                  ]}
                  onPress={() => handlePhoneAudio('none')}
                >
                  <Ionicons
                    name="volume-mute-outline"
                    size={18}
                    color={phoneAudioMode === 'none' ? '#fff' : Colors.textSecondary}
                  />
                  <Text style={[styles.choiceBtnText, phoneAudioMode === 'none' && styles.choiceBtnTextActive]}>
                    Nenhum
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.choiceBtn,
                    phoneAudioMode === '0' && styles.choiceBtnActiveSecondary,
                  ]}
                  onPress={() => handlePhoneAudio('0')}
                >
                  <Ionicons
                    name="headset"
                    size={18}
                    color={phoneAudioMode === '0' ? '#fff' : Colors.textSecondary}
                  />
                  <Text style={[styles.choiceBtnText, phoneAudioMode === '0' && styles.choiceBtnTextActive]}>
                    Canal 1
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.choiceBtn,
                    phoneAudioMode === '1' && styles.choiceBtnActiveSecondary,
                  ]}
                  onPress={() => handlePhoneAudio('1')}
                >
                  <Ionicons
                    name="headset"
                    size={18}
                    color={phoneAudioMode === '1' ? '#fff' : Colors.textSecondary}
                  />
                  <Text style={[styles.choiceBtnText, phoneAudioMode === '1' && styles.choiceBtnTextActive]}>
                    Canal 2
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.choiceBtn,
                    phoneAudioMode === 'both' && styles.choiceBtnActiveSecondary,
                  ]}
                  onPress={() => handlePhoneAudio('both')}
                >
                  <Ionicons
                    name="options"
                    size={18}
                    color={phoneAudioMode === 'both' ? '#fff' : Colors.textSecondary}
                  />
                  <Text style={[styles.choiceBtnText, phoneAudioMode === 'both' && styles.choiceBtnTextActive]}>
                    Ambos
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* SINCRONIA BLUETOOTH */}
            {phoneAudioMode !== 'none' && (
              <View style={styles.syncCard}>
                <View style={styles.syncHeader}>
                  <Ionicons name="bluetooth" size={18} color={Colors.primaryLight} />
                  <Text style={styles.syncTitle}>Ajuste de Atraso (Bluetooth)</Text>
                  <Text style={styles.syncValText}>
                    {audioSyncDelayMs > 0 ? `+${audioSyncDelayMs}` : audioSyncDelayMs} ms
                  </Text>
                </View>
                <Text style={styles.syncDesc}>
                  Se o seu fone Bluetooth tiver atraso em relação à TV, ajuste aqui:
                </Text>
                <View style={styles.syncControls}>
                  <TouchableOpacity
                    style={styles.syncStepBtn}
                    onPress={() => handleAdjustDelay(-50)}
                  >
                    <Text style={styles.syncStepBtnText}>-50ms</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.syncResetBtn}
                    onPress={() => setAudioSyncDelayMs(0)}
                  >
                    <Text style={styles.syncResetBtnText}>Zerar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.syncStepBtn}
                    onPress={() => handleAdjustDelay(50)}
                  >
                    <Text style={styles.syncStepBtnText}>+50ms</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Ações inferiores */}
            <View style={styles.bottomActions}>
              <TouchableOpacity
                style={styles.exitMultiBtn}
                onPress={() => {
                  saimoConnect.toggleMultiTela(false);
                  setVisible(false);
                }}
              >
                <MaterialIcons name="fullscreen" size={20} color={Colors.error} />
                <Text style={styles.exitMultiBtnText}>Sair da Multi-Tela na TV</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxxl,
    maxHeight: '85%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  headerTitles: {
    flex: 1,
  },
  title: {
    color: Colors.text,
    fontSize: Typography.h3.fontSize,
    fontWeight: '700',
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: Typography.caption.fontSize,
    marginTop: 2,
  },
  closeBtn: {
    padding: Spacing.xs,
  },
  scroll: {
    flexGrow: 0,
  },
  screensRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  screenCard: {
    flex: 1,
    backgroundColor: Colors.surfaceVariant,
    borderRadius: BorderRadius.lg,
    padding: Spacing.sm,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  screenCardActive: {
    borderColor: Colors.primary,
    backgroundColor: '#1E1E38',
  },
  screenCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.xs,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  badge1: {
    backgroundColor: '#3B82F6',
  },
  badge2: {
    backgroundColor: '#8B5CF6',
  },
  badgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  focusBadge: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  focusBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '600',
  },
  channelInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  channelLogo: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.xs,
  },
  channelLogoFallback: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.xs,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelText: {
    flex: 1,
  },
  channelName: {
    color: Colors.text,
    fontSize: Typography.body.fontSize,
    fontWeight: '600',
  },
  programTitle: {
    color: Colors.textSecondary,
    fontSize: 11,
    marginTop: 1,
  },
  tipCard: {
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
    borderColor: 'rgba(99, 102, 241, 0.3)',
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  tipText: {
    color: '#C7D2FE',
    fontSize: Typography.caption.fontSize,
    lineHeight: 18,
    fontWeight: '500',
  },
  section: {
    marginBottom: Spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: 4,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: Typography.bodyLarge.fontSize,
    fontWeight: '600',
  },
  sectionDesc: {
    color: Colors.textSecondary,
    fontSize: Typography.caption.fontSize,
    marginBottom: Spacing.sm,
  },
  buttonGroup: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  choiceBtn: {
    flex: 1,
    backgroundColor: Colors.surfaceVariant,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xs,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  choiceBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primaryLight,
  },
  choiceBtnActiveSecondary: {
    backgroundColor: Colors.secondary,
    borderColor: Colors.secondaryLight,
  },
  choiceBtnMuteActive: {
    backgroundColor: '#4B5563',
    borderColor: '#6B7280',
  },
  choiceBtnText: {
    color: Colors.textSecondary,
    fontSize: Typography.caption.fontSize,
    fontWeight: '600',
  },
  choiceBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  syncCard: {
    backgroundColor: Colors.surfaceVariant,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  syncHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: 2,
  },
  syncTitle: {
    color: Colors.text,
    fontSize: Typography.body.fontSize,
    fontWeight: '600',
    flex: 1,
  },
  syncValText: {
    color: Colors.primaryLight,
    fontSize: Typography.body.fontSize,
    fontWeight: '700',
  },
  syncDesc: {
    color: Colors.textSecondary,
    fontSize: Typography.caption.fontSize,
    marginBottom: Spacing.sm,
  },
  syncControls: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  syncStepBtn: {
    flex: 1,
    backgroundColor: Colors.surface,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  syncStepBtnText: {
    color: Colors.text,
    fontSize: Typography.caption.fontSize,
    fontWeight: '600',
  },
  syncResetBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  syncResetBtnText: {
    color: Colors.textSecondary,
    fontSize: Typography.caption.fontSize,
  },
  bottomActions: {
    marginTop: Spacing.xs,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  exitMultiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
  },
  exitMultiBtnText: {
    color: Colors.errorLight,
    fontSize: Typography.body.fontSize,
    fontWeight: '600',
  },
});
