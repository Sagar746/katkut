import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Sparkles } from 'lucide-react-native';
import { VIBE_CHOICES } from '../core';
import { space } from './theme';

export interface LengthRange {
  min: number;
  max: number;
}

export interface OptionsScreenProps {
  vibeId: string;
  onBack: () => void;
  onGenerate: (length: LengthRange, muteAll: boolean) => void;
}

const LENGTH_OPTIONS: { id: string; label: string; min: number; max: number }[] = [
  { id: 's0', label: 'Up to 30s', min: 0, max: 30 },
  { id: 's30', label: '30–60s', min: 30, max: 60 },
  { id: 's60', label: '60–90s', min: 60, max: 90 },
  { id: 's90', label: '90–120s', min: 90, max: 120 },
  { id: 's120', label: '120s +', min: 120, max: 300 },
];

export default function OptionsScreen({ vibeId, onBack, onGenerate }: OptionsScreenProps) {
  const insets = useSafeAreaInsets();
  const [lengthId, setLengthId] = useState('s30');
  const [muteAll, setMuteAll] = useState(true);

  const vibeLabel = VIBE_CHOICES.find((v) => v.id === vibeId)?.label ?? 'Auto';

  function handleGenerate() {
    const opt = LENGTH_OPTIONS.find((o) => o.id === lengthId) ?? LENGTH_OPTIONS[1];
    onGenerate({ min: opt.min, max: opt.max }, muteAll);
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + space.md }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backButton} hitSlop={8}>
          <ChevronLeft size={22} color="#FFFFFF" strokeWidth={2} />
        </Pressable>
        <Text style={styles.stepIndicator}>3 of 3</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Title */}
      <View style={styles.titleSection}>
        <Text style={styles.title}>Almost there</Text>
        <Text style={styles.subtitle}>Set the length and audio for your {vibeLabel} reel.</Text>
      </View>

      {/* Length */}
      <Text style={styles.sectionLabel}>How long should it be?</Text>
      <View style={styles.lengthWrap}>
        {LENGTH_OPTIONS.map((opt) => {
          const active = lengthId === opt.id;
          return (
            <Pressable
              key={opt.id}
              onPress={() => setLengthId(opt.id)}
              style={[styles.lengthPill, active && styles.lengthPillActive]}
            >
              <Text style={[styles.lengthText, active && styles.lengthTextActive]}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Mute */}
      <Text style={styles.sectionLabel}>Mute all clips?</Text>
      <View style={styles.muteRow}>
        <Pressable
          onPress={() => setMuteAll(true)}
          style={[styles.muteOption, muteAll && styles.muteOptionActive]}
        >
          <Text style={[styles.muteText, muteAll && styles.muteTextActive]}>Yes, mute</Text>
        </Pressable>
        <Pressable
          onPress={() => setMuteAll(false)}
          style={[styles.muteOption, !muteAll && styles.muteOptionActive]}
        >
          <Text style={[styles.muteText, !muteAll && styles.muteTextActive]}>No, keep audio</Text>
        </Pressable>
      </View>
      <Text style={styles.muteHelper}>
        Muted by default so you can add a voiceover later. Keep audio if the sound is the moment
        (music, cheering, talking).
      </Text>

      {/* Generate */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
        <Pressable style={styles.generateButton} onPress={handleGenerate}>
          <Sparkles size={18} color="#000000" strokeWidth={2.5} />
          <Text style={styles.generateText}>Generate</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000', paddingHorizontal: space.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1C1C1E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepIndicator: { fontSize: 13, fontWeight: '600', color: '#8E8E93', letterSpacing: 0.5 },
  headerSpacer: { width: 40 },
  titleSection: { marginBottom: space.xl },
  title: { fontSize: 30, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.5, marginBottom: 6 },
  subtitle: { fontSize: 15, color: '#8E8E93', lineHeight: 20 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: space.sm,
    marginTop: space.md,
  },
  lengthWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  lengthPill: {
    paddingHorizontal: 16,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#2C2C2E',
    backgroundColor: '#1C1C1E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lengthPillActive: { borderColor: '#0A84FF', backgroundColor: 'rgba(10,132,255,0.12)' },
  lengthText: { fontSize: 15, fontWeight: '600', color: '#8E8E93', fontVariant: ['tabular-nums'] },
  lengthTextActive: { color: '#FFFFFF' },
  muteRow: { flexDirection: 'row', gap: space.sm },
  muteOption: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#2C2C2E',
    backgroundColor: '#1C1C1E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  muteOptionActive: { borderColor: '#0A84FF', backgroundColor: 'rgba(10,132,255,0.12)' },
  muteText: { fontSize: 15, fontWeight: '600', color: '#8E8E93' },
  muteTextActive: { color: '#FFFFFF' },
  muteHelper: { fontSize: 12, color: '#636366', lineHeight: 16, marginTop: space.sm },
  footer: { marginTop: 'auto', paddingTop: space.md },
  generateButton: {
    height: 54,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  generateText: { fontSize: 16, fontWeight: '700', color: '#000000' },
});
