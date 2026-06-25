import { useEffect, useState } from 'react';
import { LivePlayerState, Territory } from '@runwars/shared';
import { socketService } from '@/services/SocketService';
import { useAuth } from '@/context/AuthContext';

export function useMultiplayer() {
  const { user } = useAuth();
  const [livePlayers, setLivePlayers] = useState<LivePlayerState[]>([]);
  const [territories, setTerritories] = useState<Territory[]>([]);

  useEffect(() => {
    if (!user) return;

    // Connect to socket when hook mounts
    socketService.connect(
      user.uid,
      user.displayName || 'Unknown Runner',
      user.characterType || 'scout',
      user.color || '#00BFFF'
    );

    // Listeners
    const handlePlayersUpdate = (players: LivePlayerState[]) => {
      // Filter out ourselves
      setLivePlayers(players.filter((p) => p.userId !== user.uid));
    };

    const handleTerritoriesUpdate = (terrs: Territory[]) => {
      setTerritories(terrs);
    };

    const handleNewTerritory = (terr: Territory) => {
      setTerritories((prev) => {
        // Prevent duplicates
        if (prev.find((t) => t.id === terr.id)) return prev;
        return [...prev, terr];
      });
    };

    socketService.onEvent('livePlayersUpdate', handlePlayersUpdate);
    socketService.onEvent('territoriesUpdate', handleTerritoriesUpdate);
    socketService.onEvent('territoryClaimed', handleNewTerritory);

    return () => {
      socketService.offEvent('livePlayersUpdate', handlePlayersUpdate);
      socketService.offEvent('territoriesUpdate', handleTerritoriesUpdate);
      socketService.offEvent('territoryClaimed', handleNewTerritory);
      
      // In a real app, you might not want to disconnect entirely if navigating between tabs,
      // but for simplicity in Phase 3, we disconnect if the multiplayer hook unmounts.
      // socketService.disconnect();
    };
  }, [user]);

  return {
    livePlayers,
    territories,
    socketService,
  };
}
