import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
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
import PressableScale from './components/PressableScale';

export interface VibeSheetProps {
  onChoose: (vibeId: string) => void;
  onCancel: () => void;
}

// expo-linear-gradient's `colors` prop requires a fixed-length tuple (readonly [C, C, ...]), not a
// plain string[] — a bare array literal here would widen to string[] and fail to type-check.
type Gradient = readonly [string, string];

const VIBE_CONFIG: Record<string, { icon: LucideIcon; accent: string; desc: string; gradient?: Gradient }> = {
  auto: {
    icon: Sparkles,
    accent: '#00C6FF',
    gradient: ['#9B51E0', '#00C6FF'], // Signature Brand Gradient from katkutai_icon_512.png
    desc: 'Adaptive pacing for natural, long-form cuts.',
  },
  food_cooking: {
    icon: Utensils,
    accent: '#FF6B35',
    desc: 'Macro close-ups, steady shots, crisp audio.',
  },
  travel_adventure: {
    icon: Plane,
    accent: '#00C6FF',
    desc: 'Wide shots, smooth flow, scenic pacing.',
  },
  mini_vlog: {
    icon: Film,
    accent: '#FF2D95',
    desc: 'Fast, high-energy beat cuts.',
  },
  unboxing: {
    icon: ShoppingBag,
    accent: '#BF5AF2',
    desc: 'Slow setups, instant reveal cuts.',
  },
};

export default function VibeSheet({ onChoose, onCancel }: VibeSheetProps) {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<string>('auto');

  const selectedLabel = VIBE_CHOICES.find((v) => v.id === selected)?.label ?? 'Auto';
  const currentCfg = VIBE_CONFIG[selected] ?? VIBE_CONFIG.auto;

  return (
    <View style={[styles.container, { paddingTop: insets.top + space.md }]}>
      {/* Header */}
      <View style={styles.header}>
        <PressableScale hitSlop={12} onPress={onCancel} style={styles.backButton}>
          <ChevronLeft size={22} color="#FFFFFF" strokeWidth={2.5} />
        </PressableScale>
        <View style={styles.badgeWrapper}>
          <Text style={styles.stepIndicator}>2 of 3</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {/* Title Section */}
      <View style={styles.titleSection}>
        <Text style={styles.title}>Choose your style</Text>
        <Text style={styles.subtitle}>This shapes how KatKut edits, cuts, and paces your footage.</Text>
      </View>

      {/* Options List */}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
        {VIBE_CHOICES.map((vibe) => {
          const cfg = VIBE_CONFIG[vibe.id] ?? VIBE_CONFIG.auto;
          const Icon = cfg.icon;
          const isSelected = selected === vibe.id;

          return (
            <PressableScale
              key={vibe.id}
              onPress={() => setSelected(vibe.id)}
              style={[
                styles.row,
                isSelected && !cfg.gradient && { borderColor: cfg.accent },
              ]}
            >
              {/* Dynamic Selection Border Gradients */}
              {isSelected && (
                <View style={StyleSheet.absoluteFill}>
                  <LinearGradient
                    colors={cfg.gradient ? cfg.gradient : ([cfg.accent + '22', 'transparent'] as const)}
                    style={styles.gradientBorderBg}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  />
                </View>
              )}

              {/* Icon Container Wrapper */}
              <View style={[styles.iconWrap, { backgroundColor: isSelected ? (cfg.gradient ? '#1A142E' : cfg.accent + '22') : '#141417' }]}>
                {cfg.gradient ? (
                  <Sparkles size={20} color="#00C6FF" strokeWidth={2.2} />
                ) : (
                  <Icon size={20} color={isSelected ? cfg.accent : '#71717A'} strokeWidth={2.2} />
                )}
              </View>

              {/* Text Layout Block */}
              <View style={styles.rowText}>
                <View style={styles.rowTitleRow}>
                  <Text style={[styles.rowLabel, isSelected && styles.rowLabelActive]}>{vibe.label}</Text>
                  {vibe.id === 'auto' && (
                    <LinearGradient colors={['#9B51E0', '#00C6FF'] as const} style={styles.aiBadge} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                      <Text style={styles.aiBadgeText}>SMART AI</Text>
                    </LinearGradient>
                  )}
                </View>
                <Text style={[styles.rowDesc, isSelected && styles.rowDescActive]}>{cfg.desc}</Text>
              </View>

              {/* Check Radio Indicators */}
              <View style={[
                styles.radio,
                isSelected && {
                  borderColor: cfg.gradient ? '#00C6FF' : cfg.accent,
                  backgroundColor: cfg.gradient ? '#00C6FF' : cfg.accent,
                },
              ]}>
                {isSelected && <Check size={12} color="#FFFFFF" strokeWidth={3.5} />}
              </View>
            </PressableScale>
          );
        })}
      </ScrollView>

      {/* Dynamic CTA Footer Section */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + space.lg }]}>
        <PressableScale style={styles.continueButtonContainer} onPress={() => onChoose(selected)}>
          <LinearGradient
            colors={currentCfg.gradient ? currentCfg.gradient : ([currentCfg.accent, currentCfg.accent] as const)}
            style={styles.continueGradientBtn}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <Text style={styles.continueText}>Edit in {selectedLabel} Mode</Text>
          </LinearGradient>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090B', // Dark slate theme base
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    marginBottom: space.md,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#141417',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  badgeWrapper: {
    backgroundColor: '#141417',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
  },
  stepIndicator: {
    fontSize: 12,
    fontWeight: '700',
    color: '#71717A',
    letterSpacing: 0.5,
  },
  headerSpacer: { width: 44 },
  titleSection: {
    paddingHorizontal: space.xl,
    marginBottom: space.xl,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.6,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#71717A',
    lineHeight: 20,
    fontWeight: '500',
  },
  list: {
    gap: 14,
    paddingHorizontal: space.xl,
    paddingBottom: space.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: 18,
    borderRadius: 24,
    backgroundColor: '#141417',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.04)',
    overflow: 'hidden',
  },
  gradientBorderBg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.08,
  },
  iconWrap: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#A1A1AA',
  },
  rowLabelActive: {
    fontWeight: '700',
    color: '#FFFFFF',
  },
  aiBadge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  aiBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  rowDesc: {
    fontSize: 12,
    color: '#52525B',
    lineHeight: 18,
    fontWeight: '500',
  },
  rowDescActive: {
    color: '#A1A1AA',
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#27272A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    paddingHorizontal: space.xl,
  },
  continueButtonContainer: {
    borderRadius: 30,
    overflow: 'hidden',
    shadowColor: '#00C6FF',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 6,
  },
  continueGradientBtn: {
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
});
