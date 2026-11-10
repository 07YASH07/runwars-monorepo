/**
 * ArenaShopSheet — class archetype, companion avatars and territory colours.
 * All actions are server-validated (coins, unlocks) via authenticated APIs.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import type { CharacterType } from '@runwars/shared';
import { COLORS, CLASS_THEMES, RADII, SPACING } from '@/theme/tokens';
import { ModalContainer } from '@/components/ui';
import { apiFetch, errorMessage } from '@/config/api';

const MILESTONE_AVATARS = [
  { avatar: '🦊', name: 'Swift Fox', requiredKm: 5 },
  { avatar: '🐺', name: 'Lone Wolf', requiredKm: 10 },
  { avatar: '🦁', name: 'Lion King', requiredKm: 25 },
  { avatar: '🦅', name: 'Soaring Eagle', requiredKm: 50 },
  { avatar: '🐉', name: 'Dragon', requiredKm: 100 },
];

const PREMIUM_AVATARS = [
  { avatar: '🤖', name: 'Cyborg', cost: 150 },
  { avatar: '🦄', name: 'Unicorn', cost: 150 },
  { avatar: '👾', name: 'Ghost', cost: 150 },
  { avatar: '⚡', name: 'Lightning', cost: 150 },
  { avatar: '🌟', name: 'Star', cost: 150 },
];

const SHOP_COLORS = [
  { name: 'Green', hex: '#22C55E' },
  { name: 'Sky', hex: '#38BDF8' },
  { name: 'Violet', hex: '#A78BFA' },
  { name: 'Amber', hex: '#F59E0B' },
  { name: 'Red', hex: '#EF4444' },
  { name: 'Cyan', hex: '#22D3EE' },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  coins: number;
  totalKm: number;
  characterType: string;
  color: string;
  selectedAvatar?: string | null;
  unlockedAvatars: string[];
  unlockedColors: string[];
  onChanged: (patch?: { characterType?: CharacterType; color?: string }) => void;
}

export default function ArenaShopSheet(p: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  const post = async (key: string, url: string, body: any, success: string, patch?: any) => {
    setBusy(key);
    try {
      const res = await apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        Alert.alert('Not completed', await errorMessage(res, 'Please try again.'));
        return;
      }
      p.onChanged(patch);
      if (success) Alert.alert('Done', success);
    } catch (e: any) {
      Alert.alert('Network error', e?.message || 'Could not reach the server.');
    } finally {
      setBusy(null);
    }
  };

  const selectClass = (c: CharacterType) => {
    if (c === p.characterType) return;
    const theme = CLASS_THEMES[c as keyof typeof CLASS_THEMES];
    post(`class-${c}`, '/api/profile/update', { characterType: c }, `You are now a ${theme.name}.`, { characterType: c });
  };

  const selectColor = (hex: string, unlocked: boolean) => {
    if (hex.toLowerCase() === p.color.toLowerCase()) return;
    if (unlocked) {
      post(`color-${hex}`, '/api/profile/update', { color: hex }, 'Territory colour updated.', { color: hex });
    } else if (p.coins < 200) {
      Alert.alert('Not enough coins', `This colour costs 200 coins. You have ${p.coins}.`);
    } else {
      Alert.alert('Unlock colour?', 'Spend 200 Arena Coins to unlock this territory colour?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unlock', onPress: () => post(`color-${hex}`, '/api/shop/unlock-color', { color: hex }, 'Colour unlocked. Tap it again to use it.') },
      ]);
    }
  };

  const unlockAvatar = (avatar: string, cost: number) => {
    if (p.coins < cost) {
      Alert.alert('Not enough coins', `This companion costs ${cost} coins. You have ${p.coins}.`);
      return;
    }
    Alert.alert('Unlock companion?', `Spend ${cost} Arena Coins?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unlock', onPress: () => post(`buy-${avatar}`, '/api/shop/unlock-avatar', { avatar }, 'Companion unlocked.') },
    ]);
  };

  const equip = (avatar: string) => post(`equip-${avatar}`, '/api/shop/set-avatar', { avatar }, '');

  const claimMilestones = () => post('milestones', '/api/shop/check-milestones', {}, 'Milestone companions refreshed.');

  return (
    <ModalContainer visible={p.visible} onClose={p.onClose} title="Arena Shop" subtitle={`🪙 ${p.coins} coins available`}>
      <Text style={styles.section}>CLASS</Text>
      <View style={styles.grid}>
        {(['scout', 'warrior', 'titan', 'ghost'] as CharacterType[]).map((c) => {
          const meta = CLASS_THEMES[c as keyof typeof CLASS_THEMES];
          const active = p.characterType === c;
          return (
            <TouchableOpacity
              key={c}
              style={[styles.classCard, active && { borderColor: meta.color }]}
              onPress={() => selectClass(c)}
              disabled={!!busy}
              testID={`shop-class-${c}`}
            >
              <Text style={styles.classEmoji}>{meta.emoji}</Text>
              <Text style={[styles.className, { color: meta.color }]}>{meta.name}</Text>
              <Text style={styles.classBonus} numberOfLines={2}>{meta.bonus}</Text>
              {busy === `class-${c}` ? <ActivityIndicator size="small" color={meta.color} /> : active ? <Text style={styles.activeTag}>ACTIVE</Text> : null}
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.section}>TERRITORY COLOUR</Text>
      <View style={styles.swatches}>
        {SHOP_COLORS.map((c) => {
          const unlocked = p.unlockedColors.some(u => u.toLowerCase() === c.hex.toLowerCase()) || p.color.toLowerCase() === c.hex.toLowerCase();
          const active = p.color.toLowerCase() === c.hex.toLowerCase();
          return (
            <TouchableOpacity
              key={c.hex}
              style={[styles.swatch, { backgroundColor: c.hex }, active && styles.swatchActive]}
              onPress={() => selectColor(c.hex, unlocked)}
              disabled={!!busy}
              accessibilityLabel={`${c.name} colour${unlocked ? '' : ' (locked)'}`}
              testID={`shop-color-${c.name}`}
            >
              {busy === `color-${c.hex}` ? <ActivityIndicator size="small" color="#0B1220" /> :
                <Text style={styles.swatchMark}>{active ? '✓' : unlocked ? '' : '🔒'}</Text>}
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.sectionRow}>
        <Text style={styles.section}>DISTANCE COMPANIONS</Text>
        <TouchableOpacity onPress={claimMilestones} disabled={!!busy} testID="shop-check-milestones">
          <Text style={styles.link}>{busy === 'milestones' ? 'Checking…' : 'Refresh'}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.grid}>
        {MILESTONE_AVATARS.map((m) => {
          const unlocked = p.unlockedAvatars.includes(m.avatar);
          const earnedByKm = p.totalKm >= m.requiredKm;
          const equipped = p.selectedAvatar === m.avatar;
          return (
            <View key={m.avatar} style={styles.item}>
              <Text style={styles.itemEmoji}>{m.avatar}</Text>
              <Text style={styles.itemName}>{m.name}</Text>
              <Text style={styles.itemReq}>{m.requiredKm} km</Text>
              {equipped ? <Text style={styles.activeTag}>EQUIPPED</Text> :
                unlocked ? (
                  <TouchableOpacity style={styles.smallBtn} onPress={() => equip(m.avatar)} disabled={!!busy}>
                    <Text style={styles.smallBtnText}>{busy === `equip-${m.avatar}` ? '…' : 'Equip'}</Text>
                  </TouchableOpacity>
                ) : earnedByKm ? (
                  <TouchableOpacity style={styles.smallBtn} onPress={claimMilestones} disabled={!!busy}>
                    <Text style={styles.smallBtnText}>Claim</Text>
                  </TouchableOpacity>
                ) : <Text style={styles.locked}>🔒 {(m.requiredKm - p.totalKm).toFixed(1)} km to go</Text>}
            </View>
          );
        })}
      </View>

      <Text style={styles.section}>PREMIUM COMPANIONS</Text>
      <View style={styles.grid}>
        {PREMIUM_AVATARS.map((a) => {
          const unlocked = p.unlockedAvatars.includes(a.avatar);
          const equipped = p.selectedAvatar === a.avatar;
          return (
            <View key={a.avatar} style={styles.item}>
              <Text style={styles.itemEmoji}>{a.avatar}</Text>
              <Text style={styles.itemName}>{a.name}</Text>
              <Text style={styles.itemReq}>🪙 {a.cost}</Text>
              {equipped ? <Text style={styles.activeTag}>EQUIPPED</Text> : (
                <TouchableOpacity
                  style={[styles.smallBtn, !unlocked && styles.smallBtnPrimary]}
                  onPress={() => (unlocked ? equip(a.avatar) : unlockAvatar(a.avatar, a.cost))}
                  disabled={!!busy}
                  testID={`shop-avatar-${a.name}`}
                >
                  <Text style={[styles.smallBtnText, !unlocked && { color: COLORS.textInverse }]}>
                    {busy === `buy-${a.avatar}` || busy === `equip-${a.avatar}` ? '…' : unlocked ? 'Equip' : 'Unlock'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </View>
    </ModalContainer>
  );
}

const styles = StyleSheet.create({
  section: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginTop: SPACING.lg, marginBottom: SPACING.sm },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  link: { color: COLORS.secondary, fontSize: 13, fontWeight: '700', marginBottom: SPACING.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  classCard: {
    width: '48%', backgroundColor: COLORS.bgCard, borderRadius: RADII.md, borderWidth: 1.5,
    borderColor: COLORS.border, padding: SPACING.md, minHeight: 112,
  },
  classEmoji: { fontSize: 22 },
  className: { fontSize: 15, fontWeight: '800', marginTop: 4 },
  classBonus: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2, marginBottom: 6 },
  activeTag: { color: COLORS.primary, fontSize: 10, fontWeight: '800', letterSpacing: 0.6, marginTop: 4 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.md },
  swatch: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  swatchActive: { borderColor: COLORS.textPrimary },
  swatchMark: { color: '#0B1220', fontSize: 16, fontWeight: '900' },
  item: {
    width: '31%', backgroundColor: COLORS.bgCard, borderRadius: RADII.md, borderWidth: 1,
    borderColor: COLORS.border, padding: SPACING.sm, alignItems: 'center', minHeight: 120,
  },
  itemEmoji: { fontSize: 28 },
  itemName: { color: COLORS.textPrimary, fontSize: 12, fontWeight: '700', marginTop: 4, textAlign: 'center' },
  itemReq: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  locked: { color: COLORS.textMuted, fontSize: 10, marginTop: 6, textAlign: 'center' },
  smallBtn: {
    marginTop: 6, minHeight: 32, paddingHorizontal: 12, borderRadius: RADII.sm, borderWidth: 1,
    borderColor: COLORS.secondary, alignItems: 'center', justifyContent: 'center',
  },
  smallBtnPrimary: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  smallBtnText: { color: COLORS.secondary, fontSize: 12, fontWeight: '800' },
});
