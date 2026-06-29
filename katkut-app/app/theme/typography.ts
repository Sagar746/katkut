import { TextStyle } from 'react-native';

// Design tokens — KatKut UI Design Spec §3. (Inter is the target face; until the font is
// bundled these inherit the system font at the spec's sizes/weights.)
export const type = {
  display: { fontSize: 34, fontWeight: '900', lineHeight: 40, letterSpacing: -1 },
  title: { fontSize: 24, fontWeight: '800', lineHeight: 30, letterSpacing: -0.5 },
  heading: { fontSize: 18, fontWeight: '700', lineHeight: 24, letterSpacing: -0.3 },
  body: { fontSize: 15, fontWeight: '500', lineHeight: 22 },
  bodySm: { fontSize: 13, fontWeight: '500', lineHeight: 18 },
  caption: { fontSize: 11, fontWeight: '700', lineHeight: 14, letterSpacing: 0.8 },
  button: { fontSize: 16, fontWeight: '700', lineHeight: 20, letterSpacing: -0.2 },
} satisfies Record<string, TextStyle>;
