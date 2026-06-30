import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Rect } from 'react-native-svg';
import { Check, Share2, ChevronLeft, Film, Download } from 'lucide-react-native';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { exportReel } from './exportReel';
import { saveToGallery, shareReel } from './share';
import { AnalysisClip, Edl } from '../core';
import { ExportResolution } from '../native';
import { saveDraft, markExported } from '../services';
import { space } from './theme';
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

const THUMB_W = 200;
const THUMB_H = (THUMB_W * 16) / 9;
const STROKE = 2;
const RECT_W = THUMB_W - STROKE;
const RECT_H = THUMB_H - STROKE;
const CORNER_R = 16;
const PERIMETER = 2 * (RECT_W - 2 * CORNER_R + RECT_H - 2 * CORNER_R) + 2 * Math.PI * CORNER_R;

export default function ExportScreen({ analyses, edl, vibeId, projectId, onDone, onCancel }: ExportScreenProps) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>({ kind: 'config' });
  const [resolution, setResolution] = useState<ExportResolution>('1080p');
  const [prog, setProg] = useState(0);
  const [thumb, setThumb] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const rampRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    setPhase({ kind: 'running', label: 'Preparing export...' });
    setProg(0);
    
    rampRef.current = setInterval(() => {
      setProg((p) => (p < 0.92 ? p + (0.92 - p) * 0.08 : p));
    }, 80);

    try {
      setPhase({ kind: 'running', label: 'Rendering video...' });
      const { outputPath } = await exportReel(edl, analyses, resolution);

      setPhase({ kind: 'running', label: 'Saving to gallery...' });
      await saveToGallery(outputPath);

      let thumbUri: string | undefined = thumb ?? undefined;
      try {
        const t = await VideoThumbnails.getThumbnailAsync(outputPath, { time: 0 });
        thumbUri = t.uri;
      } catch {}
      
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
  const isRunning = phase.kind === 'running';
  const isConfig = phase.kind === 'config';
  const isError = phase.kind === 'error';
  
  const borderColor = isDone ? '#34C759' : '#007AFF';
  const dashoffset = PERIMETER * (1 - prog);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      
      {/* Header */}
      <View style={styles.header}>
        <PressableScale hitSlop={12} onPress={onCancel} style={styles.backButton}>
          <ChevronLeft size={22} color="#FFFFFF" strokeWidth={2} />
        </PressableScale>
        <Text style={styles.headerTitle}>
          {isRunning ? 'Exporting' : isDone ? 'Complete' : 'Export Video'}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Main Content */}
      <View style={styles.content}>
        
        {/* Thumbnail Preview */}
        <View style={styles.previewContainer}>
          <View style={styles.thumbnailWrapper}>
            {thumb ? (
              <Image source={{ uri: thumb }} style={styles.thumbnail} resizeMode="cover" />
            ) : (
              <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
                <Film size={36} color="#48484A" strokeWidth={1.5} />
              </View>
            )}
            
            {!isConfig && (
              <>
                <View style={styles.overlay} />
                <Svg width={THUMB_W} height={THUMB_H} style={StyleSheet.absoluteFill}>
                  <Rect
                    x={STROKE / 2}
                    y={STROKE / 2}
                    width={RECT_W}
                    height={RECT_H}
                    rx={CORNER_R}
                    fill="none"
                    stroke={borderColor}
                    strokeWidth={STROKE}
                    strokeLinecap="round"
                    strokeDasharray={PERIMETER}
                    strokeDashoffset={dashoffset}
                  />
                </Svg>
                <View style={styles.thumbnailOverlay}>
                  {isDone ? (
                    <View style={styles.successIcon}>
                      <Check size={32} color="#FFFFFF" strokeWidth={3} />
                    </View>
                  ) : (
                    <View style={styles.progressContainer}>
                      <Text style={styles.progressText}>{Math.round(prog * 100)}%</Text>
                    </View>
                  )}
                </View>
              </>
            )}
          </View>
        </View>

        {/* Status Message */}
        <View style={styles.statusContainer}>
          {isConfig && (
            <Text style={styles.statusDescription}>
              Choose your preferred quality and export your video
            </Text>
          )}
          {isRunning && (
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color="#007AFF" />
              <Text style={styles.statusText}>{phase.label}</Text>
            </View>
          )}
          {isDone && (
            <View style={styles.statusRow}>
              <Check size={16} color="#34C759" strokeWidth={3} />
              <Text style={[styles.statusText, styles.successText]}>Saved to your gallery</Text>
            </View>
          )}
        </View>

        {/* Resolution Selector */}
        {isConfig && (
          <View style={styles.resolutionContainer}>
            <PressableScale
              style={[styles.resolutionOption, resolution === '720p' && styles.resolutionActive]}
              onPress={() => setResolution('720p')}
            >
              <Text style={[styles.resolutionText, resolution === '720p' && styles.resolutionTextActive]}>
                HD 720p
              </Text>
              <Text style={[styles.resolutionSubtext, resolution === '720p' && styles.resolutionTextActive]}>
                Good quality, smaller file
              </Text>
            </PressableScale>
            
            <PressableScale
              style={[styles.resolutionOption, resolution === '1080p' && styles.resolutionActive]}
              onPress={() => setResolution('1080p')}
            >
              <Text style={[styles.resolutionText, resolution === '1080p' && styles.resolutionTextActive]}>
                Full HD 1080p
              </Text>
              <Text style={[styles.resolutionSubtext, resolution === '1080p' && styles.resolutionTextActive]}>
                Best quality recommended
              </Text>
            </PressableScale>
          </View>
        )}
      </View>

      {/* Footer Actions */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
        {isConfig && (
          <PressableScale style={styles.primaryButton} onPress={startExport}>
            <Download size={20} color="#000000" strokeWidth={2} />
            <Text style={styles.primaryButtonText}>Export Video</Text>
          </PressableScale>
        )}

        {isDone && (
          <View style={styles.actionRow}>
            <PressableScale style={styles.primaryButton} onPress={() => handleShare(phase.outputPath)}>
              <Share2 size={20} color="#000000" strokeWidth={2} />
              <Text style={styles.primaryButtonText}>Share Video</Text>
            </PressableScale>
            
            <PressableScale style={styles.secondaryButton} onPress={onDone}>
              <Text style={styles.secondaryButtonText}>Done</Text>
            </PressableScale>
            
            {saveMsg && <Text style={styles.errorText}>{saveMsg}</Text>}
          </View>
        )}

        {isError && (
          <View style={styles.actionRow}>
            <View style={styles.errorContainer}>
              <Text style={styles.errorTitle}>Export Failed</Text>
              <Text style={styles.errorMessage}>{phase.message}</Text>
            </View>
            <PressableScale style={styles.secondaryButton} onPress={onCancel}>
              <Text style={styles.secondaryButtonText}>Go Back</Text>
            </PressableScale>
          </View>
        )}

        {isRunning && (
          <Text style={styles.keepOpenText}>Please keep the app open during export</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1C1C1E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  headerSpacer: {
    width: 40,
  },
  content: {
    flex: 1,
    paddingHorizontal: space.lg,
  },
  previewContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
  },
  thumbnailWrapper: {
    width: THUMB_W,
    height: THUMB_H,
    borderRadius: CORNER_R,
    overflow: 'hidden',
    backgroundColor: '#1C1C1E',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  thumbnailPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1C1C1E',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  thumbnailOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressText: {
    fontSize: 42,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#34C759',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusContainer: {
    alignItems: 'center',
    marginBottom: space.lg,
    minHeight: 40,
  },
  statusDescription: {
    fontSize: 15,
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 20,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: {
    fontSize: 14,
    color: '#8E8E93',
    fontWeight: '500',
  },
  successText: {
    color: '#34C759',
    fontWeight: '600',
  },
  resolutionContainer: {
    gap: 10,
    marginBottom: space.md,
  },
  resolutionOption: {
    backgroundColor: '#1C1C1E',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#2C2C2E',
  },
  resolutionActive: {
    borderColor: '#007AFF',
    backgroundColor: '#1C1C1E',
  },
  resolutionText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  resolutionTextActive: {
    color: '#007AFF',
  },
  resolutionSubtext: {
    fontSize: 13,
    color: '#8E8E93',
  },
  footer: {
    paddingHorizontal: space.lg,
    gap: space.md,
  },
  actionRow: {
    gap: 12,
  },
  primaryButton: {
    backgroundColor: '#FFFFFF',
    height: 54,
    borderRadius: 27,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  secondaryButton: {
    height: 54,
    borderRadius: 27,
    borderWidth: 1.5,
    borderColor: '#2C2C2E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '500',
  },
  errorContainer: {
    backgroundColor: 'rgba(255, 59, 48, 0.1)',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 59, 48, 0.2)',
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FF3B30',
    marginBottom: 4,
  },
  errorMessage: {
    fontSize: 14,
    color: '#FF3B30',
    lineHeight: 20,
  },
  errorText: {
    fontSize: 13,
    color: '#FF3B30',
    textAlign: 'center',
  },
  keepOpenText: {
    fontSize: 13,
    color: '#636366',
    textAlign: 'center',
    lineHeight: 18,
  },
});