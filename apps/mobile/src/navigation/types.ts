/**
 * Navigation type definitions for StrideClash.
 * 5 bottom tabs, two of which host nested top-tab navigators.
 * See App.tsx for the actual tree.
 */

import type { PostRunParams } from '@/screens/PostRunScreen';
import type { FollowersListParams } from '@/screens/FollowersListScreen';

// ─── Auth Stack ───────────────────────────────────────────────────────────────

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  CharacterSelect: undefined;
};

// ─── Main 5-Tab Navigator ─────────────────────────────────────────────────────
// MAP | COMPETE | RUN | COMMUNITY | PROFILE

export type MainTabParamList = {
  MAP: undefined;
  COMPETE: undefined;
  RUN: undefined;
  COMMUNITY: undefined;
  PROFILE: undefined;
};

// COMPETE inner tabs
export type CompeteTopTabParamList = {
  Battles: undefined;
  Rankings: undefined;
};

// COMMUNITY inner tabs
export type CommunityTopTabParamList = {
  Feed: undefined;
  Players: undefined;
};

// ─── Root Stack ───────────────────────────────────────────────────────────────

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
  PostRun: PostRunParams;
  FollowersList: FollowersListParams;
  /** Full profile of any user (own profile lives in the PROFILE tab). */
  UserProfile: { userId: string };
};
