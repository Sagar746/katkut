import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pause, Play, Redo2, Undo2, X, Download } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import EdlPlayer, { EdlPlayerHandle } from './EdlPlayer';
import ClipStrip from './ClipStrip';
import { colors, radius, space, type } from './theme';
import { uriMapFromAnalyses } from './resultEdl';
import { useClipThumbnails } from './useClipThumbnails';
import { useEdlHistory } from './useEdlHistory';
import { VideoAnalysis } from '../native';
import {
  AnalysisClip,
  Edl,
  deleteClip,
  reorderClip,
  selectTimeline,
  toggleMute,
  recomputeTargetDuration,
} from '../core';

export interface EditorScreenProps {
  analyses: AnalysisClip[];
  initialEdl: Edl;
  onBack: (currentEdl: Edl) => void;
  onExport: (currentEdl: Edl) => void;
  proxyByClipId?: Map<string, string>;
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export default function EditorScreen({ analyses, initialEdl, onBack, onExport, proxyByClipId }: EditorScreenProps) {
  const insets = useSafeAreaInsets();
  const { edl, commit, undo, redo, canUndo, canRedo } = useEdlHistory(initialEdl);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [progress, setProgress] = useState({ cur: 0, total: 0 });
  const [adding, setAdding] = useState(false);

  const [extraAnalyses, setExtraAnalyses] = useState<AnalysisClip[]>([]);
  const allAnalyses = useMemo(() => [...analyses, ...extraAnalyses], [analyses, extraAnalyses]);

  const playerRef = useRef<EdlPlayerHandle>(null);
  const pendingSeekRef = useRef<{ index: number; play: boolean } | null>(null);

  const uriByClipId = useMemo(() => uriMapFromAnalyses(allAnalyses), [allAnalyses]);
  const previewUriByClipId = useMemo(() => {
    const m = uriMapFromAnalyses(allAnalyses);
    if (proxyByClipId) {
      for (const [clipId, uri] of proxyByClipId) m.set(clipId, uri);
    }
    return m;
  }, [allAnalyses, proxyByClipId]);

  const durationByClipId = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of allAnalyses) m.set(a.clipId, a.duration);
    return m;
  }, [allAnalyses]);

  const thumbs = useClipThumbnails(edl.timeline, uriByClipId);

  useEffect(() => {
    setCurrentIndex((i) => Math.min(i, Math.max(0, edl.timeline.length - 1)));
  }, [edl.timeline.length]);

  useEffect(() => {
    const p = pendingSeekRef.current;
    if (p) {
      pendingSeekRef.current = null;
      playerRef.current?.seekToIndex(p.index, { play: p.play });
    }
  }, [edl]);

  function handleSelect(index: number) {
    setCurrentIndex(index);
    playerRef.current?.seekToIndex(index, { play: false });
  }

  function handleToggleMute(index: number) {
    commit(toggleMute(edl, index));
    pendingSeekRef.current = { index, play: isPlaying };
  }

  function handleDelete(index: number) {
    const next = deleteClip(edl, index);
    commit(next);
    pendingSeekRef.current = { index: Math.min(index, next.timeline.length - 1), play: isPlaying };
  }

  function handleTrim(index: number, newIn: number, newOut: number) {
    const timeline = edl.timeline.map((t, i) =>
      i === index ? { ...t, in: newIn, out: newOut } : t,
    );
    commit(recomputeTargetDuration({ ...edl, timeline }));
    pendingSeekRef.current = { index, play: false };
  }

  function handleReorder(from: number, to: number) {
    commit(reorderClip(edl, from, to));
    pendingSeekRef.current = { index: to, play: isPlaying };
  }

  async function handleAddMedia() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsMultipleSelection: true,
      selectionLimit: 0,
      quality: 1,
    });
    if (result.canceled || result.assets.length === 0) return;

    setAdding(true);
    try {
      const stamp = Date.now();
      const newAnalyses: AnalysisClip[] = [];
      for (let i = 0; i < result.assets.length; i++) {
        const clipId = `add_${stamp}_${i}`;
        const a = await VideoAnalysis.analyze(result.assets[i].uri, clipId);
        newAnalyses.push(a);
      }
      const sel = selectTimeline(newAnalyses);
      const newItems =
        sel.timeline.length > 0
          ? sel.timeline
          : newAnalyses.map((a) => ({ clipId: a.clipId, in: 0, out: a.duration, muted: false }));

      setExtraAnalyses((prev) => [...prev, ...newAnalyses]);
      const appended = recomputeTargetDuration({
        ...edl,
        timeline: [...edl.timeline, ...newItems],
      });
      commit(appended);
      pendingSeekRef.current = { index: edl.timeline.length, play: false };
    } catch (e) {
      console.warn('Add media failed', e);
    } finally {
      setAdding(false);
    }
  }

  return (
    <View style={styles.root}>
      {/* Top Professional Header Navigation */}
      <View style={[styles.topBar, { paddingTop: insets.top + space.sm }]}>
        <Pressable hitSlop={12} onPress={() => onBack(edl)} style={styles.closeButton}>
          <X size={20} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.workspaceTitle}>Studio Editor</Text>
        <Pressable style={styles.exportBtn} onPress={() => onExport(edl)}>
          <Download size={14} color="#0F0F11" strokeWidth={2.5} />
          <Text style={styles.exportText}>Export</Text>
        </Pressable>
      </View>

      {/* Central Portrait Studio Canvas Monitoring Surface */}
      <View style={styles.canvasWrap}>
        <View style={styles.canvasContainer}>
          <EdlPlayer
            ref={playerRef}
            edl={edl}
            uriByClipId={previewUriByClipId}
            fill
            loop
            onActiveIndexChange={setCurrentIndex}
            onPlayingChange={setIsPlaying}
            onProgress={(cur, total) => setProgress({ cur, total })}
          />
          <Pressable
            style={styles.canvasTapOverlay}
            onPress={() => playerRef.current?.togglePlay()}
          />
        </View>
      </View>

      {/* Core Studio System Controls Infrastructure */}
      <View style={styles.controlCenter}>
        <Pressable 
          hitSlop={12} 
          onPress={() => playerRef.current?.togglePlay()} 
          style={styles.playbackControllerButton}
        >
          {isPlaying ? (
            <Pause size={20} color="#0F0F11" fill="#0F0F11" />
          ) : (
            <Play size={20} color="#0F0F11" fill="#0F0F11" style={{ marginLeft: 2 }} />
          )}
        </Pressable>

        <View style={styles.timecodeDisplayFrame}>
          <Text style={styles.timecodeActive}>{fmtTime(progress.cur)}</Text>
          <Text style={styles.timecodeDivider}>/</Text>
          <Text style={styles.timecodeTotal}>{fmtTime(progress.total)}</Text>
        </View>

        <View style={styles.historyTrackGroup}>
          <Pressable hitSlop={8} onPress={undo} disabled={!canUndo} style={[styles.historyActionBtn, !canUndo && styles.disabledHistory]}>
            <Undo2 size={18} color={canUndo ? '#E5E5EA' : '#48484A'} />
          </Pressable>
          <Pressable hitSlop={8} onPress={redo} disabled={!canRedo} style={[styles.historyActionBtn, !canRedo && styles.disabledHistory]}>
            <Redo2 size={18} color={canRedo ? '#E5E5EA' : '#48484A'} />
          </Pressable>
        </View>
      </View>

      {/* Dynamic Linear Sequence Timeline Track */}
      <View style={[styles.stripWrap, { paddingBottom: insets.bottom + space.sm }]}>
        <ClipStrip
          timeline={edl.timeline}
          selectedIndex={currentIndex}
          thumbs={thumbs}
          durationByClipId={durationByClipId}
          handlesEnabled={!isPlaying}
          onSelect={handleSelect}
          onToggleMute={handleToggleMute}
          onDelete={handleDelete}
          onTrim={handleTrim}
          onReorder={handleReorder}
          onAddMedia={handleAddMedia}
          playbackSec={progress.cur}
          onScrub={(sec) => playerRef.current?.scrubTo(sec)}
          onScrubStart={() => playerRef.current?.pause()}
        />
      </View>

      {/* High-Performance Analysis Sync Modal Cover */}
      {adding && (
        <View style={styles.processingBlockerCover}>
          <View style={styles.processingDialogCard}>
            <ActivityIndicator size="small" color="#0A84FF" />
            <Text style={styles.processingMessageText}>Running local heuristics passes…</Text>
          </View>
        </View>
      )}
    </View>
  );
}

// ================= SCHEMATIC DESIGN CODES =================
const styles = StyleSheet.create({
  root: { 
    flex: 1, 
    backgroundColor: '#070708' // Pitch black editing suite focus environment
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    backgroundColor: '#070708',
    borderBottomWidth: 1,
    borderColor: '#121214',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#161618',
    alignItems: 'center',
    justifyContent: 'center',
  },
  workspaceTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#E5E5EA',
    letterSpacing: 0.2,
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0A84FF',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
  },
  exportText: { 
    fontSize: 13,
    fontWeight: '700',
    color: '#0F0F11' 
  },
  canvasWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.md,
    paddingHorizontal: space.xl,
  },
  canvasContainer: {
    height: '100%',
    aspectRatio: 9 / 16,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000000',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 12,
  },
  canvasTapOverlay: { 
    position: 'absolute', 
    top: 0, 
    left: 0, 
    right: 0, 
    bottom: 0 
  },
  controlCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    backgroundColor: '#121214',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  playbackControllerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  timecodeDisplayFrame: { 
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161618',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  timecodeActive: { 
    fontSize: 12, 
    fontWeight: '700', 
    color: '#FFFFFF', 
    fontVariant: ['tabular-nums'] 
  },
  timecodeDivider: {
    fontSize: 12,
    color: '#48484A',
    fontWeight: '600',
  },
  timecodeTotal: { 
    fontSize: 12, 
    color: '#8E8E93', 
    fontWeight: '500',
    fontVariant: ['tabular-nums'] 
  },
  historyTrackGroup: { 
    flexDirection: 'row', 
    gap: 6 
  },
  historyActionBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#161618',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledHistory: {
    backgroundColor: '#0F0F11',
    opacity: 0.3,
  },
  stripWrap: { 
    backgroundColor: '#121214'
  },
  processingBlockerCover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(7, 7, 8, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  processingDialogCard: {
    backgroundColor: '#161618',
    borderWidth: 1,
    borderColor: '#242426',
    borderRadius: 16,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
  },
  processingMessageText: { 
    fontSize: 13, 
    fontWeight: '600',
    color: '#E5E5EA' 
  },
});