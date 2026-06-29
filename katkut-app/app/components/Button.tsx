import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { colors, radius, type } from '../theme';

type Variant = 'primary' | 'ghost';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  /** leading icon (e.g. a lucide icon element) */
  icon?: ReactNode;
  disabled?: boolean;
  style?: ViewStyle;
}

/** Spec §5.1/5.2 — primary (coral) or ghost button, height 52, press-scale 0.98 (reanimated). */
export default function Button({ label, onPress, variant = 'primary', icon, disabled, style }: ButtonProps) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const isPrimary = variant === 'primary';

  return (
    <Animated.View style={[animStyle, style]}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        onPressIn={() => {
          scale.value = withSpring(0.98, { mass: 0.4, damping: 12 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { mass: 0.4, damping: 12 });
        }}
        style={[
          styles.base,
          isPrimary ? styles.primary : styles.ghost,
          disabled && styles.disabled,
        ]}
      >
        {icon}
        <Text style={[styles.label, isPrimary ? styles.labelPrimary : styles.labelGhost]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 52,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 18,
  },
  primary: { backgroundColor: colors.accent.default },
  ghost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border.default },
  disabled: { opacity: 0.5 },
  label: { ...type.button },
  labelPrimary: { color: colors.accent.onAccent },
  labelGhost: { color: colors.text.primary },
});
