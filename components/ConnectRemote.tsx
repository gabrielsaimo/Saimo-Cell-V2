import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TouchableOpacity,
  ScrollView,
  Image,
  TextInput,
} from 'react-native';
import { Ionicons, MaterialIcons, Feather } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Typography } from '../constants/Colors';
import { useConnectStore } from '../stores/connectStore';
import { saimoConnect } from '../services/saimoConnect';

export default function ConnectRemote() {
  const visible = useConnectStore((s) => s.isRemoteVisible);
  const setVisible = useConnectStore((s) => s.setRemoteVisible);
  const connectedTv = useConnectStore((s) => s.connectedTv);
  const tvState = useConnectStore((s) => s.tvState);
  const setMultiAudioVisible = useConnectStore((s) => s.setMultiAudioVisible);
  const textRequest = useConnectStore((s) => s.textRequest);

  const isLive = tvState?.mode === 'live';
  const isSearch = tvState?.screen === 'search';

  const [customText, setCustomText] = useState('');
  const [showTextInput, setShowTextInput] = useState(false);
  const [showNumpad, setShowNumpad] = useState(false);
  const [typedDigits, setTypedDigits] = useState('');
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    if (tvState?.screen === 'search' && tvState.searchText !== undefined) {
      setSearchText(tvState.searchText);
    }
  }, [tvState?.screen, tvState?.searchText]);

  if (!visible) return null;

  const currentScreen = tvState?.screens?.find((s) => s.idx === (tvState?.active ?? 0));
  const isMulti = tvState?.multi;

  const handleKey = (
    code:
      | 'UP'
      | 'DOWN'
      | 'LEFT'
      | 'RIGHT'
      | 'OK'
      | 'BACK'
      | 'HOME'
      | 'MENU'
      | 'CH_UP'
      | 'CH_DOWN'
      | '0'
      | '1'
      | '2'
      | '3'
      | '4'
      | '5'
      | '6'
      | '7'
      | '8'
      | '9'
  ) => {
    saimoConnect.sendKey(code);
  };

  const handleNumber = (n: string) => {
    setTypedDigits((prev) => (prev + n).slice(-4));
    saimoConnect.sendKey(n as any);
  };

  const handleClearDigits = () => {
    setTypedDigits('');
    handleKey('BACK');
  };

  const handleSearchChange = (text: string) => {
    setSearchText(text);
    saimoConnect.sendText(text);
  };

  const handleSendCustomText = () => {
    if (customText.trim()) {
      saimoConnect.sendText(customText.trim());
      setCustomText('');
      setShowTextInput(false);
    }
  };

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
              <View style={styles.tvTitleRow}>
                <MaterialIcons name="settings-remote" size={22} color={Colors.primary} />
                <Text style={styles.title}>{connectedTv?.name || 'Controle Remoto'}</Text>
              </View>
              <Text style={styles.subtitle}>Conectado à TV</Text>
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
            {/* NOW PLAYING BANNER */}
            {tvState?.mode === 'live' && currentScreen && (
              <View style={styles.nowPlayingCard}>
                <View style={styles.npRow}>
                  {currentScreen.logo ? (
                    <Image source={{ uri: currentScreen.logo }} style={styles.npLogo} resizeMode="contain" />
                  ) : (
                    <View style={styles.npLogoFallback}>
                      <MaterialIcons name="tv" size={24} color={Colors.textSecondary} />
                    </View>
                  )}
                  <View style={styles.npInfo}>
                    <Text style={styles.npChannel} numberOfLines={1}>
                      {currentScreen.channel}
                    </Text>
                    <Text style={styles.npProgram} numberOfLines={1}>
                      {currentScreen.program || 'Ao Vivo'}
                    </Text>
                  </View>
                </View>

                {/* BOTÕES DE MULTI-TELA NO BANNER */}
                <View style={styles.npActions}>
                  <TouchableOpacity
                    style={[styles.npActionBtn, isMulti && styles.npActionBtnActive]}
                    onPress={() => saimoConnect.toggleMultiTela(!isMulti)}
                  >
                    <MaterialIcons
                      name={isMulti ? 'fullscreen-exit' : 'picture-in-picture'}
                      size={18}
                      color={isMulti ? '#fff' : Colors.primaryLight}
                    />
                    <Text style={[styles.npActionText, isMulti && styles.npActionTextActive]}>
                      {isMulti ? 'Tela Única' : 'Multi-Tela'}
                    </Text>
                  </TouchableOpacity>

                  {isMulti && (
                    <TouchableOpacity
                      style={styles.npAudioBtn}
                      onPress={() => {
                        setVisible(false);
                        setMultiAudioVisible(true);
                      }}
                    >
                      <Ionicons name="headset" size={18} color="#fff" />
                      <Text style={styles.npAudioBtnText}>Áudio Duplo</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    style={styles.npActionBtn}
                    onPress={() => saimoConnect.trocarFonte(1)}
                  >
                    <Feather name="refresh-cw" size={16} color={Colors.textSecondary} />
                    <Text style={styles.npActionText}>Mudar Fonte</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* SE ESTIVER NO VOD */}
            {tvState?.mode === 'vod' && tvState.vod && (
              <View style={styles.nowPlayingCard}>
                <View style={styles.npRow}>
                  <View style={styles.npLogoFallback}>
                    <MaterialIcons name="movie" size={24} color={Colors.secondary} />
                  </View>
                  <View style={styles.npInfo}>
                    <Text style={styles.npChannel} numberOfLines={1}>
                      {tvState.vod.title}
                    </Text>
                    <Text style={styles.npProgram} numberOfLines={1}>
                      {tvState.vod.subtitle || 'Filme / Série'}
                    </Text>
                  </View>
                </View>

                <View style={styles.vodControls}>
                  <TouchableOpacity
                    style={styles.vodBtn}
                    onPress={() => saimoConnect.seek(-10000)}
                  >
                    <MaterialIcons name="replay-10" size={26} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.vodBtnPlay}
                    onPress={() => saimoConnect.playPause()}
                  >
                    <MaterialIcons
                      name={tvState.playing ? 'pause' : 'play-arrow'}
                      size={32}
                      color="#fff"
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.vodBtn}
                    onPress={() => saimoConnect.seek(10000)}
                  >
                    <MaterialIcons name="forward-10" size={26} color="#fff" />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* BARRA SUPERIOR DO CONTROLE: VOLTAR, HOME, MENU, NÚMEROS/BUSCAR/TECLADO */}
            <View style={styles.topControlRow}>
              <TouchableOpacity
                style={styles.secondaryControlBtn}
                onPress={() => handleKey('BACK')}
              >
                <Ionicons name="arrow-back" size={22} color={Colors.text} />
                <Text style={styles.secondaryControlText}>Voltar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryControlBtn}
                onPress={() => handleKey('HOME')}
              >
                <Ionicons name="home-outline" size={22} color={Colors.text} />
                <Text style={styles.secondaryControlText}>Início</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryControlBtn}
                onPress={() => handleKey('MENU')}
              >
                <Ionicons name="menu-outline" size={22} color={Colors.text} />
                <Text style={styles.secondaryControlText}>Menu</Text>
              </TouchableOpacity>

              {isSearch ? (
                <TouchableOpacity
                  style={[styles.secondaryControlBtn, styles.secondaryControlBtnActive]}
                  onPress={() => {}}
                >
                  <Ionicons name="search" size={22} color={Colors.primaryLight} />
                  <Text style={[styles.secondaryControlText, { color: Colors.primaryLight }]}>Buscar</Text>
                </TouchableOpacity>
              ) : isLive ? (
                <TouchableOpacity
                  style={[styles.secondaryControlBtn, showNumpad && styles.secondaryControlBtnActive]}
                  onPress={() => setShowNumpad(!showNumpad)}
                >
                  <MaterialIcons name="dialpad" size={22} color={showNumpad ? Colors.primaryLight : Colors.text} />
                  <Text style={[styles.secondaryControlText, showNumpad && { color: Colors.primaryLight }]}>Números</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.secondaryControlBtn, (showTextInput || textRequest) && styles.secondaryControlBtnActive]}
                  onPress={() => setShowTextInput(!showTextInput)}
                >
                  <Ionicons name="keypad-outline" size={22} color={(showTextInput || textRequest) ? Colors.primaryLight : Colors.text} />
                  <Text style={styles.secondaryControlText}>Teclado</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* PESQUISA EM TEMPO REAL NA TV */}
            {isSearch && (
              <View style={styles.searchCard}>
                <View style={styles.searchHeaderRow}>
                  <Ionicons name="search" size={18} color={Colors.primaryLight} />
                  <Text style={styles.searchHeaderTitle}>Pesquisa em Tempo Real na TV</Text>
                </View>
                <View style={styles.searchBarRow}>
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Digite o que procura na TV..."
                    placeholderTextColor={Colors.textMuted}
                    value={searchText}
                    onChangeText={handleSearchChange}
                    autoFocus
                    returnKeyType="search"
                  />
                  {searchText.length > 0 && (
                    <TouchableOpacity
                      style={styles.clearBtn}
                      onPress={() => handleSearchChange('')}
                    >
                      <Ionicons name="close-circle" size={22} color={Colors.textSecondary} />
                    </TouchableOpacity>
                  )}
                </View>
                <Text style={styles.searchHint}>
                  Os resultados aparecem na TV automaticamente conforme você digita.
                </Text>
              </View>
            )}

            {/* TECLADO NUMÉRICO 0-9 (COMO CONTROLE REAL NA TV AO VIVO) */}
            {isLive && showNumpad && (
              <View style={styles.numpadContainer}>
                {typedDigits.length > 0 && (
                  <View style={styles.typedDigitsRow}>
                    <Text style={styles.typedDigitsLabel}>Canal:</Text>
                    <Text style={styles.typedDigitsValue}>{typedDigits}</Text>
                  </View>
                )}
                <View style={styles.numpadGrid}>
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => (
                    <TouchableOpacity
                      key={n}
                      style={styles.numpadBtn}
                      onPress={() => handleNumber(n)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.numpadText}>{n}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    style={[styles.numpadBtn, styles.numpadActionBtn]}
                    onPress={() => handleKey('MENU')}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.numpadActionText}>MENU</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.numpadBtn}
                    onPress={() => handleNumber('0')}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.numpadText}>0</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.numpadBtn, styles.numpadActionBtn]}
                    onPress={handleClearDigits}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="backspace-outline" size={24} color={Colors.text} />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* DIGITAÇÃO REMOTA / ENTRADA DE TEXTO NA TV (FORA DA BUSCA / TV AO VIVO) */}
            {!isSearch && !isLive && (showTextInput || textRequest) && (
              <View style={styles.keyboardCard}>
                <Text style={styles.keyboardLabel}>
                  {textRequest ? `A TV está pedindo: "${textRequest.hint}"` : 'Enviar texto para a TV:'}
                </Text>
                <View style={styles.keyboardRow}>
                  <TextInput
                    style={styles.keyboardInput}
                    placeholder={textRequest?.hint || 'Digite algo para buscar...'}
                    placeholderTextColor={Colors.textMuted}
                    value={customText}
                    onChangeText={setCustomText}
                    autoFocus
                    onSubmitEditing={handleSendCustomText}
                    returnKeyType="send"
                  />
                  <TouchableOpacity
                    style={styles.keyboardSendBtn}
                    onPress={handleSendCustomText}
                  >
                    <Ionicons name="send" size={18} color="#fff" />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* D-PAD DIRECIONAL */}
            <View style={styles.dpadContainer}>
              <View style={styles.dpadCross}>
                {/* UP */}
                <TouchableOpacity
                  style={[styles.dpadBtn, styles.dpadUp]}
                  onPress={() => handleKey('UP')}
                  activeOpacity={0.7}
                >
                  <Ionicons name="chevron-up" size={32} color={Colors.text} />
                </TouchableOpacity>

                {/* LEFT & RIGHT & OK */}
                <View style={styles.dpadMiddleRow}>
                  <TouchableOpacity
                    style={[styles.dpadBtn, styles.dpadLeft]}
                    onPress={() => handleKey('LEFT')}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="chevron-back" size={32} color={Colors.text} />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.dpadCenter}
                    onPress={() => handleKey('OK')}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.dpadOkText}>OK</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.dpadBtn, styles.dpadRight]}
                    onPress={() => handleKey('RIGHT')}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="chevron-forward" size={32} color={Colors.text} />
                  </TouchableOpacity>
                </View>

                {/* DOWN */}
                <TouchableOpacity
                  style={[styles.dpadBtn, styles.dpadDown]}
                  onPress={() => handleKey('DOWN')}
                  activeOpacity={0.7}
                >
                  <Ionicons name="chevron-down" size={32} color={Colors.text} />
                </TouchableOpacity>
              </View>
            </View>

            {/* CONTROLES INFERIORES: VOLUME E CANAL */}
            <View style={styles.bottomPillars}>
              {/* COLUNA VOLUME */}
              <View style={styles.pillarCard}>
                <Text style={styles.pillarTitle}>VOLUME</Text>
                <TouchableOpacity
                  style={styles.pillarBtn}
                  onPress={() => saimoConnect.setVolume(5)}
                >
                  <Ionicons name="add" size={24} color={Colors.text} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.pillarBtnMute}
                  onPress={() => saimoConnect.setVolume(undefined, undefined, !tvState?.muted)}
                >
                  <MaterialIcons
                    name={tvState?.muted ? 'volume-off' : 'volume-up'}
                    size={20}
                    color={tvState?.muted ? Colors.error : Colors.textSecondary}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.pillarBtn}
                  onPress={() => saimoConnect.setVolume(-5)}
                >
                  <Ionicons name="remove" size={24} color={Colors.text} />
                </TouchableOpacity>
              </View>

              {/* COLUNA CANAL */}
              <View style={styles.pillarCard}>
                <Text style={styles.pillarTitle}>CANAL</Text>
                <TouchableOpacity
                  style={styles.pillarBtn}
                  onPress={() => handleKey('CH_UP')}
                >
                  <Ionicons name="chevron-up" size={24} color={Colors.text} />
                </TouchableOpacity>
                <View style={styles.pillarMidInfo}>
                  <MaterialIcons name="live-tv" size={20} color={Colors.textSecondary} />
                </View>
                <TouchableOpacity
                  style={styles.pillarBtn}
                  onPress={() => handleKey('CH_DOWN')}
                >
                  <Ionicons name="chevron-down" size={24} color={Colors.text} />
                </TouchableOpacity>
              </View>
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
    maxHeight: '92%',
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
  tvTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  title: {
    color: Colors.text,
    fontSize: Typography.h3.fontSize,
    fontWeight: '700',
  },
  subtitle: {
    color: Colors.success,
    fontSize: Typography.caption.fontSize,
    fontWeight: '600',
    marginTop: 2,
  },
  closeBtn: {
    padding: Spacing.xs,
  },
  scroll: {
    flexGrow: 0,
  },
  nowPlayingCard: {
    backgroundColor: Colors.surfaceVariant,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  npRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  npLogo: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.xs,
  },
  npLogoFallback: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.xs,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  npInfo: {
    flex: 1,
  },
  npChannel: {
    color: Colors.text,
    fontSize: Typography.body.fontSize,
    fontWeight: '700',
  },
  npProgram: {
    color: Colors.textSecondary,
    fontSize: Typography.caption.fontSize,
    marginTop: 1,
  },
  npActions: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  npActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: Colors.surface,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  npActionBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primaryLight,
  },
  npActionText: {
    color: Colors.textSecondary,
    fontSize: Typography.caption.fontSize,
    fontWeight: '600',
  },
  npActionTextActive: {
    color: '#fff',
  },
  npAudioBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: Colors.secondary,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  npAudioBtnText: {
    color: '#fff',
    fontSize: Typography.caption.fontSize,
    fontWeight: '600',
  },
  vodControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xl,
    paddingVertical: Spacing.xs,
  },
  vodBtn: {
    padding: Spacing.sm,
  },
  vodBtnPlay: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topControlRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  secondaryControlBtn: {
    flex: 1,
    backgroundColor: Colors.surfaceVariant,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4,
  },
  secondaryControlBtnActive: {
    borderColor: Colors.primary,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
  },
  secondaryControlText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '500',
  },
  keyboardCard: {
    backgroundColor: Colors.surfaceVariant,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  keyboardLabel: {
    color: Colors.primaryLight,
    fontSize: Typography.caption.fontSize,
    fontWeight: '600',
    marginBottom: Spacing.xs,
  },
  keyboardRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  keyboardInput: {
    flex: 1,
    backgroundColor: Colors.surface,
    color: Colors.text,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    fontSize: Typography.body.fontSize,
  },
  keyboardSendBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dpadContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: Spacing.md,
  },
  dpadCross: {
    width: 210,
    height: 210,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dpadBtn: {
    backgroundColor: Colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dpadUp: {
    width: 70,
    height: 65,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
  },
  dpadMiddleRow: {
    flexDirection: 'row',
    width: 210,
    height: 70,
  },
  dpadLeft: {
    width: 65,
    height: 70,
    borderTopLeftRadius: BorderRadius.xl,
    borderBottomLeftRadius: BorderRadius.xl,
  },
  dpadCenter: {
    width: 80,
    height: 70,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BorderRadius.sm,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 4,
  },
  dpadOkText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  dpadRight: {
    width: 65,
    height: 70,
    borderTopRightRadius: BorderRadius.xl,
    borderBottomRightRadius: BorderRadius.xl,
  },
  dpadDown: {
    width: 70,
    height: 65,
    borderBottomLeftRadius: BorderRadius.xl,
    borderBottomRightRadius: BorderRadius.xl,
  },
  bottomPillars: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  pillarCard: {
    flex: 1,
    backgroundColor: Colors.surfaceVariant,
    borderRadius: BorderRadius.lg,
    padding: Spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pillarTitle: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
  },
  pillarBtn: {
    width: '100%',
    paddingVertical: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    marginVertical: 2,
  },
  pillarBtnMute: {
    width: '100%',
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillarMidInfo: {
    width: '100%',
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // BUSCA EM TEMPO REAL
  searchCard: {
    backgroundColor: Colors.surfaceVariant,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  searchHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  searchHeaderTitle: {
    color: Colors.primaryLight,
    fontSize: 13,
    fontWeight: '700',
  },
  searchBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    color: Colors.text,
    paddingVertical: Spacing.sm,
    fontSize: 15,
  },
  clearBtn: {
    padding: Spacing.xs,
  },
  searchHint: {
    color: Colors.textMuted,
    fontSize: 11,
    marginTop: 6,
  },
  // TECLADO NUMÉRICO 0-9
  numpadContainer: {
    backgroundColor: Colors.surfaceVariant,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  typedDigitsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
  },
  typedDigitsLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
  },
  typedDigitsValue: {
    color: Colors.primaryLight,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 2,
  },
  numpadGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 240,
    justifyContent: 'space-between',
    gap: 10,
  },
  numpadBtn: {
    width: 70,
    height: 52,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  numpadText: {
    color: Colors.text,
    fontSize: 22,
    fontWeight: '700',
  },
  numpadActionBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  numpadActionText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
});
