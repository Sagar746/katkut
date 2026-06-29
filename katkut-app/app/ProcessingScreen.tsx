import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  withSequence,
  interpolate,
} from 'react-native-reanimated';
import { Check, Cpu, Sparkles } from 'lucide-react-native';
import { VideoAnalysis } from '../native';
import { AnalysisClip, Edl, selectTimeline, VIBES, AUTO } from '../core';
import { generateProxies } from './proxies';
import { PickedClip } from './types';
import { colors, radius, space, type } from './theme';
import ProgressBar from './components/ProgressBar';

export interface ProcessingScreenProps {
  clips: PickedClip[];
  vibeId: string;
  onDone: (analyses: AnalysisClip[], edl: Edl, proxies: Map<string, string>) => void;
}

const STEPS = [
  'Gathering source footage metadata…',
  'Analyzing motion vectors & frames…',
  'Locating facial tracking vectors…',
  'De-noising & indexing audio spectrums…',
  'Calculating highlight heuristic scores…',
  'Assembling gapless Media3 timeline…',
];

export default function ProcessingScreen({ clips, vibeId, onDone }: ProcessingScreenProps) {
  const [progress, setProgress] = useState(0);
  const [shown, setShown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  // Hyper-Premium AI Orbital Radar Core Animations
  const pulseValue = useSharedValue(0);
  const rotationValue = useSharedValue(0);

  useEffect(() => {
    pulseValue.value = withRepeat(withTiming(1, { duration: 2000 }), -1, true);
    rotationValue.value = withRepeat(withTiming(1, { duration: 8000 }), -1, false);
  }, []);

  const ambientGlowStyle = useAnimatedStyle(() => {
    const scale = interpolate(pulseValue.value, [0, 1], [0.9, 1.2]);
    const opacity = interpolate(pulseValue.value, [0, 1], [0.15, 0.35]);
    return { transform: [{ scale }], opacity };
  });

  const radarRotateStyle = useAnimatedStyle(() => {
    const rotate = `${interpolate(rotationValue.value, [0, 1], [0, 360])}deg`;
    return { transform: [{ rotate }] };
  });

  const targetStep = Math.min(STEPS.length - 1, Math.floor(progress * STEPS.length));
  useEffect(() => {
    if (shown >= targetStep) return;
    const id = setTimeout(() => setShown((s) => Math.min(s + 1, targetStep)), 500);
    return () => clearTimeout(id);
  }, [shown, targetStep]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      const analyses: AnalysisClip[] = [];
      try {
        for (let i = 0; i < clips.length; i++) {
          setProgress(clips.length ? (i / clips.length) * 0.8 : 0);
          const result = await VideoAnalysis.analyze(clips[i].uri, clips[i].clipId);
          analyses.push(result);
        }
        setProgress(0.8);
        const vibe = VIBES[vibeId] ?? AUTO;
        const edl = selectTimeline(analyses, vibe);
        const proxies = await generateProxies(analyses, edl, (d, n) =>
          setProgress(0.8 + (n ? (d / n) * 0.2 : 0.2)),
        );
        setProgress(1);
        onDone(analyses, edl, proxies);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [clips, vibeId, onDone]);

  if (error) {
    return (
      <View style={[styles.root, styles.errorContainer]}>
        <Cpu size={40} color="#FF453A" style={{ marginBottom: space.md }} />
        <Text style={styles.errorTitle}>Analysis Pipeline Interrupted</Text>
        <Text style={styles.errorMsg}>{error}</Text>
      </View>
    );
  }

  const pct = Math.round(progress * 100);

  return (
    <View style={styles.root}>
      {/* Dynamic Cyberpunk Ambient AI Glow Backgrounds */}
      <Animated.View style={[styles.ambientNebula, ambientGlowStyle]} pointerEvents="none" />

      {/* Dynamic Centered Scanner Target */}
      <View style={styles.scannerWrapper}>
        <Animated.View style={[styles.radarRing, radarRotateStyle]}>
          <View style={styles.radarNode} />
        </Animated.View>
        <View style={styles.coreOrb}>
          <Sparkles size={24} color="#0A84FF" />
        </View>
      </View>

      {/* Main Structural Status Readout */}
      <View style={styles.metricsBox}>
        <Text style={styles.pctText}>{pct}%</Text>
        <Text style={styles.engineMeta}>KATKUT HEURISTIC ENGINE ACTIVE</Text>
        <View style={styles.barWrap}>
          <ProgressBar progress={progress} ai />
        </View>
      </View>

      {/* Clean Step Card */}
      <View style={styles.pipelineCard}>
        {STEPS.map((label, i) => {
          const done = i < shown;
          const active = i === shown;
          if (!active && !done) return null; // Only render active/completed to eliminate layout bloat

          return (
            <View key={label} style={styles.stepRow}>
              <View style={[styles.indicatorBox, done && styles.indicatorBoxDone, active && styles.indicatorBoxActive]}>
                {done ? (
                  <Check size={10} color="#FFFFFF" strokeWidth={3} />
                ) : (
                  <ActivityIndicator size="small" color="#0A84FF" />
                )}
              </View>
              <Text style={[styles.stepLabel, active && styles.stepLabelActive]}>
                {label}
              </Text>
            </View>
          );
        })}
      </View>

      <Text style={styles.reassure}>Synthesizing clips locally. Do not lock your phone.</Text>
    </View>
  );
}

// ================= SCHEMATIC DESIGN CODES =================
const styles = StyleSheet.create({
  root: { 
    flex: 1, 
    backgroundColor: '#070708', 
    alignItems: 'center', 
    justifyContent: 'center', 
    padding: space.xl 
  },
  ambientNebula: {
    position: 'absolute',
    width: 400,
    height: 400,
    borderRadius: 200,
    backgroundColor: 'rgba(10, 132, 255, 0.12)',
    top: '20%',
  },
  
  /* Orbital Scanning Engine UI */
  scannerWrapper: {
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xl,
  },
  radarRing: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 1.5,
    borderColor: 'rgba(10, 132, 255, 0.25)',
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  radarNode: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#0A84FF',
    top: -4,
    shadowColor: '#0A84FF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 6,
  },
  coreOrb: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#161618',
    borderWidth: 1,
    borderColor: '#242426',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },

  /* Metrics Readouts */
  metricsBox: {
    alignItems: 'center',
    marginBottom: space.xl,
    width: '100%',
  },
  pctText: {
    fontSize: 52,
    fontWeight: '800',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
  },
  engineMeta: {
    fontSize: 10,
    fontWeight: '700',
    color: '#636366',
    letterSpacing: 2,
    marginTop: 2,
    marginBottom: space.sm,
  },
  barWrap: { 
    width: '65%',
    height: 4,
  },

  /* Premium Diagnostic Component Card Box */
  pipelineCard: {
    alignSelf: 'stretch',
    backgroundColor: '#161618',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#242426',
    padding: space.md,
    minHeight: 56,
    justifyContent: 'center',
  },
  stepRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: space.sm 
  },
  indicatorBox: {
    width: 18,
    height: 18,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#242426',
  },
  indicatorBoxActive: {
    backgroundColor: 'transparent',
  },
  indicatorBoxDone: { 
    backgroundColor: '#30D158', 
  },
  stepLabel: { 
    fontSize: 13,
    fontWeight: '500',
    color: '#8E8E93', 
    flex: 1 
  },
  stepLabelActive: { 
    color: '#FFFFFF',
    fontWeight: '600',
  },

  /* Base Screen Layout Utilities */
  reassure: { 
    fontSize: 12,
    color: '#636366', 
    position: 'absolute', 
    bottom: space.xl, 
    textAlign: 'center' 
  },
  errorContainer: {
    paddingHorizontal: space.xl,
  },
  errorTitle: { 
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF' 
  },
  errorMsg: { 
    fontSize: 13,
    lineHeight: 18,
    color: '#FF453A', 
    textAlign: 'center', 
    marginTop: space.xs 
  },
});