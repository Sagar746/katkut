import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View, Dimensions } from 'react-native';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import { Plus, Trash2, Volume2, VolumeX } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Edl } from '../core';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

function triggerTick() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export const PX_PER_SEC = 32; // Slightly denser baseline spacing matrix
export const STRIP_HEIGHT = 68;
const MIN_LEN_SEC = 0.5;
const GAP = 2; // Tighter professional gaps
const LONG_PRESS_MS = 250;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.5;
const RULER_H = 20;
const ADD_BTN_W = 52;

export interface ClipStripProps {
  timeline: Edl['timeline'];
  selectedIndex: number;
  thumbs: Record<string, string>;
  durationByClipId: Map<string, number>;
  handlesEnabled: boolean;
  onSelect: (index: number) => void;
  onToggleMute: (index: number) => void;
  onDelete: (index: number) => void;
  onTrim: (index: number, newIn: number, newOut: number) => void;
  onReorder: (from: number, to: number) => void;
  onAddMedia: () => void;
  playbackSec: number;
  onScrub: (sec: number) => void;
  onScrubStart?: () => void;
}

type TrimDraft = { index: number; in: number; out: number };
type DragState = { from: number; tx: number; target: number };

export default function ClipStrip({
  timeline,
  selectedIndex,
  thumbs,
  durationByClipId,
  handlesEnabled,
  onSelect,
  onToggleMute,
  onDelete,
  onTrim,
  onReorder,
  onAddMedia,
  playbackSec,
  onScrub,
  onScrubStart,
}: ClipStripProps) {
  const scrollRef = useRef<ScrollView>(null);
  const [trimDraft, setTrimDraft] = useState<TrimDraft | null>(null);
  const pendingRef = useRef<TrimDraft | null>(null);
  const [drag, setDragState] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  
  const dragX = useRef(new Animated.Value(0)).current;
  const [stripWidth, setStripWidth] = useState(SCREEN_WIDTH);
  const [zoom, setZoom] = useState(1);
  const zoomStartRef = useRef(1);
  const userScrubbingRef = useRef(false);

  function applyDraft(d: TrimDraft) {
    pendingRef.current = d;
    setTrimDraft(d);
  }

  function endTrim(index: number) {
    const p = pendingRef.current;
    pendingRef.current = null;
    setTrimDraft(null);
    if (p && p.index === index) {
      triggerTick();
      onTrim(index, p.in, p.out);
    }
  }

  function setDrag(d: DragState | null) {
    dragRef.current = d;
    setDragState(d);
  }

  function setDragTarget(from: number, target: number) {
    const prev = dragRef.current;
    const next = { from, tx: 0, target };
    dragRef.current = next;
    if (!prev || prev.from !== from || prev.target !== target) {
      setDragState(next);
    }
  }

  const pxPerSec = PX_PER_SEC * zoom;
  const padStart = stripWidth / 2;

  // Memoize timeline spatial layout geometry metrics to maximize gesture performance
  const layoutData = useMemo(() => {
    const widths: number[] = [];
    const centers: number[] = [];
    const leftEdges: number[] = [];
    const lens: number[] = [];
    let cursor = padStart;

    timeline.forEach((item, i) => {
      const draft = trimDraft && trimDraft.index === i ? trimDraft : null;
      const inPt = draft ? draft.in : item.in;
      const outPt = draft ? draft.out : item.out;
      const lenSec = Math.max(0, outPt - inPt);
      const w = Math.max(48, lenSec * pxPerSec);
      
      widths[i] = w;
      lens[i] = lenSec;
      leftEdges[i] = cursor;
      centers[i] = cursor + w / 2;
      cursor += w + GAP;
    });

    return { widths, centers, leftEdges, lens, totalWidth: cursor };
  }, [timeline, trimDraft, pxPerSec, padStart]);

  function targetForDrag(from: number, tx: number): number {
    const { centers } = layoutData;
    const draggedCenter = (centers[from] ?? 0) + tx;
    let best = from;
    let bestDist = Infinity;
    for (let k = 0; k < centers.length; k++) {
      const d = Math.abs(centers[k] - draggedCenter);
      if (d < bestDist) {
        bestDist = d;
        best = k;
      }
    }
    return best;
  }

  function pixelForTime(t: number): number {
    const { lens, leftEdges, widths } = layoutData;
    let elapsed = 0;
    for (let i = 0; i < lens.length; i++) {
      const len = lens[i];
      if (t <= elapsed + len || i === lens.length - 1) {
        const within = len > 0 ? Math.min(1, Math.max(0, (t - elapsed) / len)) : 0;
        return leftEdges[i] + within * widths[i];
      }
      elapsed += len;
    }
    return padStart;
  }

  function timeAtPixel(px: number): number {
    const { widths, leftEdges, lens } = layoutData;
    let elapsed = 0;
    for (let i = 0; i < widths.length; i++) {
      const left = leftEdges[i];
      const w = widths[i];
      if (px < left + w || i === widths.length - 1) {
        const within = w > 0 ? Math.min(1, Math.max(0, (px - left) / w)) : 0;
        return elapsed + within * lens[i];
      }
      elapsed += lens[i];
    }
    return elapsed;
  }

  // Follow player position head tracking
  useEffect(() => {
    if (drag || trimDraft || userScrubbingRef.current) return;
    const px = pixelForTime(playbackSec);
    scrollRef.current?.scrollTo({ x: Math.max(0, px - stripWidth / 2), animated: false });
  }, [playbackSec, stripWidth, layoutData]);

  function handleScrubBegin() {
    userScrubbingRef.current = true;
    onScrubStart?.();
  }

  function handleScrubEnd() {
    userScrubbingRef.current = false;
  }

  function handleStripScroll(e: any) {
    if (!userScrubbingRef.current) return;
    const centerPx = e.nativeEvent.contentOffset.x + stripWidth / 2;
    onScrub(timeAtPixel(centerPx));
  }

  // Continuous Ruler ticks creation
  const rulerTicks = useMemo(() => {
    const totalSec = timeline.reduce((s, t) => s + Math.max(0, t.out - t.in), 0);
    const generated: number[] = [];
    for (let s = 0; s <= Math.ceil(totalSec); s += 5) generated.push(s);
    return generated;
  }, [timeline]);

  // Discrete configuration for pinch gesture to isolate scrolling boundaries
  const pinchGesture = Gesture.Pinch()
    // callbacks call JS state/Animated (not worklets) → run them on the JS thread
    .runOnJS(true)
    .onStart(() => {
      zoomStartRef.current = zoom;
    })
    .onUpdate((e) => {
      const calculatedZoom = zoomStartRef.current * e.scale;
      setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, calculatedZoom)));
    });

  return (
    <View style={styles.stripContainer} onLayout={(e) => setStripWidth(e.nativeEvent.layout.width)}>
      <GestureDetector gesture={pinchGesture}>
        <ScrollView
          ref={scrollRef}
          horizontal
          contentContainerStyle={{ paddingHorizontal: padStart }}
          showsHorizontalScrollIndicator={false}
          onScrollBeginDrag={handleScrubBegin}
          onMomentumScrollBegin={handleScrubBegin}
          onScrollEndDrag={handleScrubEnd}
          onMomentumScrollEnd={handleScrubEnd}
          onScroll={handleStripScroll}
          scrollEventThrottle={16}
          style={styles.scrollCanvas}
        >
          <View style={{ width: layoutData.totalWidth - padStart + ADD_BTN_W + 40 }}>
            {/* Fine Time Ruler Overlay */}
            {rulerTicks.map((s) => (
              <View key={`tick-${s}`} pointerEvents="none" style={[styles.tick, { left: s * pxPerSec }]}>
                <View style={s % 10 === 0 ? styles.tickMarkMajor : styles.tickMarkMinor} />
                {s % 10 === 0 && <Text style={styles.tickLabel}>{s}s</Text>}
              </View>
            ))}

            <View style={styles.clipsRow}>
              {timeline.map((item, i) => {
                const selected = i === selectedIndex;
                const sourceDur = durationByClipId.get(item.clipId) ?? item.out;
                const isDragged = drag?.from === i;
                const isTarget = drag != null && drag.target === i && drag.from !== i;

                const reorderPan = Gesture.Pan()
                  .runOnJS(true)
                  .activateAfterLongPress(LONG_PRESS_MS)
                  .onStart(() => {
                    dragX.setValue(0);
                    setDrag({ from: i, tx: 0, target: i });
                    triggerTick();
                  })
                  .onUpdate((e) => {
                    dragX.setValue(e.translationX);
                    setDragTarget(i, targetForDrag(i, e.translationX));
                  })
                  .onEnd(() => {
                    const ds = dragRef.current;
                    setDrag(null);
                    dragX.setValue(0);
                    if (ds && ds.from !== ds.target) {
                      triggerTick();
                      onReorder(ds.from, ds.target);
                    }
                  })
                  .onFinalize(() => {
                    setDrag(null);
                    dragX.setValue(0);
                  });

                return (
                  <GestureDetector key={`${item.clipId}-${i}`} gesture={reorderPan}>
                    <Animated.View
                      style={[
                        styles.block,
                        { width: layoutData.widths[i] },
                        selected && styles.blockSelected,
                        isTarget && styles.blockTarget,
                        isDragged && {
                          transform: [{ translateX: dragX }],
                          zIndex: 50,
                          opacity: 0.75,
                          shadowColor: '#000',
                          shadowRadius: 10,
                          shadowOpacity: 0.5,
                        },
                      ]}
                    >
                      <Pressable
                        onPress={() => {
                          triggerTick();
                          onSelect(i);
                        }}
                        style={styles.blockInner}
                      >
                        {thumbs[item.clipId] ? (
                          <Image source={{ uri: thumbs[item.clipId] }} style={styles.thumb} />
                        ) : (
                          <View style={styles.placeholder} />
                        )}

                        {/* Top Utility Controllers */}
                        <View style={styles.controlPillStrip}>
                          <Pressable hitSlop={6} onPress={() => onToggleMute(i)} style={styles.glassUtilityChip}>
                            {item.muted ? <VolumeX size={11} color="#FF453A" /> : <Volume2 size={11} color="#FFF" />}
                          </Pressable>

                          {selected && handlesEnabled && (
                            <Pressable hitSlop={6} onPress={() => onDelete(i)} style={[styles.glassUtilityChip, styles.deleteBg]}>
                              <Trash2 size={11} color="#FFF" />
                            </Pressable>
                          )}
                        </View>

                        {/* CapCut-Style Ear Trim Handles */}
                        {selected && handlesEnabled && (
                          <>
                            <TrimHandle
                              side="left"
                              pxPerSec={pxPerSec}
                              origIn={item.in}
                              origOut={item.out}
                              onChange={(deltaSec, origIn, origOut) => {
                                const newIn = Math.min(Math.max(origIn + deltaSec, 0), origOut - MIN_LEN_SEC);
                                applyDraft({ index: i, in: newIn, out: origOut });
                              }}
                              onEnd={() => endTrim(i)}
                            />
                            <TrimHandle
                              side="right"
                              pxPerSec={pxPerSec}
                              origIn={item.in}
                              origOut={item.out}
                              onChange={(deltaSec, origIn, origOut) => {
                                const newOut = Math.min(
                                  Math.max(origOut + deltaSec, origIn + MIN_LEN_SEC),
                                  sourceDur,
                                );
                                applyDraft({ index: i, in: origIn, out: newOut });
                              }}
                              onEnd={() => endTrim(i)}
                            />
                          </>
                        )}
                      </Pressable>
                    </Animated.View>
                  </GestureDetector>
                );
              })}

              {/* Enhanced Interactive Append Trigger */}
              <Pressable onPress={onAddMedia} style={styles.addMediaBlock}>
                <Plus size={20} color="#FFFFFF" strokeWidth={2.5} />
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </GestureDetector>

      {/* Hero Central Needle Playhead */}
      <View pointerEvents="none" style={styles.needlePlayhead} />
    </View>
  );
}

interface TrimHandleProps {
  side: 'left' | 'right';
  pxPerSec: number;
  origIn: number;
  origOut: number;
  onChange: (deltaSec: number, origIn: number, origOut: number) => void;
  onEnd: () => void;
}

function TrimHandle({ side, pxPerSec, origIn, origOut, onChange, onEnd }: TrimHandleProps) {
  const orig = useRef({ in: origIn, out: origOut });
  const pan = Gesture.Pan()
    .runOnJS(true)
    .onBegin(() => {
      orig.current = { in: origIn, out: origOut };
    })
    .onUpdate((e) => {
      onChange(e.translationX / pxPerSec, orig.current.in, orig.current.out);
    })
    .onEnd(onEnd)
    .onFinalize(onEnd);

  return (
    <GestureDetector gesture={pan}>
      <View style={[styles.handleEar, side === 'left' ? styles.earLeft : styles.earRight]}>
        <View style={styles.earGripPill} />
      </View>
    </GestureDetector>
  );
}

// ================= PREMIUM WORKSPACE STYLING CONFIG =================
const styles = StyleSheet.create({
  stripContainer: {
    backgroundColor: '#121214', // Deep cinematic neutral backdrop
    paddingVertical: 12,
    justifyContent: 'center',
  },
  scrollCanvas: {
    overflow: 'visible',
  },
  tick: {
    position: 'absolute',
    top: 2,
    alignItems: 'center',
  },
  tickMarkMajor: { width: 1.5, height: 8, backgroundColor: '#48484A' },
  tickMarkMinor: { width: 1, height: 4, backgroundColor: '#2C2C2E' },
  tickLabel: { color: '#8E8E93', fontSize: 9, fontWeight: '600', marginTop: 2, fontVariant: ['tabular-nums'] },
  clipsRow: {
    marginTop: RULER_H,
    flexDirection: 'row',
    gap: GAP,
    alignItems: 'center',
    paddingVertical: 4,
  },
  addMediaBlock: {
    width: ADD_BTN_W,
    height: STRIP_HEIGHT,
    borderRadius: 12,
    backgroundColor: '#1C1C1E',
    borderWidth: 1.5,
    borderColor: '#2C2C2E',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  needlePlayhead: {
    position: 'absolute',
    left: '50%',
    marginLeft: -1,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#FFD60A', // Distinct yellow precision marker line
    zIndex: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 3,
  },
  block: {
    height: STRIP_HEIGHT,
    borderRadius: 8,
    overflow: 'visible', // Visible handle elements
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: '#1C1C1E',
  },
  blockInner: { flex: 1, overflow: 'hidden', borderRadius: 6 },
  blockSelected: { 
    borderColor: '#FFD60A', // Premium neon outline accents
    borderWidth: 2,
  },
  blockTarget: { borderColor: '#0A84FF', borderStyle: 'dashed', borderWidth: 2 },
  thumb: { width: '100%', height: '100%', resizeMode: 'cover' },
  placeholder: { flex: 1, backgroundColor: '#2C2C2E' },
  
  /* Floating Glassmorphic Widgets */
  controlPillStrip: {
    position: 'absolute',
    top: 4,
    left: 4,
    right: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    pointerEvents: 'box-none',
  },
  glassUtilityChip: {
    backgroundColor: 'rgba(30, 30, 32, 0.75)',
    borderRadius: 6,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBg: {
    backgroundColor: 'rgba(255, 69, 58, 0.85)',
  },

  /* Solid Pro Handle Architectures */
  handleEar: {
    position: 'absolute',
    top: -2,
    bottom: -2,
    width: 14,
    backgroundColor: '#FFD60A',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 60,
  },
  earLeft: { 
    left: -12, 
    borderTopLeftRadius: 6, 
    borderBottomLeftRadius: 6 
  },
  earRight: { 
    right: -12, 
    borderTopRightRadius: 6, 
    borderBottomRightRadius: 6 
  },
  earGripPill: { width: 2, height: 16, borderRadius: 1, backgroundColor: '#121214' },
});