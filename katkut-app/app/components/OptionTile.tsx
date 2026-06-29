import { LucideIcon } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type } from '../theme';
import PressableScale from './PressableScale';

export interface OptionTileProps {
  icon: LucideIcon;
  label: string;
  helper: string;
  /** violet for the AI "Auto Smart" tile, coral for the rest */
  accent?: 'coral' | 'ai';
  /** small badge in the corner, e.g. "AI" */
  badge?: string;
  onPress: () => void;
}

/** Spec §5.6 — video-type option tile: icon top, label, helper line. AI variant uses violet. */
export default function OptionTile({ icon: Icon, label, helper, accent = 'coral', badge, onPress }: OptionTileProps) {
  const isAi = accent === 'ai';
  const tint = isAi ? colors.ai.default : colors.accent.default;

  return (
    <PressableScale
      style={[styles.tile, isAi && { borderColor: colors.ai.default, backgroundColor: colors.ai.bg }]}
      onPress={onPress}
    >
      {badge && (
        <View style={[styles.badge, { backgroundColor: colors.ai.bg }]}>
          <Text style={[styles.badgeText, { color: colors.ai.default }]}>{badge}</Text>
        </View>
      )}
      <Icon size={26} color={tint} strokeWidth={2} />
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.helper}>{helper}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexBasis: '48%',
    flexGrow: 1,
    minHeight: 132,
    backgroundColor: colors.bg.input,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: space.md,
    justifyContent: 'flex-end',
    gap: space.xs,
  },
  badge: {
    position: 'absolute',
    top: space.sm,
    right: space.sm,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: { ...type.caption },
  label: { ...type.heading, color: colors.text.primary },
  helper: { ...type.bodySm, color: colors.text.muted },
});
