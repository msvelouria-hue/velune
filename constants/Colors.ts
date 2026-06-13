/**
 * Vestiary Color Theme
 * Dark navy background with gold accents - like opening a closet
 */

export const VestiaryColors = {
  navy: '#1a1f3c',
  navyLight: '#252b4d',
  navyDark: '#12162d',
  gold: '#c9a756',
  goldLight: '#e6c97a',
  goldDark: '#a68939',
  cream: '#f5f0e1',
  creamDark: '#d9d4c5',
  white: '#ffffff',
  error: '#e74c3c',
  success: '#27ae60',
  warning: '#f39c12',
};

const tintColorLight = VestiaryColors.gold;
const tintColorDark = VestiaryColors.gold;

export const Colors = {
  light: {
    text: VestiaryColors.cream,
    textSecondary: VestiaryColors.creamDark,
    background: VestiaryColors.navy,
    backgroundSecondary: VestiaryColors.navyLight,
    card: VestiaryColors.navyLight,
    border: VestiaryColors.navyLight,
    tint: tintColorLight,
    accent: VestiaryColors.gold,
    accentLight: VestiaryColors.goldLight,
    icon: VestiaryColors.creamDark,
    tabIconDefault: VestiaryColors.creamDark,
    tabIconSelected: VestiaryColors.gold,
    button: VestiaryColors.gold,
    buttonText: VestiaryColors.navyDark,
    error: VestiaryColors.error,
    success: VestiaryColors.success,
    warning: VestiaryColors.warning,
  },
  dark: {
    text: VestiaryColors.cream,
    textSecondary: VestiaryColors.creamDark,
    background: VestiaryColors.navy,
    backgroundSecondary: VestiaryColors.navyLight,
    card: VestiaryColors.navyLight,
    border: VestiaryColors.navyLight,
    tint: tintColorDark,
    accent: VestiaryColors.gold,
    accentLight: VestiaryColors.goldLight,
    icon: VestiaryColors.creamDark,
    tabIconDefault: VestiaryColors.creamDark,
    tabIconSelected: VestiaryColors.gold,
    button: VestiaryColors.gold,
    buttonText: VestiaryColors.navyDark,
    error: VestiaryColors.error,
    success: VestiaryColors.success,
    warning: VestiaryColors.warning,
  },
};
