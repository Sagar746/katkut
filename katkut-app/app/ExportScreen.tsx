import { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Rect } from 'react-native-svg';
import { Check, Download, Share2 } from 'lucide-react-native';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { exportReel } from './exportReel';
import { saveToGallery, shareReel } from './share';
import { AnalysisClip, Edl } from '../core';
import { ExportResolution } from '../native';
import { saveDraft, markExported } from '../services';
import { colors, radius, space, type } from './theme';
import Button from './components/Button';
import PressableScale from './components/PressableScale';

export interface ExportScreenProps {
  analyses: AnalysisClip[];
  edl: Edl;
  vibeId: string;
  projectId: string;
  onDone: () => void;
  onCancel: () => void;
}

type Phase =
  | { kind: 'config' }
  | { kind: 'running'; label: string }
  | { kind: 'done'; outputPath: string }
  | { kind: 'error'; message: string };

// TODO(monetization, Rule 6 "ads later"): swap for a real full-screen ad SDK.
async function showAdStub(): Promise<void> {
  await new Promise((r) => setTimeout(r, 800));
}

const THUMB_W = 220;
const THUMB_H = (THUMB_W * 16) / 9;
const STROKE = 4;
const RECT_W = THUMB_W - STROKE;
const RECT_H = THUMB_H - STROKE;
const PERIMETER = 2 * (RECT_W - 2 * radius.lg + RECT_H - 2 * radius.lg) + 2 * Math.PI * radius.lg;

export default function ExportScreen({ analyses, edl, vibeId, projectId, onDone, onCancel }: ExportScreenProps) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>({ kind: 'config' });
  const [resolution, setResolution] = useState<ExportResolution>('1080p');
  const [prog, setProg] = useState(0);
  const [thumb, setThumb] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const rampRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // first-frame thumbnail for the export card
  useEffect(() => {
    const uri = analyses.find((a) => a.clipId === edl.timeline[0]?.clipId)?.uri;
    if (!uri) return;
    VideoThumbnails.getThumbnailAsync(uri, { time: 0 })
      .then((t) => setThumb(t.uri))
      .catch(() => {});
  }, [analyses, edl]);

  useEffect(() => () => {
    if (rampRef.current) clearInterval(rampRef.current);
  }, []);

  async function startExport() {
    setPhase({ kind: 'running', label: 'Preparing…' });
    setProg(0);
    // no real per-frame progress from native — ease the border toward 90%, then complete on resolve
    rampRef.current = setInterval(() => {
      setProg((p) => (p < 0.9 ? p + (0.9 - p) * 0.05 : p));
    }, 100);

    try {
      await showAdStub();
      setPhase({ kind: 'running', label: 'Rendering video…' });
      const { outputPath } = await exportReel(edl, analyses, resolution);

      setPhase({ kind: 'running', label: 'Finalizing…' });
      await saveToGallery(outputPath);

      let thumbUri: string | undefined = thumb ?? undefined;
      try {
        const t = await VideoThumbnails.getThumbnailAsync(outputPath, { time: 0 });
        thumbUri = t.uri;
      } catch {
        // best-effort
      }
      await saveDraft({ id: projectId, vibeId, edl, analyses, thumbUri });
      await markExported(projectId, outputPath);

      if (rampRef.current) clearInterval(rampRef.current);
      setProg(1);
      setPhase({ kind: 'done', outputPath });
    } catch (e) {
      if (rampRef.current) clearInterval(rampRef.current);
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function handleShare(outputPath: string) {
    setSaveMsg(null);
    try {
      await shareReel(outputPath);
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : String(e));
    }
  }

  const isDone = phase.kind === 'done';
  const borderColor = isDone ? colors.success : colors.accent.default;
  const dashoffset = PERIMETER * (1 - prog);

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.lg }]}>
      <Text style={styles.title}>
        {phase.kind === 'config' ? 'Export your reel' : isDone ? 'Exported' : 'Exporting'}
      </Text>

      {/* thumbnail with the tracing progress border */}
      <View style={styles.thumbWrap}>
        {thumb ? (
          <Image source={{ uri: thumb }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]} />
        )}
        {phase.kind !== 'config' && (
          <>
            <View style={styles.dim} />
            <Svg width={THUMB_W} height={THUMB_H} style={StyleSheet.absoluteFill}>
              <Rect
                x={STROKE / 2}
                y={STROKE / 2}
                width={RECT_W}
                height={RECT_H}
                rx={radius.lg}
                fill="none"
                stroke={borderColor}
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={PERIMETER}
                strokeDashoffset={dashoffset}
              />
            </Svg>
            <View style={styles.thumbCenter} pointerEvents="none">
              {isDone ? (
                <View style={styles.checkCircle}>
                  <Check size={36} color={colors.success} strokeWidth={3} />
                </View>
              ) : (
                <Text style={styles.pct}>{Math.round(prog * 100)}%</Text>
              )}
            </View>
          </>
        )}
      </View>

      {phase.kind === 'running' && <Text style={styles.status}>{phase.label}</Text>}

      {/* config: resolution chips + start */}
      {phase.kind === 'config' && (
        <View style={styles.configBlock}>
          <View style={styles.chips}>
            {(['1080p', '720p'] as ExportResolution[]).map((r) => {
              const active = resolution === r;
              return (
                <PressableScale
                  key={r}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setResolution(r)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {r}
                    {r === '720p' ? '  ·  fast' : '  ·  best'}
                  </Text>
                </PressableScale>
              );
            })}
          </View>
          <Button label="Export" icon={<Download size={20} color={colors.accent.onAccent} />} onPress={startExport} />
          <Button label="Back" variant="ghost" onPress={onCancel} />
        </View>
      )}

      {isDone && (
        <View style={styles.doneBlock}>
          <Text style={styles.savedLine}>Saved to your gallery · finish it in TikTok, Instagram or CapCut.</Text>
          <Button
            label="Share"
            icon={<Share2 size={20} color={colors.accent.onAccent} />}
            onPress={() => handleShare((phase as { outputPath: string }).outputPath)}
          />
          <Button label="Done" variant="ghost" onPress={onDone} />
          {saveMsg && <Text style={styles.errorMsg}>{saveMsg}</Text>}
        </View>
      )}

      {phase.kind === 'error' && (
        <View style={styles.doneBlock}>
          <Text style={styles.errorMsg}>{phase.message}</Text>
          <Button label="Back" variant="ghost" onPress={onCancel} />
        </View>
      )}

      {phase.kind === 'running' && (
        <Text style={styles.reassure}>Keep the app open while exporting.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg.base, alignItems: 'center', paddingHorizontal: space.md, gap: space.lg },
  title: { ...type.title, color: colors.text.primary, marginTop: space.sm },
  thumbWrap: { width: THUMB_W, height: THUMB_H, marginTop: space.md },
  thumb: { width: THUMB_W, height: THUMB_H, borderRadius: radius.lg, backgroundColor: colors.bg.surface },
  thumbPlaceholder: { backgroundColor: colors.bg.surface },
  dim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.lg, backgroundColor: 'rgba(0,0,0,0.35)' },
  thumbCenter: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  pct: { ...type.display, color: colors.text.primary, fontVariant: ['tabular-nums'] },
  checkCircle: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    backgroundColor: colors.bg.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: { ...type.body, color: colors.text.secondary },
  configBlock: { width: '100%', gap: space.sm, marginTop: 'auto' },
  chips: { flexDirection: 'row', gap: space.sm, marginBottom: space.sm },
  chip: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: { borderColor: colors.accent.default, backgroundColor: colors.accent.bg },
  chipText: { ...type.bodySm, color: colors.text.secondary },
  chipTextActive: { color: colors.accent.default, fontWeight: '700' },
  doneBlock: { width: '100%', gap: space.sm, marginTop: 'auto' },
  savedLine: { ...type.bodySm, color: colors.text.secondary, textAlign: 'center' },
  errorMsg: { ...type.bodySm, color: colors.error, textAlign: 'center' },
  reassure: { ...type.bodySm, color: colors.text.muted, marginTop: 'auto' },
});
