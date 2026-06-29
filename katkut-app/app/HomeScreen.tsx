import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Sparkles, FolderOpen, Film, Plus } from 'lucide-react-native';
import { colors, radius, space, type } from './theme';
import PressableScale from './components/PressableScale';
import { listDrafts, listExports, Project } from '../services';

const { width } = Dimensions.get('window');
// Perfect horizontal distribution for 3 columns on a vertical layout grid
const CARD_WIDTH = (width - space.md * 2 - space.sm * 2) / 3;
const CARD_HEIGHT = CARD_WIDTH * (16 / 9);

export interface HomeScreenProps {
  onNewProject: () => void;
  onOpenDraft: (project: Project) => void;
  onOpenExport: (project: Project) => void;
  loading?: boolean;
}

function fmtDur(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// ================= PREMIUM COMPACT PREVIEW CARD =================
interface CardProps {
  project: Project;
  isDraft: boolean;
  onPress: () => void;
}

function MediaProjectCard({ project, isDraft, onPress }: CardProps) {
  return (
    <PressableScale style={styles.cardRoot} onPress={onPress}>
      {project.thumbUri ? (
        <Image source={{ uri: project.thumbUri }} style={styles.cardMedia} />
      ) : (
        <View style={styles.cardPlaceholder}>
          <Film size={24} color="#3A3A3C" />
        </View>
      )}

      {/* Top Status Structural Indicator Overlay */}
      <View style={styles.cardTopBar}>
        <View style={[styles.statusIndicator, isDraft ? styles.statusDraft : styles.statusExported]}>
          <Text style={styles.statusText}>{isDraft ? 'DRAFT' : 'EDL'}</Text>
        </View>
      </View>

      {/* Shadow gradient bottom boundary protection overlay */}
      <View style={styles.cardBottomBar}>
        <Text style={styles.cardDuration}>{fmtDur(project.durationSec)}</Text>
      </View>
    </PressableScale>
  );
}

// ================= MAIN SCREEN HUB LAYOUT =================
export default function HomeScreen({ onNewProject, onOpenDraft, onOpenExport, loading }: HomeScreenProps) {
  const insets = useSafeAreaInsets();
  const [drafts, setDrafts] = useState<Project[]>([]);
  const [exports, setExports] = useState<Project[]>([]);

  const reload = useCallback(async () => {
    const [d, e] = await Promise.all([listDrafts(), listExports()]);
    setDrafts(d || []);
    setExports(e || []);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <View style={[styles.container, { backgroundColor: '#0F0F11' }]}>
      
      {/* Top Fixed Premium Header Element */}
      <View style={[styles.topNavHeader, { paddingTop: insets.top + space.sm }]}>
        <Text style={styles.brandText}>
          Kat<Text style={styles.brandAccent}>Kut</Text>
        </Text>
        <View style={styles.aiBadge}>
          <Sparkles size={12} color="#0A84FF" />
          <Text style={styles.aiBadgeText}>AI WORKSPACE</Text>
        </View>
      </View>

      <ScrollView 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollBody, { paddingBottom: insets.bottom + space.xl }]}
      >
        {/* HERO CALL-TO-ACTION MOUNT PANEL */}
        <View style={styles.heroWrapper}>
          <PressableScale 
            style={[styles.heroBtn, loading && styles.heroBtnDisabled]} 
            onPress={onNewProject} 
            disabled={loading}
          >
            {loading ? (
              <View style={styles.loaderContainer}>
                <ActivityIndicator size="small" color="#0A84FF" />
                <Text style={styles.loaderLabel}>Analyzing System Tracks...</Text>
              </View>
            ) : (
              <View style={styles.ctaLayout}>
                <View style={styles.plusIconFrame}>
                  <Plus size={28} color="#0F0F11" strokeWidth={3} />
                </View>
                <Text style={styles.ctaTitle}>New Project</Text>
                <Text style={styles.ctaSub}>Import clips to auto-generate timelines</Text>
              </View>
            )}
          </PressableScale>
        </View>

        {/* HORIZONTAL SWIPE ZONE FOR ACTIVE DRAFTS */}
        <View style={styles.sectionHeaderRow}>
          <FolderOpen size={16} color="#8E8E93" />
          <Text style={styles.sectionTitle}>In-Progress Drafts</Text>
          {drafts.length > 0 && <Text style={styles.countTag}>{drafts.length}</Text>}
        </View>

        {drafts.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No active drafts. Unfinished timelines save automatically here.</Text>
          </View>
        ) : (
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false} 
            contentContainerStyle={styles.horizontalScrollShelf}
          >
            {drafts.map((p) => (
              <MediaProjectCard 
                key={p.id} 
                project={p} 
                isDraft={true} 
                onPress={() => onOpenDraft(p)} 
              />
            ))}
          </ScrollView>
        )}

        {/* MULTI-COLUMN COMPACT MATRIX FOR PAST EXPORTS */}
        <View style={styles.sectionHeaderRow}>
          <Film size={16} color="#8E8E93" />
          <Text style={styles.sectionTitle}>Your Previous Edits</Text>
          {exports.length > 0 && <Text style={styles.countTag}>{exports.length}</Text>}
        </View>

        {exports.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>Your fully rendered MP4 files will appear inside this shelf folder.</Text>
          </View>
        ) : (
          <View style={styles.gridMatrix}>
            {exports.map((p) => (
              <MediaProjectCard 
                key={p.id} 
                project={p} 
                isDraft={false} 
                onPress={() => onOpenExport(p)} 
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ================= SCHEMATIC DESIGN PLATFORM UI STYLES =================
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topNavHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    backgroundColor: '#0F0F11',
    borderBottomWidth: 1,
    borderColor: '#1C1C1E',
  },
  brandText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  brandAccent: {
    color: '#0A84FF',
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(10, 132, 255, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  aiBadgeText: {
    color: '#0A84FF',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  scrollBody: {
    paddingHorizontal: space.md,
    paddingTop: space.md,
  },
  heroWrapper: {
    marginBottom: space.lg,
  },
  heroBtn: {
    height: 154,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  heroBtnDisabled: {
    backgroundColor: '#161618',
    borderWidth: 1,
    borderColor: '#242426',
  },
  ctaLayout: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusIconFrame: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#0F0F11',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  ctaTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F0F11',
    marginTop: 4,
  },
  ctaSub: {
    fontSize: 12,
    color: '#636366',
    marginTop: 2,
  },
  loaderContainer: {
    alignItems: 'center',
    gap: space.xs,
  },
  loaderLabel: {
    fontSize: 13,
    color: '#8E8E93',
    fontWeight: '500',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.md,
    marginBottom: space.sm,
    gap: 6,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  countTag: {
    fontSize: 10,
    fontWeight: '700',
    color: '#8E8E93',
    backgroundColor: '#1C1C1E',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 6,
    overflow: 'hidden',
  },
  emptyContainer: {
    backgroundColor: '#161618',
    borderRadius: 16,
    padding: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#242426',
    borderStyle: 'dashed',
    minHeight: 80,
  },
  emptyText: {
    fontSize: 12,
    lineHeight: 16,
    color: '#636366',
    textAlign: 'center',
  },
  horizontalScrollShelf: {
    gap: space.sm,
    paddingRight: space.xl,
  },
  gridMatrix: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },

  /* Refactored Aspect-Correct Card Elements */
  cardRoot: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 14,
    backgroundColor: '#161618',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#242426',
  },
  cardMedia: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  cardPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1C1C1E',
  },
  cardTopBar: {
    position: 'absolute',
    top: 6,
    left: 6,
    right: 6,
    flexDirection: 'row',
  },
  statusIndicator: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusDraft: {
    backgroundColor: 'rgba(255, 159, 10, 0.2)',
  },
  statusExported: {
    backgroundColor: 'rgba(48, 209, 88, 0.2)',
  },
  statusText: {
    fontSize: 8,
    fontWeight: '800',
    color: '#FFF',
    letterSpacing: 0.4,
  },
  cardBottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 6,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'flex-end',
  },
  cardDuration: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'Courier', // Monospace style layout alignment for structural duration text
  },
});