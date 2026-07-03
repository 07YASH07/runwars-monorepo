import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StatusBar,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { useMultiplayer } from '@/hooks/useMultiplayer';
import { CHARACTER_EMOJI, CharacterType } from '@runwars/shared';
import { useAuth } from '@/context/AuthContext';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://10.0.2.2:3000';

interface ProfileStats {
  total_distance: number;
  total_runs: number;
  total_territory: number;
  total_zones: number;
}

interface ProfileData {
  user: {
    id: string;
    display_name: string;
    character_type: string;
    color: string;
    bio: string;
  };
  stats: ProfileStats;
}

export default function CommunityScreen() {
  const { user } = useAuth();
  const { livePlayers } = useMultiplayer();
  const [searchQuery, setSearchQuery] = useState('');

  // Profile Modal State
  const [profileVisible, setProfileVisible] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  const filteredPlayers = livePlayers.filter((p) =>
    p.displayName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const openUserProfile = async (targetUserId: string) => {
    setSelectedUserId(targetUserId);
    setProfileVisible(true);
    setLoadingProfile(true);
    setProfileData(null);
    try {
      const res = await fetch(`${API_URL}/api/profile/${targetUserId}`, {
        headers: { 'Bypass-Tunnel-Reminder': 'true' }
      });
      if (res.ok) {
        const data = await res.json();
        setProfileData(data);
      }
    } catch (err) {
      console.error('[Community] Failed to load profile:', err);
    } finally {
      setLoadingProfile(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0D0D1A" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>👥 COMMUNITY</Text>
        <Text style={styles.headerSub}>Live players currently in the Arena</Text>
      </View>

      {/* Search Input */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search runners..."
          placeholderTextColor="#4A4A6A"
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
              <TouchableOpacity
                key={player.userId}
                style={[styles.playerRow, { borderColor: playerColor + '44' }]}
                onPress={() => openUserProfile(player.userId)}
                activeOpacity={0.8}
              >
                {/* Avatar */}
                <View style={[styles.avatar, { borderColor: playerColor, backgroundColor: playerColor + '11' }]}>
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
              </TouchableOpacity>
            );
          })
        )}

        {/* Dynamic community statistics / info */}
        <View style={styles.infoCard}>
          <Text style={styles.infoCardTitle}>⚔️ CONQUER AND CLAIM</Text>
          <Text style={styles.infoCardBody}>
            RunWars is a real-time multiplayer battleground. Start a run in your local area to claim territories, or run through an opponent's territory with a higher speed or total distance to capture it!
          </Text>
        </View>

        <View style={styles.infoCard}>
          <Text style={[styles.infoCardTitle, { color: '#00BFFF' }]}>🏃 ARENA RULES</Text>
          <Text style={styles.infoCardBody}>
            • Speed limits are enforced per activity type (Walk: 10 km/h, Run: 40 km/h, Cycle: 70 km/h).
            • Claim logs are saved persistently and broadcasted directly to the social feed.
            • Work together with your faction to dominate the global grids!
          </Text>
        </View>
      </ScrollView>

      {/* Mini Profile Card Modal Overlay */}
      <Modal visible={profileVisible} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setProfileVisible(false)}
        >
          <View style={styles.profileCard} onStartShouldSetResponder={() => true}>
            {loadingProfile ? (
              <ActivityIndicator color="#00BFFF" size="large" />
            ) : profileData ? (
              <>
                <View style={[styles.profileAvatar, { borderColor: profileData.user.color }]}>
                  <Text style={styles.profileAvatarEmoji}>
                    {CHARACTER_EMOJI[profileData.user.character_type as CharacterType] || '🏃'}
                  </Text>
                </View>
                <Text style={styles.profileName}>{profileData.user.display_name}</Text>
                <Text style={[styles.profileClass, { color: profileData.user.color }]}>
                  {profileData.user.character_type.toUpperCase()}
                </Text>
                {profileData.user.bio ? (
                  <Text style={styles.profileBio}>"{profileData.user.bio}"</Text>
                ) : null}

                <View style={styles.profileDivider} />

                {/* Grid Stats */}
                <View style={styles.statsGrid}>
                  <View style={styles.statsGridCol}>
                    <Text style={styles.gridStatVal}>
                      {((profileData.stats.total_distance || 0) / 1000).toFixed(1)}
                    </Text>
                    <Text style={styles.gridStatLbl}>KM</Text>
                  </View>
                  <View style={styles.statsGridCol}>
                    <Text style={styles.gridStatVal}>{profileData.stats.total_runs || 0}</Text>
                    <Text style={styles.gridStatLbl}>RUNS</Text>
                  </View>
                  <View style={styles.statsGridCol}>
                    <Text style={styles.gridStatVal}>{profileData.stats.total_zones || 0}</Text>
                    <Text style={styles.gridStatLbl}>ZONES</Text>
                  </View>
                </View>
              </>
            ) : (
              <Text style={styles.noProfileText}>Failed to load profile details.</Text>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D1A',
  },
  header: {
    backgroundColor: '#111124',
    borderBottomWidth: 1,
    borderBottomColor: '#1E1E38',
    paddingTop: 55,
    paddingBottom: 16,
    paddingHorizontal: 20,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#00BFFF',
    letterSpacing: 2,
  },
  headerSub: {
    fontSize: 12,
    color: '#4A4A6A',
    marginTop: 4,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#0D0D1A',
    borderBottomWidth: 1,
    borderBottomColor: '#1E1E38',
  },
  searchInput: {
    height: 40,
    backgroundColor: '#16162A',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#2A2A4A',
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
    fontSize: 11,
    fontWeight: '900',
    color: '#4A4A6A',
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
    color: '#FFFFFF',
  },
  emptySub: {
    fontSize: 11,
    color: '#4A4A6A',
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 24,
  },
  playerRow: {
    backgroundColor: '#16162A',
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: {
    fontSize: 20,
  },
  playerInfo: {
    marginLeft: 12,
    flex: 1,
  },
  playerName: {
    fontSize: 14,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  selfTag: {
    fontSize: 10,
    fontWeight: '900',
    color: '#00BFFF',
  },
  playerSub: {
    fontSize: 11,
    color: '#4A4A6A',
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
    color: '#4A4A6A',
    marginTop: 4,
    letterSpacing: 0.5,
  },
  infoCard: {
    marginTop: 16,
    backgroundColor: '#16162A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A4A',
    padding: 16,
  },
  infoCardTitle: {
    color: '#FF8C00',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 6,
  },
  infoCardBody: {
    color: '#8A8AAB',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },

  // Modal Profile styling
  modalOverlay: {
    flex: 1,
    backgroundColor: '#000000AA',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileCard: {
    width: '80%',
    backgroundColor: '#16162A',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#00BFFF',
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 10,
  },
  profileAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    backgroundColor: '#0D0D1A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  profileAvatarEmoji: { fontSize: 44 },
  profileName: { fontSize: 18, fontWeight: '900', color: '#FFFFFF' },
  profileClass: { fontSize: 11, fontWeight: '900', marginTop: 4 },
  profileBio: { fontSize: 13, color: '#8A8AAB', textAlign: 'center', marginTop: 10, fontStyle: 'italic' },
  profileDivider: { width: '100%', height: 1, backgroundColor: '#2A2A4A', marginVertical: 16 },

  statsGrid: { flexDirection: 'row', width: '100%', justifyContent: 'space-around' },
  statsGridCol: { alignItems: 'center' },
  gridStatVal: { fontSize: 16, fontWeight: '900', color: '#FFFFFF' },
  gridStatLbl: { fontSize: 9, color: '#4A4A6A', fontWeight: '800', marginTop: 2 },
  noProfileText: { color: '#4A4A6A', textAlign: 'center' },
});
