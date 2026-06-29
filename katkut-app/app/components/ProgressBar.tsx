import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { colors, radius } from '../theme';

export interface ProgressBarProps {
  /** 0..1 */
  progress: number;
  /** use the violet AI fill (processing) instead of coral */
  ai?: boolean;
}

/** Spec §5.7 — track + animated fill, height 6, never snaps (eases width with reanimated). */
export default function ProgressBar({ progress, ai }: ProgressBarProps) {
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withTiming(Math.max(0, Math.min(1, progress)), { duration: 300 });
  }, [progress, w]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));

  return (
    <View style={styles.track}>
      <Animated.View
        style={[styles.fill, { backgroundColor: ai ? colors.ai.default : colors.accent.default }, fillStyle]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.bg.input,
    overflow: 'hidden',
    width: '100%',
  },
  fill: { height: '100%', borderRadius: radius.full },
});
