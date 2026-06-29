import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MoreHorizontal, Pause, Pencil, Play, Wand2, X, LucideIcon } from 'lucide-react-native';
import EdlPlayer, { EdlPlayerHandle } from './EdlPlayer';
import { uriMapFromAnalyses } from './resultEdl';
import { AnalysisClip, Edl } from '../core';
import { colors, radius, space, type } from './theme';
import Button from './components/Button';
import PressableScale from './components/PressableScale';

export interface ResultScreenProps {
  analyses: AnalysisClip[];
  edl: Edl;
  /** clipId → low-res preview proxy (preview only; missing entries fall back to the original) */
  proxyByClipId?: Map<string, string>;
  onExport: () => void;
  onEdit: () => void;
  onRegenerate: () => void;
  onClose: () => void;
}

function GhostAction({
  icon: Icon,
  label,
  tint,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  tint?: string;
  onPress: () => void;
}) {
  return (
    <PressableScale style={styles.ghost} onPress={onPress}>
      <Icon size={22} color={tint ?? colors.text.primary} strokeWidth={2} />
      <Text style={styles.ghostLabel}>{label}</Text>
    </PressableScale>
  );
}

/** Spec §6.5 — preview the generated reel (video fills the screen) and choose what's next. */
export default function ResultScreen({
  analyses,
  edl,
  proxyByClipId,
  onExport,
  onEdit,
  onRegenerate,
  onClose,
}: ResultScreenProps) {
  const insets = useSafeAreaInsets();
  const playerRef = useRef<EdlPlayerHandle>(null);
  const [playing, setPlaying] = useState(true);

  const uriByClipId = useMemo(() => {
    const m = uriMapFromAnalyses(analyses);
    if (proxyByClipId) for (const [clipId, uri] of proxyByClipId) m.set(clipId, uri);
    return m;
  }, [analyses, proxyByClipId]);

  return (
    <View style={styles.root}>
      <EdlPlayer
        ref={playerRef}
        edl={edl}
        uriByClipId={uriByClipId}
        fill
        loop
        onPlayingChange={setPlaying}
      />

      {/* tap anywhere on the video to play/pause */}
      <Pressable style={styles.tapZone} onPress={() => playerRef.current?.togglePlay()} />

      {/* top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + space.xs }]}>
        <Pressable hitSlop={10} onPress={onClose} style={styles.iconBtn}>
          <X size={24} color={colors.text.primary} />
        </Pressable>
        <Text style={styles.title}>Your reel</Text>
        <Pressable hitSlop={10} style={styles.iconBtn}>
          <MoreHorizontal size={24} color={colors.text.primary} />
        </Pressable>
      </View>

      {!playing && (
        <View style={styles.playHint} pointerEvents="none">
          <Play size={40} color={colors.text.primary} fill={colors.text.primary} />
        </View>
      )}

      {/* bottom actions */}
      <View style={[styles.actions, { paddingBottom: insets.bottom + space.md }]}>
        <Button label="Export" onPress={onExport} />
        <View style={styles.ghostRow}>
          <GhostAction icon={Pencil} label="Edit" onPress={onEdit} />
          <GhostAction icon={Wand2} label="Regenerate" tint={colors.ai.default} onPress={onRegenerate} />
          <GhostAction
            icon={playing ? Pause : Play}
            label="Preview"
            onPress={() => playerRef.current?.togglePlay()}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg.base },
  tapZone: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { ...type.heading, color: colors.text.primary },
  playHint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.md,
    paddingTop: space.lg,
    gap: space.md,
    backgroundColor: colors.bg.overlay,
  },
  ghostRow: { flexDirection: 'row', justifyContent: 'space-around' },
  ghost: { alignItems: 'center', gap: space.xs, paddingVertical: space.sm, paddingHorizontal: space.md },
  ghostLabel: { ...type.bodySm, color: colors.text.primary },
});
