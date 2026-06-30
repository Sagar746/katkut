import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { 
  Sparkles, 
  ChevronLeft, 
  Utensils, 
  Plane, 
  ChefHat, 
  Camera,
  LucideIcon,
  Zap,
  Music,
  Palette
} from 'lucide-react-native';
import { VIBE_CHOICES } from '../core';
import { space } from './theme';

const { width } = Dimensions.get('window');
const TILE_WIDTH = (width - space.md * 2 - space.sm) / 2;

export interface VibeSheetProps {
  onChoose: (vibeId: string) => void;
  onCancel: () => void;
}

// Enhanced icon and color mapping for visual distinction
const VIBE_CONFIG: Record<string, {
  icon: LucideIcon;
  gradient: string[];
  accentColor: string;
  helper: string;
}> = {
  auto: {
    icon: Sparkles,
    gradient: ['#007AFF', '#5856D6'],
    accentColor: '#007AFF',
    helper: 'AI-powered editing optimized for your content',
  },
  food_vlog: {
    icon: Utensils,
    gradient: ['#FF6B35', '#F7931E'],
    accentColor: '#FF6B35',
    helper: 'Fast-paced cuts with mouth-watering close-ups',
  },
  travel_vlog: {
    icon: Plane,
    gradient: ['#00C6FF', '#0072FF'],
    accentColor: '#00C6FF',
    helper: 'Cinematic wide shots with smooth transitions',
  },
  cooking: {
    icon: ChefHat,
    gradient: ['#FF4B2B', '#FF416C'],
    accentColor: '#FF4B2B',
    helper: 'Step-by-step clarity with instructional pacing',
  },
  fitness: {
    icon: Zap,
    gradient: ['#11998E', '#38EF7D'],
    accentColor: '#11998E',
    helper: 'High-energy cuts synced to music beats',
  },
  music: {
    icon: Music,
    gradient: ['#8E2DE2', '#4A00E0'],
    accentColor: '#8E2DE2',
    helper: 'Rhythm-based editing with audio sync',
  },
  artistic: {
    icon: Palette,
    gradient: ['#F2994A', '#F2C94C'],
    accentColor: '#F2994A',
    helper: 'Creative transitions with artistic flair',
  },
  vlog: {
    icon: Camera,
    gradient: ['#2193B0', '#6DD5ED'],
    accentColor: '#2193B0',
    helper: 'Natural flow with engaging storytelling',
  },
};

interface VibeTileProps {
  id: string;
  label: string;
  isSelected: boolean;
  onPress: () => void;
}

function VibeTile({ id, label, isSelected, onPress }: VibeTileProps) {
  const config = VIBE_CONFIG[id] || VIBE_CONFIG.auto;
  const IconComponent = config.icon;
  
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.tile,
        isSelected && styles.tileSelected,
      ]}
    >
      {/* Gradient background when selected */}
      {isSelected && (
        <View style={[
          styles.tileGradient,
          { backgroundColor: config.accentColor + '15' }
        ]} />
      )}
      
      {/* Top section with icon */}
      <View style={styles.tileTop}>
        <View style={[
          styles.iconWrapper,
          { backgroundColor: isSelected ? config.accentColor : config.accentColor + '20' }
        ]}>
          <IconComponent 
            size={22} 
            color={isSelected ? '#FFFFFF' : config.accentColor} 
            strokeWidth={1.5}
          />
        </View>
        
        {id === 'auto' && (
          <View style={styles.recommendedBadge}>
            <Sparkles size={10} color="#007AFF" />
            <Text style={styles.recommendedText}>AI</Text>
          </View>
        )}
      </View>
      
      {/* Bottom section with text */}
      <View style={styles.tileBottom}>
        <Text style={[
          styles.tileLabel,
          { color: isSelected ? config.accentColor : '#FFFFFF' }
        ]}>
          {label}
        </Text>
        <Text style={styles.tileHelper}>
          {config.helper}
        </Text>
      </View>
      
      {/* Selection indicator */}
      {isSelected && (
        <View style={[styles.selectionDot, { backgroundColor: config.accentColor }]} />
      )}
    </Pressable>
  );
}

export default function VibeSheet({ onChoose, onCancel }: VibeSheetProps) {
  const insets = useSafeAreaInsets();
  const [selectedVibe, setSelectedVibe] = useState<string>('auto');

  const handleConfirm = () => {
    if (selectedVibe) {
      onChoose(selectedVibe);
    }
  };

  return (
    <View style={[styles.container, { 
      paddingTop: insets.top + space.md,
      paddingBottom: insets.bottom + space.md 
    }]}>
      
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={onCancel} style={styles.backButton}>
          <ChevronLeft size={22} color="#FFFFFF" strokeWidth={2} />
        </Pressable>
        
        <View style={styles.headerCenter}>
          <Text style={styles.stepIndicator}>2 of 3</Text>
        </View>
        
        <View style={styles.headerSpacer} />
      </View>

      {/* Title Section */}
      <View style={styles.titleSection}>
        <Text style={styles.title}>Choose your style</Text>
        <Text style={styles.subtitle}>
          Select a vibe that matches your content for the perfect edit
        </Text>
      </View>

      {/* Grid of options */}
      <View style={styles.grid}>
        {VIBE_CHOICES.map((vibe) => (
          <VibeTile
            key={vibe.id}
            id={vibe.id}
            label={vibe.label}
            isSelected={selectedVibe === vibe.id}
            onPress={() => setSelectedVibe(vibe.id)}
          />
        ))}
      </View>

      {/* Continue Button */}
      <View style={styles.footer}>
        <Pressable
          style={[
            styles.continueButton,
            !selectedVibe && styles.continueButtonDisabled
          ]}
          onPress={handleConfirm}
          disabled={!selectedVibe}
        >
          <Text style={styles.continueButtonText}>
            Continue with {VIBE_CHOICES.find(v => v.id === selectedVibe)?.label || 'Auto'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    paddingHorizontal: space.md,
  },
  
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.lg,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1C1C1E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    alignItems: 'center',
  },
  stepIndicator: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8E8E93',
    letterSpacing: 0.5,
  },
  headerSpacer: {
    width: 40,
  },
  
  // Title
  titleSection: {
    marginBottom: space.xl,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#8E8E93',
    lineHeight: 20,
  },
  
  // Grid
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    flex: 1,
  },
  
  // Tile
  tile: {
    width: TILE_WIDTH,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#1C1C1E',
    borderWidth: 1.5,
    borderColor: '#2C2C2E',
    position: 'relative',
    overflow: 'hidden',
    height: 160,
    justifyContent: 'space-between',
  },
  tileSelected: {
    borderColor: 'transparent',
    backgroundColor: '#1C1C1E',
  },
  tileGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 16,
  },
  tileTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  iconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recommendedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 122, 255, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  recommendedText: {
    color: '#007AFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  tileBottom: {
    gap: 4,
  },
  tileLabel: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  tileHelper: {
    fontSize: 12,
    color: '#8E8E93',
    lineHeight: 16,
  },
  selectionDot: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  
  // Footer
  footer: {
    marginTop: 'auto',
    paddingTop: space.md,
  },
  continueButton: {
    backgroundColor: '#FFFFFF',
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueButtonDisabled: {
    backgroundColor: '#2C2C2E',
    opacity: 0.5,
  },
  continueButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
});