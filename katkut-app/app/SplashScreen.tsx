import { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';
import { colors } from './theme';

export interface SplashScreenProps {
  /** called after the brand beat (~1.5s); parent then shows Home */
  onDone: () => void;
}

export default function SplashScreen({ onDone }: SplashScreenProps) {
  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.spring(rise, { toValue: 0, friction: 7, tension: 60, useNativeDriver: true }),
    ]).start();
    const t = setTimeout(onDone, 1500);
    return () => clearTimeout(t);
  }, [onDone, fade, rise]);

  return (
    <View style={styles.root}>
      <Animated.View style={{ opacity: fade, transform: [{ translateY: rise }] }}>
        <Image
          source={require('../assets/katkutai_logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg.base, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 240, height: 192 },
});
