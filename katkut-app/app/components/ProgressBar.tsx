import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

export interface ProgressBarProps {
  /** 0..1 */
  progress: number;
  /** use blue AI fill instead of default white */
  ai?: boolean;
}

export default function ProgressBar({ progress, ai }: ProgressBarProps) {
  const w = useSharedValue(0);
  
  useEffect(() => {
    w.value = withTiming(Math.max(0, Math.min(1, progress)), { 
      duration: 400,
    });
  }, [progress, w]);

  const fillStyle = useAnimatedStyle(() => ({ 
    width: `${w.value * 100}%` 
  }));

  return (
    <View style={styles.track}>
      <Animated.View
        style={[
          styles.fill, 
          { backgroundColor: ai ? '#007AFF' : '#FFFFFF' },
          fillStyle
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#1C1C1E',
    overflow: 'hidden',
    width: '100%',
  },
  fill: { 
    height: '100%', 
    borderRadius: 1.5,
  },
});