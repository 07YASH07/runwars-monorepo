/**
 * StrideClash Design System Tokens
 * Premium Futuristic Esports & Fitness Aesthetic
 */

export const COLORS = {
  // Backgrounds
  bgCanvas: '#080811',
  bgSurface: '#101020',
  bgSurfaceElevated: '#16162D',
  bgGlass: 'rgba(16, 16, 32, 0.85)',
  bgGlassSubtle: 'rgba(255, 255, 255, 0.04)',
  bgGlassCard: 'rgba(22, 22, 45, 0.88)',

  // Borders
  borderSubtle: 'rgba(255, 255, 255, 0.08)',
  borderMedium: 'rgba(255, 255, 255, 0.16)',
  borderActive: 'rgba(0, 255, 136, 0.45)',
  borderGlow: 'rgba(0, 191, 255, 0.50)',

  // Gaming Accents
  neonGreen: '#00FF88',      // Primary Brand / Turf Claim / Start Run
  electricBlue: '#00BFFF',   // Secondary / Route / GPS Signal
  cyberPurple: '#9D00FF',    // Abilities / Boosts / Rare
  gold: '#FFD700',           // Coins / 1st Place / Prestige
  silver: '#C0C0D8',         // 2nd Place / Neutral
  bronze: '#CD7F32',         // 3rd Place
  crimson: '#FF2A55',        // Enemy / Stop / Danger / Disputes
  warningAmber: '#FFB800',   // Pause / Warning

  // Text Hierarchy
  textPrimary: '#FFFFFF',
  textSecondary: '#9E9EB8',
  textMuted: '#63637E',
  textInverse: '#080811',

  // Map Polygon Fills
  mapFillUser: 'rgba(0, 255, 136, 0.28)',
  mapStrokeUser: '#00FF88',
  mapFillRival: 'rgba(255, 42, 85, 0.25)',
  mapStrokeRival: '#FF2A55',
  mapFillNeutral: 'rgba(0, 191, 255, 0.20)',
  mapStrokeNeutral: '#00BFFF',
} as const;

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
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
  blueGlow: {
    shadowColor: COLORS.electricBlue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
  purpleGlow: {
    shadowColor: COLORS.cyberPurple,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
  crimsonGlow: {
    shadowColor: COLORS.crimson,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
  goldGlow: {
    shadowColor: COLORS.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
  surface: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.55,
    shadowRadius: 10,
    elevation: 6,
  },
} as const;
