import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { Colors, Typography, Spacing, BorderRadius } from '../../constants/Colors';

interface Team {
  name: string;
  image: string;
}

interface League {
  name: string;
  image: string;
}

interface EventItem {
  id: number;
  slug: string;
  title: string;
  league: League;
  teams: {
    home: Team;
    away: Team;
  };
  time_start: string;
  time_end: string;
  players: string[];
}

export default function EventsScreen() {
  const insets = useSafeAreaInsets();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchEvents = async () => {
    try {
      const response = await fetch('https://embedtv.cc/api/events');
      if (!response.ok) throw new Error('Network response was not ok');
      const data: EventItem[] = await response.json();
      // Sort by time_start if needed, assuming the API returns them ordered
      setEvents(data);
    } catch (error) {
      console.error('Failed to fetch events:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    fetchEvents();
  }, []);

  const handlePlay = (event: EventItem) => {
    // Determine player URL
    let playerUrl = '';
    if (event.players && event.players.length > 0) {
      playerUrl = event.players[0];
    }

    // Redirect to Player, passing slug as id
    router.push({
      pathname: '/player/[id]',
      params: {
        id: event.slug,
        url: playerUrl,
        name: event.title,
        category: event.league.name,
        logo: event.league.image,
      },
    });
  };

  const renderItem = ({ item }: { item: EventItem }) => {
    const startTime = new Date(item.time_start);
    const timeFormatted = startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.leagueInfo}>
            {item.league.image ? (
              <Image source={{ uri: item.league.image }} style={styles.leagueIcon} contentFit="contain" />
            ) : (
              <Ionicons name="trophy-outline" size={16} color={Colors.textSecondary} />
            )}
            <Text style={styles.leagueName} numberOfLines={1}>{item.league.name}</Text>
          </View>
          <View style={styles.timeBadge}>
            <Ionicons name="time-outline" size={14} color={Colors.textSecondary} style={{ marginRight: 4 }} />
            <Text style={styles.timeText}>{timeFormatted}</Text>
          </View>
        </View>

        <View style={styles.teamsContainer}>
          <View style={styles.team}>
            {item.teams.home.image ? (
              <Image source={{ uri: item.teams.home.image }} style={styles.teamLogo} contentFit="contain" />
            ) : (
              <View style={[styles.teamLogo, styles.placeholderLogo]}>
                <Ionicons name="shield-outline" size={24} color={Colors.textSecondary} />
              </View>
            )}
            <Text style={styles.teamName} numberOfLines={2} adjustsFontSizeToFit>{item.teams.home.name}</Text>
          </View>

          <View style={styles.vsContainer}>
            <Text style={styles.vsText}>X</Text>
          </View>

          <View style={styles.team}>
            {item.teams.away.image ? (
              <Image source={{ uri: item.teams.away.image }} style={styles.teamLogo} contentFit="contain" />
            ) : (
              <View style={[styles.teamLogo, styles.placeholderLogo]}>
                <Ionicons name="shield-outline" size={24} color={Colors.textSecondary} />
              </View>
            )}
            <Text style={styles.teamName} numberOfLines={2} adjustsFontSizeToFit>{item.teams.away.name}</Text>
          </View>
        </View>

        <TouchableOpacity 
          style={styles.playButton} 
          onPress={() => handlePlay(item)}
          activeOpacity={0.8}
        >
          <Ionicons name="play" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
          <Text style={styles.playButtonText}>Assistir</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Eventos ao Vivo</Text>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlashList
          data={events}
          renderItem={renderItem}
          keyExtractor={(item) => item.id.toString()}
          estimatedItemSize={200}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 80 }]}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={Colors.primary}
              colors={[Colors.primary]}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="calendar-outline" size={64} color={Colors.textSecondary} />
              <Text style={styles.emptyText}>Nenhum evento disponível no momento.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: Typography.h2.fontSize,
    fontWeight: 'bold',
    color: Colors.text,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: Spacing.md,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  leagueInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: Spacing.sm,
  },
  leagueIcon: {
    width: 20,
    height: 20,
    marginRight: 6,
    borderRadius: 10,
  },
  leagueName: {
    fontSize: Typography.caption.fontSize,
    color: Colors.textSecondary,
    fontWeight: '600',
    flex: 1,
  },
  timeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: BorderRadius.sm,
  },
  timeText: {
    fontSize: Typography.caption.fontSize,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  teamsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  team: {
    flex: 1,
    alignItems: 'center',
  },
  teamLogo: {
    width: 60,
    height: 60,
    marginBottom: Spacing.sm,
  },
  placeholderLogo: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 30,
  },
  teamName: {
    fontSize: Typography.body.fontSize,
    color: Colors.text,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  vsContainer: {
    paddingHorizontal: Spacing.md,
  },
  vsText: {
    fontSize: Typography.h3.fontSize,
    color: Colors.textSecondary,
    fontWeight: '900',
    opacity: 0.5,
  },
  playButton: {
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  playButtonText: {
    color: '#FFFFFF',
    fontSize: Typography.body.fontSize,
    fontWeight: 'bold',
  },
  emptyContainer: {
    paddingTop: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    marginTop: Spacing.md,
    fontSize: Typography.body.fontSize,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
});
