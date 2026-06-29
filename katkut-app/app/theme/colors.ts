// Design tokens — KatKut UI Design Spec §2. Dark-first; never hardcode raw hex in components.
export const colors = {
  bg: {
    base: '#0F0E13',
    surface: '#16151A',
    elevated: '#1F1D26',
    input: '#26242F',
    overlay: 'rgba(15,14,19,0.72)',
  },
  accent: {
    // coral — primary action + brand
    default: '#D85A30',
    pressed: '#C04A24',
    soft: '#F0997B',
    bg: 'rgba(216,90,48,0.14)',
    onAccent: '#FBEEE8',
  },
  ai: {
    // violet — reserved for AI moments only (processing, auto-smart, regenerate)
    default: '#7F77DD',
    soft: '#AFA9EC',
    bg: 'rgba(127,119,221,0.16)',
  },
  text: {
    primary: '#F0EEF8',
    secondary: '#A3A0B0',
    muted: '#6B6880',
  },
  border: {
    subtle: 'rgba(255,255,255,0.08)',
    default: 'rgba(255,255,255,0.12)',
    accent: '#D85A30',
  },
  success: '#1D9E75',
  warning: '#EF9F27',
  error: '#E24B4A',
} as const;
