import React, { useEffect, useState, useCallback, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Modal, 
  Animated, 
  Platform, 
  TouchableOpacity,
  ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { Colors } from '../constants/Colors'; // Assuming Colors is present, else we can fall back

const UPDATE_URL = "https://raw.githubusercontent.com/gabrielsaimo/Saimo-TV/refs/heads/main/update-cell.json";

export default function Updater() {
  const [visible, setVisible] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<any>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  
  const scaleValue = useRef(new Animated.Value(0.9)).current;
  const opacityValue = useRef(new Animated.Value(0)).current;

  const currentVersion = Constants.expoConfig?.version || '1.1.4';

  const checkUpdate = useCallback(async () => {
    try {
      const response = await fetch(UPDATE_URL, { cache: 'no-store' });
      const data = await response.json();

      if (compareVersions(data.version, currentVersion) > 0) {
        setUpdateInfo(data);
        setVisible(true);
        Animated.parallel([
          Animated.timing(scaleValue, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(opacityValue, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          })
        ]).start();
      }
    } catch (error) {
      console.log('Update check failed:', error);
    }
  }, [currentVersion]);

  useEffect(() => { checkUpdate(); }, [checkUpdate]);

  const compareVersions = (v1: string, v2: string) => {
    const v1Parts = v1.split('.').map(Number);
    const v2Parts = v2.split('.').map(Number);
    for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
        const p1 = v1Parts[i] || 0;
        const p2 = v2Parts[i] || 0;
        if (p1 > p2) return 1;
        if (p1 < p2) return -1;
    }
    return 0;
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const apkUri = FileSystem.documentDirectory + 'update.apk';
      const downloadResumable = FileSystem.createDownloadResumable(
        updateInfo.url,
        apkUri,
        {},
        (dp) => setDownloadProgress(dp.totalBytesWritten / dp.totalBytesExpectedToWrite)
      );

      const result = await downloadResumable.downloadAsync();
      if (result) installApk(result.uri);
    } catch (e) {
      setIsDownloading(false);
    }
  };

  const installApk = async (uri: string) => {
    if (Platform.OS === 'android') {
      const cUri = await FileSystem.getContentUriAsync(uri);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: cUri,
        flags: 1,
        type: 'application/vnd.android.package-archive',
      });
      setVisible(false);
    }
    setIsDownloading(false);
  };

  const handleClose = () => {
    // Only allow skipping if it's not a mandatory update
    if (!updateInfo?.mandatory) {
      setVisible(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="fade">
      <View style={styles.overlay}>
        <Animated.View style={[
          styles.modalContainer,
          {
            opacity: opacityValue,
            transform: [{ scale: scaleValue }]
          }
        ]}>
          <View style={styles.iconContainer}>
            <Ionicons name="cloud-download-outline" size={48} color="#FFD700" />
          </View>
          
          <Text style={styles.title}>Nova Atualização Disponível</Text>
          <Text style={styles.versionText}>
            Versão {updateInfo?.version} já está disponível (Atual: {currentVersion})
          </Text>
          
          <Text style={styles.description}>
            {updateInfo?.releaseNotes || "Melhorias de desempenho e correções de bugs."}
          </Text>

          {isDownloading ? (
            <View style={styles.progressContainer}>
              <Text style={styles.progressText}>Baixando... {Math.round(downloadProgress * 100)}%</Text>
              <View style={styles.progressBarBackground}>
                <View style={[styles.progressBarFill, { width: `${downloadProgress * 100}%` }]} />
              </View>
              <ActivityIndicator size="small" color="#FFD700" style={{ marginTop: 10 }} />
            </View>
          ) : (
            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={[styles.button, styles.primaryButton]}
                onPress={handleDownload}
                activeOpacity={0.8}
              >
                <Text style={styles.primaryButtonText}>Atualizar Agora</Text>
              </TouchableOpacity>
              
              {!updateInfo?.mandatory && (
                <TouchableOpacity
                  style={[styles.button, styles.secondaryButton]}
                  onPress={handleClose}
                  activeOpacity={0.8}
                >
                  <Text style={styles.secondaryButtonText}>Mais Tarde</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    backgroundColor: '#1C1C1E',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.2)',
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 8,
    textAlign: 'center',
  },
  versionText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 16,
    textAlign: 'center',
  },
  description: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  progressContainer: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 10,
  },
  progressText: {
    color: '#FFD700',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  progressBarBackground: {
    width: '100%',
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#FFD700',
    borderRadius: 4,
  },
  buttonContainer: {
    width: '100%',
    gap: 12,
  },
  button: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: '#FFD700',
  },
  primaryButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: 'bold',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  secondaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
