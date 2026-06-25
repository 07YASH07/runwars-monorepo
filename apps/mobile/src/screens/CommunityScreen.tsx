import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StatusBar,
} from 'react-native';
import { useMultiplayer } from '@/hooks/useMultiplayer';
import { CHARACTER_EMOJI, CharacterType } from '@runwars/shared';
import { useAuth } from '@/context/AuthContext';

export default function CommunityScreen() {
  const { user } = useAuth();
  const { livePlayers } = useMultiplayer();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredPlayers = livePlayers.filter((p) =>
    p.displayName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>COMMUNITY</Text>
      </View>

      {/* Search Input */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search runners..."
          placeholderTextColor="#A0A0A0"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Active Players Heading */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>LIVE IN THE ARENA ({livePlayers.length})</Text>
          <View style={styles.livePulseDot} />
        </View>

        {filteredPlayers.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No runners found.</Text>
            <Text style={styles.emptySub}>Other players will appear here in real-time when they log in.</Text>
          </View>
        ) : (
          filteredPlayers.map((player) => {
            const isSelf = player.userId === user?.uid;
            const emoji = CHARACTER_EMOJI[player.characterType as CharacterType] || '🏃';
            const playerColor = player.color || '#00BFFF';

            return (
              <View key={player.userId} style={styles.playerRow}>
                {/* Avatar */}
                <View style={[styles.avatar, { borderColor: playerColor }]}>
                  <Text style={styles.avatarEmoji}>{emoji}</Text>
                </View>

                {/* Info */}
                <View style={styles.playerInfo}>
                  <Text style={styles.playerName}>
                    {player.displayName.toUpperCase()} {isSelf && <Text style={styles.selfTag}>(YOU)</Text>}
                  </Text>
                  <Text style={styles.playerSub}>
                    Class: {player.characterType?.toUpperCase() || 'SCOUT'}
                  </Text>
                </View>

                {/* Status Indicator */}
                <View style={styles.statusCol}>
                  <View style={[styles.statusIndicator, player.isRunning ? styles.runningIndicator : styles.onlineIndicator]} />
                  <Text style={styles.statusText}>{player.isRunning ? 'RUNNING' : 'ONLINE'}</Text>
                </View>
              </View>
            );
          })
        )}

        {/* Dynamic community statistics / info */}
        <View style={styles.infoCard}>
          <Text style={styles.infoCardTitle}>⚔️ CONQUER AND CLAIM</Text>
          <Text style={styles.infoCardBody}>
            RunWars is a multiplayer battleground. Start a run in your local area to claim territories, or run through an opponent's territory with a higher total distance to capture it!
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  header: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1.5,
    borderBottomColor: '#EBEBEB',
    paddingTop: 54,
    paddingBottom: 16,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#000000',
    letterSpacing: 2,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#EBEBEB',
  },
  searchInput: {
    height: 40,
    backgroundColor: '#F5F5F7',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    fontWeight: '500',
    color: '#000',
  },
  scroll: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: '#8A8A8A',
    letterSpacing: 1,
  },
  livePulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#32CD32',
    marginLeft: 6,
  },
  emptyContainer: {
    paddingVertical: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#000',
  },
  emptySub: {
    fontSize: 11,
    color: '#8A8A8A',
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 24,
  },
  playerRow: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#EBEBEB',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2.5,
    backgroundColor: '#F5F5F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: {
    fontSize: 22,
  },
  playerInfo: {
    marginLeft: 12,
    flex: 1,
  },
  playerName: {
    fontSize: 13,
    fontWeight: '900',
    color: '#000000',
    letterSpacing: 0.5,
  },
  selfTag: {
    fontSize: 10,
    fontWeight: '900',
    color: '#8A8A8A',
  },
  playerSub: {
    fontSize: 10,
    color: '#8A8A8A',
    fontWeight: '600',
    marginTop: 2,
  },
  statusCol: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  onlineIndicator: {
    backgroundColor: '#32CD32',
  },
  runningIndicator: {
    backgroundColor: '#FF3B30',
  },
  statusText: {
    fontSize: 8,
    fontWeight: '900',
    color: '#8A8A8A',
    marginTop: 4,
    letterSpacing: 0.5,
  },
  infoCard: {
    marginTop: 24,
    backgroundColor: '#000000',
    borderRadius: 8,
    padding: 16,
  },
  infoCardTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 6,
  },
  infoCardBody: {
    color: '#A0A0A0',
    fontSize: 11,
    lineHeight: 18,
    fontWeight: '600',
  },
});
