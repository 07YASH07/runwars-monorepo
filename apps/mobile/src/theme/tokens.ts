/**
 * StrideClash Design System Tokens
 * Premium Futuristic Esports & Fitness Aesthetic
 */

export const COLORS = {
  // Backgrounds (StrideClash 2026 palette)
  bgCanvas: '#0B1220',
  bgSurface: '#101B2D',
  bgCard: '#162238',
  bgSurfaceElevated: '#1D2B42',
  bgGlass: 'rgba(16, 27, 45, 0.92)',
  bgGlassSubtle: 'rgba(148, 163, 184, 0.06)',
  bgGlassCard: '#162238',

  // Borders
  border: '#29384F',
  borderSubtle: '#29384F',
  borderMedium: '#3A4B66',
  borderActive: 'rgba(34, 197, 94, 0.55)',
  borderGlow: 'rgba(56, 189, 248, 0.55)',

  // Accents (legacy key names kept so every screen picks up the new palette)
  primary: '#22C55E',
  secondary: '#38BDF8',
  amber: '#F59E0B',
  neonGreen: '#22C55E',      // Primary / Start / Claim
  electricBlue: '#38BDF8',   // Secondary / Route / GPS
  cyberPurple: '#A78BFA',    // Rare / Boosts
  gold: '#F59E0B',           // Coins / 1st place
  silver: '#CBD5E1',         // 2nd place
  bronze: '#D97706',         // 3rd place
  crimson: '#EF4444',        // Danger / Stop / Rival
  warningAmber: '#F59E0B',   // Pause / Warning

  // Text
  textPrimary: '#F8FAFC',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  textInverse: '#0B1220',

  // Map polygons
  mapFillUser: 'rgba(34, 197, 94, 0.28)',
  mapStrokeUser: '#22C55E',
  mapFillRival: 'rgba(239, 68, 68, 0.25)',
  mapStrokeRival: '#EF4444',
  mapFillNeutral: 'rgba(56, 189, 248, 0.20)',
  mapStrokeNeutral: '#38BDF8',
} as const;

export const TYPE = {
  display: { fontSize: 28, fontWeight: '800' as const, letterSpacing: 0.2 },
  title: { fontSize: 20, fontWeight: '800' as const },
  heading: { fontSize: 16, fontWeight: '700' as const },
  body: { fontSize: 14, fontWeight: '500' as const },
  caption: { fontSize: 12, fontWeight: '500' as const },
  label: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.8 },
} as const;

/** Standard control heights (dp). */
export const CONTROL = { sm: 36, md: 44, lg: 52, hero: 64 } as const;

export const CLASS_THEMES = {
  scout: {
    name: 'Scout',
    subtitle: 'Agile Vanguard',
    emoji: '⚡',
    color: '#00FF88',
    glow: 'rgba(0, 255, 136, 0.35)',
    bonus: '+15% Speed Arena Coins',
    description: 'Blisteringly fast and agile. Claims new sprint zones effortlessly.',
  },
  warrior: {
    name: 'Warrior',
    subtitle: 'Turf Conqueror',
    emoji: '⚔️',
    color: '#FF2A55',
    glow: 'rgba(255, 42, 85, 0.35)',
    bonus: '+20% Turf Capture Radius',
    description: 'Frontline fighter who secures massive territory with endurance.',
  },
  titan: {
    name: 'Titan',
    subtitle: 'Defensive Colossus',
    emoji: '🛡️',
    color: '#00BFFF',
    glow: 'rgba(0, 191, 255, 0.35)',
    bonus: '+30% Zone Defense Fortification',
    description: 'Immovable rock. Fortifies territories so rivals struggle to steal.',
  },
  ghost: {
    name: 'Ghost',
    subtitle: 'Stealth Phantom',
    emoji: '👻',
    color: '#9D00FF',
    glow: 'rgba(157, 0, 255, 0.35)',
    bonus: 'Stealth GPS Recon & Night Bonus',
    description: 'Swift and silent. Masks trajectory until the territory is locked.',
  },
} as const;

export type ClassType = keyof typeof CLASS_THEMES;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  hero: 36,
} as const;

export const RADII = {
  sm: 8,
  md: 14,
  lg: 20,
  pill: 999,
} as const;

export const SHADOWS = {
  neonGlow: {
    shadowColor: COLORS.neonGreen,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  blueGlow: {
    shadowColor: COLORS.electricBlue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  purpleGlow: {
    shadowColor: COLORS.cyberPurple,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  crimsonGlow: {
    shadowColor: COLORS.crimson,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  goldGlow: {
    shadowColor: COLORS.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  surface: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.55,
    shadowRadius: 10,
    elevation: 6,
  },
} as const;
