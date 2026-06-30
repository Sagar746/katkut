import { ReactNode } from 'react';
import { Insets, Pressable, StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

export interface PressableScaleProps {
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  hitSlop?: number | Insets;
  /** target scale on press (spec §7: 0.98) */
  to?: number;
}

/** Pressable with a reanimated press-scale spring (spec §7 button-press motion). */
export default function PressableScale({ children, onPress, disabled, style, hitSlop, to = 0.98 }: PressableScaleProps) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={animStyle}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        hitSlop={hitSlop}
        onPressIn={() => {
          scale.value = withSpring(to, { mass: 0.4, damping: 12 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { mass: 0.4, damping: 12 });
        }}
        style={style}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
