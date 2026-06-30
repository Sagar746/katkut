import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  withSequence,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import { Sparkles } from 'lucide-react-native';
import { VideoAnalysis } from '../native';
import { AnalysisClip, Edl, selectTimeline, VIBES, AUTO } from '../core';
import { generateProxies } from './proxies';
import { PickedClip } from './types';
import { space } from './theme';

export interface ProcessingScreenProps {
  clips: PickedClip[];
  vibeId: string;
  onDone: (analyses: AnalysisClip[], edl: Edl, proxies: Map<string, string>) => void;
}

const STATUS_MESSAGES = [
  'Analyzing your clips...',
  'Detecting best moments...',
  'Creating smooth transitions...',
  'Syncing audio beats...',
  'Finalizing your edit...',
];

export default function ProcessingScreen({ clips, vibeId, onDone }: ProcessingScreenProps) {
  const [progress, setProgress] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);
  const messageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Glow animations
  const innerGlow = useSharedValue(0);
  const outerGlow = useSharedValue(0);

  useEffect(() => {
    innerGlow.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1500 }),
        withTiming(0.3, { duration: 1500 })
      ),
      -1,
      true
    );
    
    outerGlow.value = withRepeat(
      withSequence(
        withTiming(0.6, { duration: 2000 }),
        withTiming(0.1, { duration: 2000 })
      ),
      -1,
      true
    );
  }, []);

  const innerGlowStyle = useAnimatedStyle(() => ({
    opacity: innerGlow.value,
  }));

  const outerGlowStyle = useAnimatedStyle(() => ({
    opacity: outerGlow.value,
  }));

  // Rotate messages
  useEffect(() => {
    messageTimerRef.current = setInterval(() => {
      setMessageIndex(prev => (prev + 1) % STATUS_MESSAGES.length);
    }, 2500);

    return () => {
      if (messageTimerRef.current) clearInterval(messageTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      const analyses: AnalysisClip[] = [];
      try {
        setProgress(0.05);
        setStatusText('Uploading clips... (1/1)');
        
        for (let i = 0; i < clips.length; i++) {
          setProgress(0.05 + (i / clips.length) * 0.6);
          setStatusText(`Processing clip ${i + 1} of ${clips.length}...`);
          const result = await VideoAnalysis.analyze(clips[i].uri, clips[i].clipId);
          analyses.push(result);
        }
        
        setProgress(0.65);
        setStatusText('AI is watching your videos...');
        const vibe = VIBES[vibeId] ?? AUTO;
        
        await new Promise(r => setTimeout(r, 800));
        
        setProgress(0.72);
        setStatusText('Designing the timeline...');
        const edl = selectTimeline(analyses, vibe);
        
        await new Promise(r => setTimeout(r, 600));
        
        setProgress(0.78);
        setStatusText('Rendering previews...');
        const proxies = await generateProxies(analyses, edl, (d, n) =>
          setProgress(0.78 + (n ? (d / n) * 0.22 : 0.22)),
        );
        
        setProgress(1);
        setStatusText('Finalizing...');
        
        if (messageTimerRef.current) clearInterval(messageTimerRef.current);
        
        setTimeout(() => {
          onDone(analyses, edl, proxies);
        }, 600);
        
      } catch (e) {
        if (messageTimerRef.current) clearInterval(messageTimerRef.current);
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [clips, vibeId, onDone]);

  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.errorRing}>
          <Text style={styles.errorExclaim}>!</Text>
        </View>
        <Text style={styles.errorTitle}>Something went wrong</Text>
        <Text style={styles.errorMessage}>{error}</Text>
      </View>
    );
  }

  const percentage = Math.round(progress * 100);

  return (
    <View style={styles.container}>
      
      {/* Glowing Orb Section */}
      <View style={styles.orbSection}>
        {/* Outer glow */}
        <Animated.View style={[styles.outerGlow, outerGlowStyle]} />
        
        {/* Inner glow ring */}
        <Animated.View style={[styles.innerGlowRing, innerGlowStyle]} />
        
        {/* Core orb */}
        <View style={styles.coreOrb}>
          <Sparkles size={40} color="#FFFFFF" strokeWidth={1.5} />
        </View>
      </View>

      {/* Title */}
      <Text style={styles.title}>AI is Creating Your Edit</Text>
      
      {/* Status text */}
      <Text style={styles.subtitle}>
        {STATUS_MESSAGES[messageIndex]}
      </Text>

      {/* Progress bar */}
      <View style={styles.progressBarContainer}>
        <View style={styles.progressBarBg}>
          <View style={[styles.progressBarFill, { width: `${percentage}%` }]} />
        </View>
      </View>

      {/* Bottom status */}
      <Animated.View 
        key={statusText}
        entering={FadeIn.duration(300)}
        exiting={FadeOut.duration(200)}
      >
        <Text style={styles.bottomStatus}>{statusText}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  
  // Orb
  orbSection: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 40,
    position: 'relative',
    width: 120,
    height: 120,
  },
  
  outerGlow: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: '#8B5CF6',
    opacity: 0.2,
  },
  
  innerGlowRing: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#3B82F6',
    opacity: 0.3,
  },
  
  coreOrb: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#1C1C1E',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  
  // Title
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    marginBottom: 12,
    textAlign: 'center',
  },
  
  subtitle: {
    fontSize: 16,
    color: '#8E8E93',
    marginBottom: 32,
    textAlign: 'center',
    fontWeight: '500',
  },
  
  // Progress bar
  progressBarContainer: {
    width: '80%',
    maxWidth: 320,
    marginBottom: 16,
  },
  
  progressBarBg: {
    height: 2,
    backgroundColor: '#1C1C1E',
    borderRadius: 1,
    overflow: 'hidden',
  },
  
  progressBarFill: {
    height: '100%',
    backgroundColor: '#3B82F6',
    borderRadius: 1,
  },
  
  bottomStatus: {
    fontSize: 13,
    color: '#636366',
    textAlign: 'center',
  },
  
  // Error
  errorRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255, 59, 48, 0.1)',
    borderWidth: 2,
    borderColor: 'rgba(255, 59, 48, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  
  errorExclaim: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FF3B30',
  },
  
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  
  errorMessage: {
    fontSize: 14,
    color: '#FF3B30',
    textAlign: 'center',
    lineHeight: 20,
  },
});