import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Check,
  ChevronLeft,
  Film,
  Plane,
  ShoppingBag,
  Sparkles,
  Utensils,
  LucideIcon,
} from 'lucide-react-native';
import { VIBE_CHOICES } from '../core';
import { space } from './theme';

export interface VibeSheetProps {
  onChoose: (vibeId: string) => void;
  onCancel: () => void;
}

// Per-vibe icon, accent color and the user-facing description.
const VIBE_CONFIG: Record<string, { icon: LucideIcon; accent: string; desc: string }> = {
  auto: {
    icon: Sparkles,
    accent: '#0A84FF',
    desc: 'Casual videos, talking clips, or mixed comedy reels. Reads face presence and audio levels to keep the focus on the action.',
  },
  food_cooking: {
    icon: Utensils,
    accent: '#FF6B35',
    desc: 'Restaurant reviews, recipe steps, and satisfying kitchen edits. Favors macro close-ups, steady shots, and crisp original audio.',
  },
  travel_adventure: {
    icon: Plane,
    accent: '#00C6FF',
    desc: 'Vacation diaries, scenic nature, and outdoor exploring. Sweeping wide-angle shots with smooth, flowing transitions.',
  },
  mini_vlog: {
    icon: Film,
    accent: '#FF2D95',
    desc: '“Day in My Life” montages, GRWM, or gym logs. Packs daily memories into hyper-fast, high-energy beat cuts.',
  },
  unboxing: {
    icon: ShoppingBag,
    accent: '#BF5AF2',
    desc: 'Try-on hauls, shopping, tech unboxing, and before-and-after glow-ups. Slow setups paired with instant transformation cuts.',
  },
};

export default function VibeSheet({ onChoose, onCancel }: VibeSheetProps) {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<string>('auto');

  const selectedLabel = VIBE_CHOICES.find((v) => v.id === selected)?.label ?? 'Auto';

  return (
    <View style={[styles.container, { paddingTop: insets.top + space.md }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={onCancel} style={styles.backButton} hitSlop={8}>
          <ChevronLeft size={22} color="#FFFFFF" strokeWidth={2} />
        </Pressable>
        <Text style={styles.stepIndicator}>2 of 3</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Title */}
      <View style={styles.titleSection}>
        <Text style={styles.title}>Choose your style</Text>
        <Text style={styles.subtitle}>This shapes how KatKut picks and paces your clips.</Text>
      </View>

      {/* Options list */}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
        {VIBE_CHOICES.map((vibe) => {
          const cfg = VIBE_CONFIG[vibe.id] ?? VIBE_CONFIG.auto;
          const Icon = cfg.icon;
          const isSelected = selected === vibe.id;
          return (
            <Pressable
              key={vibe.id}
              onPress={() => setSelected(vibe.id)}
              style={[
                styles.row,
                isSelected && { borderColor: cfg.accent, backgroundColor: cfg.accent + '14' },
              ]}
            >
              <View style={[styles.iconWrap, { backgroundColor: cfg.accent + '22' }]}>
                <Icon size={22} color={cfg.accent} strokeWidth={2} />
              </View>

              <View style={styles.rowText}>
                <View style={styles.rowTitleRow}>
                  <Text style={styles.rowLabel}>{vibe.label}</Text>
                  {vibe.id === 'auto' && (
                    <View style={styles.aiBadge}>
                      <Text style={styles.aiBadgeText}>AI</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.rowDesc}>{cfg.desc}</Text>
              </View>

              <View style={[styles.radio, isSelected && { borderColor: cfg.accent, backgroundColor: cfg.accent }]}>
                {isSelected && <Check size={13} color="#FFFFFF" strokeWidth={3} />}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Continue */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
        <Pressable style={styles.continueButton} onPress={() => onChoose(selected)}>
          <Text style={styles.continueText}>Continue with {selectedLabel}</Text>
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
  titleSection: { marginBottom: space.lg },
  title: { fontSize: 30, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.5, marginBottom: 6 },
  subtitle: { fontSize: 15, color: '#8E8E93', lineHeight: 20 },
  list: { gap: space.sm, paddingBottom: space.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: 16,
    backgroundColor: '#1C1C1E',
    borderWidth: 1.5,
    borderColor: '#2C2C2E',
  },
  iconWrap: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  rowLabel: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  aiBadge: { backgroundColor: 'rgba(10,132,255,0.2)', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 },
  aiBadgeText: { fontSize: 9, fontWeight: '800', color: '#0A84FF', letterSpacing: 0.5 },
  rowDesc: { fontSize: 12, color: '#8E8E93', lineHeight: 16 },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#3A3A3C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { paddingTop: space.sm },
  continueButton: {
    height: 54,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueText: { fontSize: 16, fontWeight: '700', color: '#000000' },
});
