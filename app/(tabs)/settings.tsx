import React, { useState, useCallback } from 'react';
import { 
  View, 
  Text,
  StyleSheet, 
  StatusBar,
  ScrollView,
  Switch,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Colors, Typography, Spacing, BorderRadius } from '../../constants/Colors';
import { useSettingsStore } from '../../stores/settingsStore';
import { useFavoritesStore } from '../../stores/favoritesStore';
import { clearEPGCache } from '../../services/epgService';
import { clearAllDownloads } from '../../services/downloadService';
import PinModal from '../../components/PinModal';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinMode, setPinMode] = useState<'verify' | 'change'>('change');
  
  const {
    showEPG,
    setShowEPG,
    showChannelNumber,
    setShowChannelNumber,
    autoplay,
    setAutoplay,
    adultUnlocked,
    lockAdult,
  } = useSettingsStore();
  
  const { clearFavorites } = useFavoritesStore();

  const handleChangePIN = useCallback(() => {
    setPinMode('change');
    setPinModalVisible(true);
  }, []);

  const handleLockAdult = useCallback(() => {
    lockAdult();
    Alert.alert('Bloqueado', 'Conteúdo adulto bloqueado novamente.');
  }, [lockAdult]);

  const handleClearCache = useCallback(async () => {
    Alert.alert(
      'Limpar Cache',
      'Deseja limpar o cache de EPG?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { 
          text: 'Limpar', 
          style: 'destructive',
          onPress: async () => {
            await clearEPGCache();
            Alert.alert('Sucesso', 'Cache limpo com sucesso!');
          }
        },
      ]
    );
  }, []);

  const handleClearFavorites = useCallback(() => {
    Alert.alert(
      'Limpar Favoritos',
      'Deseja remover todos os favoritos?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { 
          text: 'Limpar', 
          style: 'destructive',
          onPress: () => {
            clearFavorites();
            Alert.alert('Sucesso', 'Favoritos removidos!');
          }
        },
      ]
    );
   }, [clearFavorites]);

  const handleClearMediaDownloads = useCallback(() => {
    Alert.alert(
      'Limpar Filmes/Séries',
      'Deseja apagar todos os dados de filmes e séries baixados? Você precisará baixar novamente.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { 
          text: 'Apagar Tudo', 
          style: 'destructive',
          onPress: async () => {
            try {
              await clearAllDownloads();
              await AsyncStorage.removeItem('@saimo_download_complete');
              await AsyncStorage.removeItem('@saimo_first_check_done');
              Alert.alert('Sucesso', 'Dados de mídia apagados! Reinicie o app para baixar novamente.');
            } catch (e) {
              Alert.alert('Erro', 'Não foi possível apagar os dados.');
            }
          }
        },
      ]
    );
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
      
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Ajustes</Text>
        <Text style={styles.subtitle}>Configurações do app</Text>
      </View>

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Interface */}
        <Text style={styles.sectionTitle}>Interface</Text>
        <View style={styles.section}>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Ionicons name="tv-outline" size={22} color={Colors.primary} />
              <Text style={styles.settingLabel}>Mostrar EPG</Text>
            </View>
            <Switch
              value={showEPG}
              onValueChange={setShowEPG}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor={Colors.text}
            />
          </View>
          
          <View style={styles.divider} />
          
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Ionicons name="list-outline" size={22} color={Colors.primary} />
              <Text style={styles.settingLabel}>Número do canal</Text>
            </View>
            <Switch
              value={showChannelNumber}
              onValueChange={setShowChannelNumber}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor={Colors.text}
            />
          </View>
          
          <View style={styles.divider} />
          
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Ionicons name="play-outline" size={22} color={Colors.primary} />
              <Text style={styles.settingLabel}>Reproduzir automaticamente</Text>
            </View>
            <Switch
              value={autoplay}
              onValueChange={setAutoplay}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor={Colors.text}
            />
          </View>
        </View>

        {/* Controle Parental */}
        <Text style={styles.sectionTitle}>Controle Parental</Text>
        <View style={styles.section}>
          <TouchableOpacity style={styles.settingRow} onPress={handleChangePIN}>
            <View style={styles.settingInfo}>
              <Ionicons name="key-outline" size={22} color={Colors.primary} />
              <Text style={styles.settingLabel}>Alterar PIN</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
          
          {adultUnlocked && (
            <>
              <View style={styles.divider} />
              <TouchableOpacity style={styles.settingRow} onPress={handleLockAdult}>
                <View style={styles.settingInfo}>
                  <Ionicons name="lock-closed-outline" size={22} color={Colors.accent} />
                  <Text style={styles.settingLabel}>Bloquear conteúdo adulto</Text>
                </View>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusText}>Desbloqueado</Text>
                </View>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Dados */}
        <Text style={styles.sectionTitle}>Dados</Text>
        <View style={styles.section}>
          <TouchableOpacity style={styles.settingRow} onPress={handleClearCache}>
            <View style={styles.settingInfo}>
              <Ionicons name="trash-outline" size={22} color={Colors.warning} />
              <Text style={styles.settingLabel}>Limpar cache EPG</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
          
          <View style={styles.divider} />
          
          <TouchableOpacity style={styles.settingRow} onPress={handleClearFavorites}>
            <View style={styles.settingInfo}>
              <Ionicons name="heart-dislike-outline" size={22} color={Colors.error} />
              <Text style={styles.settingLabel}>Remover todos favoritos</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
          
          <View style={styles.divider} />
          
          <TouchableOpacity style={styles.settingRow} onPress={handleClearMediaDownloads}>
            <View style={styles.settingInfo}>
              <Ionicons name="cloud-download-outline" size={22} color={Colors.error} />
              <Text style={styles.settingLabel}>Apagar Filmes/Séries Baixados</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* App Info */}
        <View style={styles.appInfo}>
          <Text style={styles.appName}>Saimo TV</Text>
          <Text style={styles.appVersion}>Versão 1.0.0</Text>
        </View>
      </ScrollView>

      <PinModal
        visible={pinModalVisible}
        onClose={() => setPinModalVisible(false)}
        onSuccess={() => {
          setPinModalVisible(false);
          Alert.alert('Sucesso', 'PIN alterado com sucesso!');
        }}
        mode={pinMode}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    backgroundColor: Colors.background,
  },
  title: {
    color: Colors.text,
    fontSize: Typography.h1.fontSize,
    fontWeight: '700',
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: Typography.caption.fontSize,
    marginTop: 2,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: Spacing.lg,
  },
  sectionTitle: {
    color: Colors.textSecondary,
    fontSize: Typography.caption.fontSize,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.sm,
    marginTop: Spacing.md,
  },
  section: {
    backgroundColor: Colors.cardBg,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
  },
  settingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    flex: 1,
  },
  settingLabel: {
    color: Colors.text,
    fontSize: Typography.body.fontSize,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginLeft: Spacing.md + 22 + Spacing.md,
  },
  statusBadge: {
    backgroundColor: Colors.accent + '30',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
  },
  statusText: {
    color: Colors.accent,
    fontSize: Typography.caption.fontSize,
    fontWeight: '600',
  },
  appInfo: {
    alignItems: 'center',
    marginTop: Spacing.xxl,
    paddingVertical: Spacing.lg,
  },
  appName: {
    color: Colors.text,
    fontSize: Typography.body.fontSize,
    fontWeight: '600',
  },
  appVersion: {
    color: Colors.textSecondary,
    fontSize: Typography.caption.fontSize,
    marginTop: Spacing.xs,
  },
});
