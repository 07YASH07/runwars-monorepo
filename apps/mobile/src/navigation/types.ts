/**
 * Navigation type definitions for RunWars.
 * All stack and tab param lists are strictly typed here.
 */

// ─── Auth Stack ───────────────────────────────────────────────────────────────

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  CharacterSelect: undefined;
};

// ─── Main Tab Navigator ───────────────────────────────────────────────────────

export type MainTabParamList = {
  Feed: undefined;
  Community: undefined;
  Activity: undefined;
  Progress: undefined;
  Profile: undefined;
};

// ─── Root Stack ───────────────────────────────────────────────────────────────

export type RootStackParamList = {
  Auth: undefined;    // nested AuthStack
  Main: undefined;    // nested MainTabs
};
