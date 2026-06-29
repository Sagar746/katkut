import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChefHat, ChevronLeft, Plane, Sparkles, Utensils, LucideIcon } from 'lucide-react-native';
import { VIBE_CHOICES } from '../core';
import { colors, space, type } from './theme';

const { width } = Dimensions.get('window');
const TILE_WIDTH = (width - space.md * 2 - space.md) / 2; // Clean 2-column dynamic layout

export interface VibeSheetProps {
  onChoose: (vibeId: string) => void;
  onCancel: () => void;
}

const ICON: Record<string, LucideIcon> = {
  auto: Sparkles,
  food_vlog: Utensils,
  travel_vlog: Plane,
  cooking: ChefHat,
};

const HELPER: Record<string, string> = {
  auto: 'Let KatKut AI choose your perfect pacing.',
  food_vlog: 'Punchy fast cuts with intense close-ups.',
  travel_vlog: 'Cinematic wide shots & smooth panning.',
  cooking: 'Step-by-step clarity, steady pacing.',
};

// ================= PREMIUM INTERACTIVE TILE COMPONENT =================
interface LocalTileProps {
  id: string;
  label: string;
  helper: string;
  icon: LucideIcon;
  isSelected: boolean;
  onPress: () => void;
}

function PremiumVibeTile({ id, label, helper, icon: IconComponent, isSelected, onPress }: LocalTileProps) {
  const isAuto = id === 'auto';
  
  return (
    <Pressable 
      onPress={onPress}
      style={[
        styles.tileRoot,
        isAuto && styles.autoTileBg,
        isSelected && styles.selectedTileBorder,
        isSelected && isAuto && styles.selectedAutoBorder
      ]}
    >
      {/* Top Meta Indicator Row */}
      <View style={styles.tileHeader}>
        <View style={[
          styles.iconContainer, 
          isAuto ? styles.iconContainerAi : styles.iconContainerNormal,
          isSelected && styles.iconContainerSelected
        ]}>
          <IconComponent size={20} color={isAuto || isSelected ? '#0A84FF' : '#A2A2B5'} />
        </View>

        {isAuto && (
          <View style={styles.aiBadge}>
            <Text style={styles.aiBadgeText}>RECOMMENDED</Text>
          </View>
        )}
      </View>

      {/* Text Copy Section */}
      <View style={styles.tileTextContent}>
        <Text style={[styles.tileLabel, isSelected && styles.tileTextActive]}>{label}</Text>
        <Text style={styles.tileHelper}>{helper}</Text>
      </View>
    </Pressable>
  );
}

// ================= MAIN RENDER SHEET CONTAINER =================
export default function VibeSheet({ onChoose, onCancel }: VibeSheetProps) {
  const insets = useSafeAreaInsets();
  const [selectedVibe, setSelectedVibe] = useState<string | null>('auto'); // Defaults to AI selection

  const handleConfirmSelection = () => {
    if (selectedVibe) {
      onChoose(selectedVibe);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + space.md }]}>
      
      {/* Top Layout Header Nav */}
      <View style={styles.headerRow}>
        <Pressable hitSlop={12} onPress={onCancel} style={styles.backButton}>
          <ChevronLeft size={24} color="#FFF" />
        </Pressable>
        <Text style={styles.headerContext}>STEP 2 OF 3</Text>
        <View style={{ width: 40 }} /> {/* Layout balancer widget */}
      </View>

      {/* Screen Primary Branding Headline */}
      <View style={styles.headlineGroup}>
        <Text style={styles.title}>What are you making?</Text>
        <Text style={styles.sub}>This configures the heuristic video engine parameters to match your specific style footprint.</Text>
      </View>

      {/* Core Grid Matrix Selection Layer */}
      <View style={styles.grid}>
        {VIBE_CHOICES.map((v) => (
          <PremiumVibeTile
            key={v.id}
            id={v.id}
            label={v.label}
            helper={HELPER[v.id] ?? ''}
            icon={ICON[v.id] ?? Sparkles}
            isSelected={selectedVibe === v.id}
            onPress={() => setSelectedVibe(v.id)}
          />
        ))}
      </View>

      {/* Floating Action Confirmation Strip */}
      <View style={styles.footerContainer}>
        <Pressable 
          style={[styles.primaryActionBtn, !selectedVibe && styles.disabledBtn]} 
          disabled={!selectedVibe}
          onPress={handleConfirmSelection}
        >
          <Text style={styles.primaryActionText}>Generate Rough-Cut Timeline</Text>
        </Pressable>
      </View>

    </View>
  );
}

// ================= SCHEMATIC DARK MODE STYLING =================
const styles = StyleSheet.create({
  root: { 
    flex: 1, 
    backgroundColor: '#0F0F11', // Richer off-black canvas depth
    paddingHorizontal: space.md 
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.md,
  },
  backButton: { 
    width: 40, 
    height: 40, 
    borderRadius: 20,
    backgroundColor: '#1C1C1E',
    alignItems: 'center', 
    justifyContent: 'center' 
  },
  headerContext: {
    color: '#636366',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  headlineGroup: {
    marginBottom: space.xl,
  },
  title: { 
    fontSize: 26,
    fontWeight: '700',
    color: '#FFFFFF', 
    letterSpacing: -0.5,
  },
  sub: { 
    fontSize: 14,
    lineHeight: 20,
    color: '#8E8E93', 
    marginTop: space.xs 
  },
  grid: { 
    flexDirection: 'row', 
    flexWrap: 'wrap', 
    justifyContent: 'space-between',
    gap: space.md 
  },
  
  /* Individual Tile Architectures */
  tileRoot: {
    width: TILE_WIDTH,
    height: 165,
    borderRadius: 16,
    backgroundColor: '#161618',
    borderWidth: 1.5,
    borderColor: '#242426',
    padding: space.md,
    justifyContent: 'space-between',
  },
  autoTileBg: {
    backgroundColor: 'rgba(10, 132, 255, 0.04)', // Elegant hint of AI tinting
    borderColor: 'rgba(10, 132, 255, 0.15)',
  },
  selectedTileBorder: {
    borderColor: '#FFFFFF',
    backgroundColor: '#1C1C1E',
  },
  selectedAutoBorder: {
    borderColor: '#0A84FF',
    backgroundColor: 'rgba(10, 132, 255, 0.08)',
  },
  tileHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainerNormal: {
    backgroundColor: '#242426',
  },
  iconContainerAi: {
    backgroundColor: 'rgba(10, 132, 255, 0.15)',
  },
  iconContainerSelected: {
    backgroundColor: '#0A84FF',
  },
  aiBadge: {
    backgroundColor: '#0A84FF',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  aiBadgeText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  tileTextContent: {
    marginTop: space.sm,
  },
  tileLabel: {
    color: '#E5E5EA',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  tileTextActive: {
    color: '#FFFFFF',
  },
  tileHelper: {
    color: '#636366',
    fontSize: 11,
    lineHeight: 15,
  },
  
  /* Footer CTA Layout Styles */
  footerContainer: {
    position: 'absolute',
    bottom: space.xl,
    left: space.md,
    right: space.md,
  },
  primaryActionBtn: {
    backgroundColor: '#FFFFFF',
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 6,
  },
  disabledBtn: {
    backgroundColor: '#242426',
    opacity: 0.5,
  },
  primaryActionText: {
    color: '#0F0F11',
    fontSize: 15,
    fontWeight: '700',
  },
});