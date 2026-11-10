import { COLORS, CLASS_THEMES, SPACING, RADII, SHADOWS } from '../theme/tokens';

export { COLORS, CLASS_THEMES, SPACING, RADII, SHADOWS };

export const THEME = {
  colors: {
    background: COLORS.bgCanvas,
    surface: COLORS.bgSurface,
    surfaceElevated: COLORS.bgSurfaceElevated,
    primary: COLORS.neonGreen,
    secondary: COLORS.electricBlue,
    purple: COLORS.cyberPurple,
    gold: COLORS.gold,
    danger: COLORS.crimson,
    text: COLORS.textPrimary,
    textSecondary: COLORS.textSecondary,
    textMuted: COLORS.textMuted,
  },
  classes: {
    scout: CLASS_THEMES.scout.color,
    warrior: CLASS_THEMES.warrior.color,
    titan: CLASS_THEMES.titan.color,
    ghost: CLASS_THEMES.ghost.color,
    // backwards-compat
    juggernaut: CLASS_THEMES.titan.color,
    infiltrator: CLASS_THEMES.scout.color,
    commander: CLASS_THEMES.warrior.color,
  },
  spacing: SPACING,
  radii: RADII,
  shadows: SHADOWS,
};
