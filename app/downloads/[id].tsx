import React, { useMemo, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    StatusBar,
    Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Colors, Typography, Spacing, BorderRadius } from '../../constants/Colors';
import { useDownloadStore } from '../../stores/downloadStore';
import { downloadManager } from '../../services/downloadManager';
import { formatBytes } from '../../services/downloadUtils';
import type { DownloadItem } from '../../types';

export default function SeriesDownloadsDetailScreen() {
    const { id: seriesId } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const insets = useSafeAreaInsets();

    const items = useDownloadStore((s) => s.items);

    // All downloaded episodes for this series
    const episodes = useMemo(
        () =>
            Object.values(items)
                .filter((i) => (i.seriesId ?? i.mediaId) === seriesId && i.itemType === 'episode')
                .sort((a, b) => {
                    if (a.seasonNumber !== b.seasonNumber) return (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0);
                    return (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0);
                }),
        [items, seriesId]
    );

    // Group by season
    const seasons = useMemo(() => {
        const map: Record<number, DownloadItem[]> = {};
        for (const ep of episodes) {
            const s = ep.seasonNumber ?? 0;
            if (!map[s]) map[s] = [];
            map[s].push(ep);
        }
        return Object.entries(map)
            .map(([s, eps]) => ({ season: parseInt(s), episodes: eps }))
            .sort((a, b) => a.season - b.season);
    }, [episodes]);

    const first = episodes[0];
    const title = first?.mediaSnapshot.tmdb?.title || first?.title || 'Série';
    const poster = first?.posterUrl;
    const totalSize = episodes.reduce((a, e) => a + e.fileSize, 0);

    const handlePlayEpisode = useCallback(
        (ep: DownloadItem) => {
            router.push({
                pathname: '/media-player/[id]' as any,
                params: {
                    id: ep.id,
                    url: encodeURIComponent(ep.localPath),
                    title: `${title} · ${ep.subtitle ?? ''}`,
                    offline: '1',
                },
            });
        },
        [router, title]
    );

    const handleDeleteEpisode = useCallback((ep: DownloadItem) => {
        Alert.alert(
            'Excluir episódio?',
            ep.subtitle ?? ep.title,
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Excluir',
                    style: 'destructive',
                    onPress: () => downloadManager.removeDownload(ep.id),
                },
            ]
        );
    }, []);

    const handleDeleteAll = useCallback(() => {
        Alert.alert(
            `Excluir ${title}?`,
            `${episodes.length} episódio${episodes.length !== 1 ? 's' : ''} serão removidos.`,
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Excluir tudo',
                    style: 'destructive',
                    onPress: async () => {
                        for (const ep of episodes) {
                            await downloadManager.removeDownload(ep.id);
                        }
                        router.back();
                    },
                },
            ]
        );
    }, [episodes, title, router]);

    if (episodes.length === 0) {
        router.back();
        return null;
    }

    return (
        <View style={styles.container}>
            <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

            <ScrollView
                showsVerticalScrollIndicator={false}
                bounces={false}
                contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
            >
                {/* Hero */}
                <View style={[styles.hero, { paddingTop: insets.top + 10 }]}>
                    <Image
                        source={{ uri: first?.mediaSnapshot.tmdb?.poster ?? poster ?? '' }}
                        style={styles.heroBg}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                    />
                    <View style={styles.heroOverlay} />

                    {/* Back */}
                    <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
                        <Ionicons name="arrow-back" size={24} color={Colors.text} />
                    </TouchableOpacity>

                    <View style={styles.heroContent}>
                        <Image
                            source={{ uri: first?.mediaSnapshot.tmdb?.poster ?? poster ?? '' }}
                            style={styles.poster}
                            contentFit="cover"
                            cachePolicy="memory-disk"
                        />
                        <View style={styles.heroInfo}>
                            <Text style={styles.heroTitle} numberOfLines={2}>{title}</Text>
                            <Text style={styles.heroMeta}>
                                {episodes.length} episódio{episodes.length !== 1 ? 's' : ''} baixado{episodes.length !== 1 ? 's' : ''}
                            </Text>
                            <Text style={styles.heroSize}>{formatBytes(totalSize)}</Text>
                        </View>
                    </View>
                </View>

                {/* Delete all button */}
                <View style={styles.actions}>
                    <TouchableOpacity style={styles.deleteAllBtn} onPress={handleDeleteAll}>
                        <Ionicons name="trash-outline" size={18} color={Colors.error} />
                        <Text style={styles.deleteAllText}>Excluir todos os episódios</Text>
                    </TouchableOpacity>
                </View>

                {/* Episodes by season */}
                {seasons.map(({ season, episodes: eps }) => (
                    <View key={season} style={styles.seasonSection}>
                        <Text style={styles.seasonTitle}>
                            {season === 0 ? 'Episódios' : `Temporada ${season}`}
                        </Text>

                        {eps.map((ep) => (
                            <TouchableOpacity
                                key={ep.id}
                                style={styles.episodeCard}
                                onPress={() => handlePlayEpisode(ep)}
                                activeOpacity={0.8}
                            >
                                <View style={styles.episodeNumber}>
                                    <Text style={styles.episodeNumberText}>
                                        {ep.episodeNumber ?? '?'}
                                    </Text>
                                </View>

                                <View style={styles.episodeInfo}>
                                    <Text style={styles.episodeName} numberOfLines={1}>
                                        {ep.subtitle ?? `Episódio ${ep.episodeNumber}`}
                                    </Text>
                                    <Text style={styles.episodeSize}>{formatBytes(ep.fileSize)}</Text>
                                </View>

                                <TouchableOpacity
                                    onPress={() => handleDeleteEpisode(ep)}
                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                    style={styles.deleteEpBtn}
                                >
                                    <Ionicons name="trash-outline" size={18} color={Colors.textSecondary} />
                                </TouchableOpacity>

                                <Ionicons name="play-circle" size={32} color={Colors.primary} />
                            </TouchableOpacity>
                        ))}
                    </View>
                ))}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: Colors.background,
    },
    hero: {
        height: 260,
        position: 'relative',
        justifyContent: 'flex-end',
    },
    heroBg: {
        ...StyleSheet.absoluteFillObject,
    },
    heroOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.6)',
    },
    backBtn: {
        position: 'absolute',
        top: 50,
        left: Spacing.lg,
        backgroundColor: 'rgba(0,0,0,0.5)',
        padding: Spacing.sm,
        borderRadius: BorderRadius.full,
        zIndex: 10,
    },
    heroContent: {
        flexDirection: 'row',
        gap: Spacing.md,
        alignItems: 'flex-end',
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.lg,
    },
    poster: {
        width: 80,
        height: 120,
        borderRadius: BorderRadius.md,
        backgroundColor: Colors.surface,
    },
    heroInfo: {
        flex: 1,
        paddingBottom: Spacing.xs,
    },
    heroTitle: {
        color: Colors.text,
        fontSize: Typography.h2.fontSize,
        fontWeight: '700',
        lineHeight: 28,
    },
    heroMeta: {
        color: Colors.textSecondary,
        fontSize: Typography.caption.fontSize,
        marginTop: Spacing.xs,
    },
    heroSize: {
        color: Colors.primary,
        fontSize: Typography.caption.fontSize,
        fontWeight: '600',
        marginTop: 2,
    },
    actions: {
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: Colors.border,
    },
    deleteAllBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        paddingVertical: Spacing.sm,
    },
    deleteAllText: {
        color: Colors.error,
        fontSize: Typography.body.fontSize,
        fontWeight: '600',
    },
    seasonSection: {
        marginTop: Spacing.lg,
        paddingHorizontal: Spacing.lg,
    },
    seasonTitle: {
        color: Colors.text,
        fontSize: Typography.h3.fontSize,
        fontWeight: '700',
        marginBottom: Spacing.md,
    },
    episodeCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: Colors.surface,
        borderRadius: BorderRadius.md,
        padding: Spacing.md,
        marginBottom: Spacing.sm,
        gap: Spacing.md,
    },
    episodeNumber: {
        width: 40,
        height: 40,
        borderRadius: BorderRadius.sm,
        backgroundColor: Colors.background,
        justifyContent: 'center',
        alignItems: 'center',
    },
    episodeNumberText: {
        color: Colors.text,
        fontSize: Typography.h3.fontSize,
        fontWeight: '700',
    },
    episodeInfo: {
        flex: 1,
    },
    episodeName: {
        color: Colors.text,
        fontSize: Typography.body.fontSize,
        fontWeight: '500',
    },
    episodeSize: {
        color: Colors.textSecondary,
        fontSize: Typography.caption.fontSize,
        marginTop: 2,
    },
    deleteEpBtn: {
        padding: Spacing.xs,
    },
});
