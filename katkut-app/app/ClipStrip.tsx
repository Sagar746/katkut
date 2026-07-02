import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Image, Pressable, StyleSheet, Text, View, Dimensions } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useAnimatedRef,
  useDerivedValue,
  useSharedValue,
  SharedValue,
  scrollTo,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import { Plus, Trash2, VolumeX, ChevronLeft, ChevronRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Edl } from '../core';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Gesture-handler ScrollView wrapped so Reanimated's scrollTo worklet can drive it on the UI thread.
const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);

// One clip's timeline layout, precomputed for the UI-thread scroll worklet.
type ClipLayout = { startSec: number; durSec: number; offsetPx: number; widthPx: number };

function hapticLight() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

function hapticMedium() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export const PX_PER_SEC = 35;
export const STRIP_HEIGHT = 72;
const MIN_LEN_SEC = 0.3;
// A photo is a still, so it has no source-footage limit — it can be held up to this long.
const MAX_PHOTO_SEC = 10;
// Filmstrip tile width. Thumbnails are drawn as repeated fixed-width tiles so extending a clip
// reveals more tiles instead of zooming a single stretched image.
const THUMB_TILE_W = 44;
const GAP = 2;
const LONG_PRESS_MS = 180;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.5;
const RULER_H = 22;
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
  /** Current playback position (seconds) as a shared value — drives the strip on the UI thread. */
  playbackSv: SharedValue<number>;
  onScrub: (sec: number) => void;
  onScrubStart?: () => void;
}

// ---- Sub-component so useAnimatedStyle is called at the top level of a component, not inside
// a .map() loop — which would violate the Rules of Hooks and crash the app.
function AnimatedClip({
  index,
  isSelected,
  widthsSv,
  translatesSv,
  dragActiveSv,
  children,
}: {
  index: number;
  isSelected: boolean;
  widthsSv: SharedValue<number[]>;
  translatesSv: SharedValue<number[]>;
  dragActiveSv: SharedValue<number>;
  children: React.ReactNode;
}) {
  const animStyle = useAnimatedStyle(() => ({
    width: widthsSv.value[index] ?? 52,
    transform: [{ translateX: translatesSv.value[index] ?? 0 }],
    zIndex: dragActiveSv.value === index ? 100 : isSelected ? 50 : 1,
  }));
  return (
    <Animated.View style={[styles.clipBlock, animStyle]}>
      {children}
    </Animated.View>
  );
}

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
  playbackSv,
  onScrub,
  onScrubStart,
}: ClipStripProps) {
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const [stripWidth, setStripWidth] = useState(SCREEN_WIDTH);
  const [zoom, setZoom] = useState(1);
  const zoomStartRef = useRef(1);
  const userScrubbingRef = useRef(false);
  const scrubEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pxPerSec = PX_PER_SEC * zoom;
  const padStart = stripWidth / 2;

  // ---- Shared values stored as arrays so useSharedValue is only ever called at the top
  // level of the component — never inside a function or loop (Rules of Hooks).
  const clipWidthsSv = useSharedValue<number[]>(
    timeline.map(item => Math.max(52, Math.max(0, item.out - item.in) * PX_PER_SEC)),
  );
  const clipTranslatesSv = useSharedValue<number[]>(timeline.map(() => 0));
  const dragActive = useSharedValue(-1);
  const dragStartX = useSharedValue(0);
  const dragCurrentX = useSharedValue(0);

  // Precomputed clip layout + a scrubbing flag, read by the UI-thread scroll driver worklet.
  const layoutSv = useSharedValue<ClipLayout[]>([]);
  const scrubbingSv = useSharedValue(false);

  // Sync widths when timeline or zoom changes.
  useEffect(() => {
    clipWidthsSv.value = timeline.map(item => {
      const len = Math.max(0, item.out - item.in);
      return Math.max(52, len * pxPerSec);
    });
  }, [timeline, pxPerSec]);

  // Keep the translates array length in sync with the timeline.
  useEffect(() => {
    if (clipTranslatesSv.value.length !== timeline.length) {
      clipTranslatesSv.value = timeline.map(() => 0);
    }
  }, [timeline.length]);

  // compute total duration
  const totalDuration = useMemo(() => {
    return timeline.reduce((sum, t) => sum + Math.max(0, t.out - t.in), 0);
  }, [timeline]);

  // ruler ticks
  const rulerTicks = useMemo(() => {
    const ticks: number[] = [];
    const interval = zoom < 1 ? 10 : zoom < 2 ? 5 : 1;
    for (let s = 0; s <= Math.ceil(totalDuration); s += interval) {
      ticks.push(s);
    }
    return ticks;
  }, [totalDuration, zoom]);

  // Scroll-center pixel → timeline seconds. Inverse of the scroll driver's mapping, using the SAME
  // cumulative layout (offsetPx already includes every preceding clip's width + gaps). The old
  // version forgot the preceding widths, so any scroll ran off the end and returned total duration —
  // which made scrubbing jump straight to the last clip.
  const timeAtPixel = useCallback((px: number) => {
    const layout = layoutSv.value;
    if (layout.length === 0) return 0;
    for (let i = 0; i < layout.length; i++) {
      const e = layout[i];
      if (px < e.offsetPx + e.widthPx || i === layout.length - 1) {
        const within = Math.min(1, Math.max(0, (px - e.offsetPx) / e.widthPx));
        return e.startSec + within * e.durSec;
      }
    }
    return 0;
  }, [layoutSv]);

  // Precompute each clip's start-time + pixel offset so the scroll worklet can map seconds → pixels
  // without walking React state. Rebuilt only when the timeline, zoom, or width actually change.
  useEffect(() => {
    let offsetPx = padStart;
    let startSec = 0;
    layoutSv.value = timeline.map((item) => {
      const durSec = Math.max(0, item.out - item.in);
      const widthPx = Math.max(52, durSec * pxPerSec);
      const entry: ClipLayout = { startSec, durSec, offsetPx, widthPx };
      startSec += durSec;
      offsetPx += widthPx + GAP;
      return entry;
    });
  }, [timeline, pxPerSec, padStart]);

  // UI-thread playhead driver: maps the (interpolated) playback second → a scroll offset and drives
  // the ScrollView every frame via Reanimated's scrollTo worklet. Because playbackSv glides between
  // the native player's 100ms samples, the strip scrolls smoothly at 60fps and stays synced to the
  // video — no JS round-trips, no fighting animated scrollTo calls. Yields while the user scrubs.
  useDerivedValue(() => {
    const layout = layoutSv.value;
    if (scrubbingSv.value || layout.length === 0) return;
    const sec = playbackSv.value;
    let px = padStart;
    for (let i = 0; i < layout.length; i++) {
      const e = layout[i];
      if (sec <= e.startSec + e.durSec || i === layout.length - 1) {
        const within = e.durSec > 0 ? (sec - e.startSec) / e.durSec : 0;
        const clamped = within < 0 ? 0 : within > 1 ? 1 : within;
        px = e.offsetPx + clamped * e.widthPx;
        break;
      }
    }
    scrollTo(scrollRef, Math.max(0, px - stripWidth / 2), 0, false);
  });

  const handleScroll = useCallback((e: any) => {
    if (!userScrubbingRef.current) return;
    const centerPx = e.nativeEvent.contentOffset.x + stripWidth / 2;
    onScrub(timeAtPixel(centerPx));
  }, [stripWidth, timeAtPixel, onScrub]);

  // Scrubbing = the user owns the scroll; the UI-thread driver must fully yield until the strip
  // settles (finger up AND momentum finished), otherwise it snaps back to the playback position.
  const beginScrub = useCallback(() => {
    if (scrubEndTimer.current) { clearTimeout(scrubEndTimer.current); scrubEndTimer.current = null; }
    userScrubbingRef.current = true;
    scrubbingSv.value = true;
    onScrubStart?.();
  }, [onScrubStart, scrubbingSv]);

  const endScrub = useCallback(() => {
    userScrubbingRef.current = false;
    scrubbingSv.value = false;
  }, [scrubbingSv]);

  const onEndDrag = useCallback(() => {
    // finger lifted — end scrubbing unless momentum takes over within a moment
    if (scrubEndTimer.current) clearTimeout(scrubEndTimer.current);
    scrubEndTimer.current = setTimeout(endScrub, 80);
  }, [endScrub]);

  const onMomentumBegin = useCallback(() => {
    if (scrubEndTimer.current) { clearTimeout(scrubEndTimer.current); scrubEndTimer.current = null; }
  }, []);

  useEffect(() => () => {
    if (scrubEndTimer.current) clearTimeout(scrubEndTimer.current);
  }, []);

  // Pinch zoom
  const pinchGesture = Gesture.Pinch()
    .onStart(() => { zoomStartRef.current = zoom; })
    .onUpdate((e) => {
      const newZoom = zoomStartRef.current * e.scale;
      runOnJS(setZoom)(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newZoom)));
    });

  // ---- DRAG REORDER LOGIC ----
  const startDrag = useCallback((index: number) => {
    dragActive.value = index;
    dragStartX.value = clipTranslatesSv.value[index] ?? 0;
  }, [clipTranslatesSv]);

  const updateDrag = useCallback((translationX: number) => {
    const idx = dragActive.value;
    if (idx < 0) return;
    dragCurrentX.value = translationX;
    const newX = dragStartX.value + translationX;

    const widths = clipWidthsSv.value;
    const draggedWidth = widths[idx] ?? 0;
    const draggedCenter = newX + draggedWidth / 2;

    let targetIdx = idx;
    let minDist = Infinity;
    for (let i = 0; i < timeline.length; i++) {
      const w = widths[i] ?? 0;
      const currentTranslate = clipTranslatesSv.value[i] ?? 0;
      const center = i === idx ? draggedCenter : currentTranslate + w / 2;
      const dist = Math.abs(center - draggedCenter);
      if (dist < minDist && i !== idx) {
        minDist = dist;
        targetIdx = i;
      }
    }

    const newTranslates = [...clipTranslatesSv.value];
    newTranslates[idx] = newX;
    for (let i = 0; i < timeline.length; i++) {
      if (i === idx) continue;
      if (i < targetIdx && i >= idx) newTranslates[i] = -draggedWidth - GAP;
      else if (i > targetIdx && i <= idx) newTranslates[i] = draggedWidth + GAP;
      else newTranslates[i] = 0;
    }
    clipTranslatesSv.value = newTranslates;
  }, [timeline, clipWidthsSv, clipTranslatesSv]);

  const endDrag = useCallback(() => {
    const idx = dragActive.value;
    if (idx < 0) return;
    const widths = clipWidthsSv.value;
    const currentX = clipTranslatesSv.value[idx] ?? 0;
    const draggedWidth = widths[idx] ?? 0;
    const draggedCenter = currentX + draggedWidth / 2;

    let targetIdx = idx;
    let minDist = Infinity;
    for (let i = 0; i < timeline.length; i++) {
      const w = widths[i] ?? 0;
      const currentTranslate = clipTranslatesSv.value[i] ?? 0;
      const center = i === idx ? draggedCenter : currentTranslate + w / 2;
      const dist = Math.abs(center - draggedCenter);
      if (dist < minDist && i !== idx) {
        minDist = dist;
        targetIdx = i;
      }
    }

    clipTranslatesSv.value = timeline.map(() => 0);
    dragActive.value = -1;
    if (targetIdx !== idx) {
      hapticMedium();
      onReorder(idx, targetIdx);
    }
  }, [onReorder, timeline, clipWidthsSv, clipTranslatesSv]);

  // ---- TRIM LOGIC ----
  const trimLeft = useCallback((index: number, translationX: number) => {
    const item = timeline[index];
    const deltaSec = translationX / pxPerSec;
    const newIn = Math.max(0, Math.min(item.out - MIN_LEN_SEC, item.in + deltaSec));
    const newWidth = Math.max(52, (item.out - newIn) * pxPerSec);
    const newWidths = [...clipWidthsSv.value];
    newWidths[index] = newWidth;
    clipWidthsSv.value = newWidths;
    onTrim(index, newIn, item.out);
  }, [timeline, pxPerSec, onTrim, clipWidthsSv]);

  const trimRight = useCallback((index: number, translationX: number) => {
    const item = timeline[index];
    // A photo is a still with no source footage — let it stretch up to MAX_PHOTO_SEC. Videos are
    // capped at their actual source duration.
    const sourceDur = item.kind === 'photo' ? MAX_PHOTO_SEC : (durationByClipId.get(item.clipId) ?? item.out);
    const deltaSec = translationX / pxPerSec;
    const newOut = Math.min(sourceDur, Math.max(item.in + MIN_LEN_SEC, item.out + deltaSec));
    const newWidth = Math.max(52, (newOut - item.in) * pxPerSec);
    const newWidths = [...clipWidthsSv.value];
    newWidths[index] = newWidth;
    clipWidthsSv.value = newWidths;
    onTrim(index, item.in, newOut);
  }, [timeline, durationByClipId, pxPerSec, onTrim, clipWidthsSv]);

  return (
    <View
      style={styles.container}
      onLayout={(e) => setStripWidth(e.nativeEvent.layout.width)}
    >
      <GestureDetector gesture={pinchGesture}>
        <View style={styles.stripArea}>
          {/* Ruler */}
          <View style={styles.ruler}>
            {rulerTicks.map((s) => (
              <View key={`t-${s}`} style={[styles.tick, { left: s * pxPerSec }]} pointerEvents="none">
                <View style={s % 10 === 0 ? styles.tickMajor : styles.tickMinor} />
                {s % 10 === 0 && (
                  <Text style={styles.tickText}>
                    {s >= 60 ? `${Math.floor(s / 60)}m` : `${s}s`}
                  </Text>
                )}
              </View>
            ))}
          </View>

          <AnimatedScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            onScrollBeginDrag={beginScrub}
            onScrollEndDrag={onEndDrag}
            onMomentumScrollBegin={onMomentumBegin}
            onMomentumScrollEnd={endScrub}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            contentContainerStyle={styles.scrollInner}
          >
            <View style={{ width: padStart }} />
            <View style={styles.clipsRow}>
              {timeline.map((item, i) => {
                const isSelected = i === selectedIndex;
                const thumbUri = thumbs[item.clipId];

                // Drag gesture
                const dragGesture = Gesture.Pan()
                  .activateAfterLongPress(LONG_PRESS_MS)
                  .onStart(() => {
                    runOnJS(startDrag)(i);
                    runOnJS(hapticMedium)();
                  })
                  .onUpdate((e) => {
                    runOnJS(updateDrag)(e.translationX);
                  })
                  .onEnd(() => {
                    runOnJS(endDrag)();
                  });

                // Trim gestures
                const trimLeftGesture = Gesture.Pan()
                  .enabled(handlesEnabled && isSelected)
                  .onStart(() => runOnJS(hapticLight)())
                  .onUpdate((e) => runOnJS(trimLeft)(i, e.translationX))
                  .onEnd(() => runOnJS(hapticLight)());

                const trimRightGesture = Gesture.Pan()
                  .enabled(handlesEnabled && isSelected)
                  .onStart(() => runOnJS(hapticLight)())
                  .onUpdate((e) => runOnJS(trimRight)(i, e.translationX))
                  .onEnd(() => runOnJS(hapticLight)());

                const durationSec = Math.max(0, item.out - item.in);
                const formattedDuration = durationSec >= 60
                  ? `${Math.floor(durationSec / 60)}:${String(Math.floor(durationSec % 60)).padStart(2, '0')}`
                  : `${durationSec.toFixed(1)}s`;

                // Filmstrip: fixed-width tiles of the same thumbnail, so widening the clip reveals
                // more tiles instead of zooming one stretched image. Count from the settled width.
                const clipW = Math.max(52, durationSec * pxPerSec);
                const tileCount = Math.max(1, Math.ceil(clipW / THUMB_TILE_W));

                return (
                  <View key={`${item.clipId}-${i}`} style={styles.clipWrapper}>
                    {/* Trim handles */}
                    {isSelected && handlesEnabled && (
                      <>
                        <GestureDetector gesture={trimLeftGesture}>
                          <Animated.View style={[styles.trimHandle, styles.trimHandleLeft]}>
                            <View style={styles.trimHandleInner}>
                              <ChevronLeft size={12} color="#000" strokeWidth={3} />
                            </View>
                          </Animated.View>
                        </GestureDetector>
                        <GestureDetector gesture={trimRightGesture}>
                          <Animated.View style={[styles.trimHandle, styles.trimHandleRight]}>
                            <View style={styles.trimHandleInner}>
                              <ChevronRight size={12} color="#000" strokeWidth={3} />
                            </View>
                          </Animated.View>
                        </GestureDetector>
                      </>
                    )}

                    <GestureDetector gesture={dragGesture}>
                      {/* AnimatedClip is a sub-component so useAnimatedStyle runs at the top
                          level of that component — not inside this .map() loop. */}
                      <AnimatedClip
                        index={i}
                        isSelected={isSelected}
                        widthsSv={clipWidthsSv}
                        translatesSv={clipTranslatesSv}
                        dragActiveSv={dragActive}
                      >
                        <Pressable
                          onPress={() => {
                            hapticLight();
                            onSelect(i);
                          }}
                          style={[styles.clipInner, isSelected && styles.clipInnerSelected]}
                        >
                          {thumbUri ? (
                            <View style={styles.filmstrip} pointerEvents="none">
                              {Array.from({ length: tileCount }).map((_, k) => (
                                <Image key={k} source={{ uri: thumbUri }} style={styles.filmTile} />
                              ))}
                            </View>
                          ) : (
                            <View style={styles.clipPlaceholder} />
                          )}

                          {/* Bottom duration */}
                          <View style={styles.bottomBar}>
                            <Text style={styles.durationLabel} numberOfLines={1}>
                              {formattedDuration}
                            </Text>
                          </View>

                          {/* Mute/delete controls */}
                          <View style={styles.topRow}>
                            {item.muted && (
                              <Pressable hitSlop={6} onPress={() => onToggleMute(i)} style={styles.topBadge}>
                                <VolumeX size={10} color="#FF9F0A" strokeWidth={2.5} />
                              </Pressable>
                            )}
                            {isSelected && handlesEnabled && (
                              <Pressable
                                hitSlop={6}
                                onPress={() => {
                                  hapticMedium();
                                  onDelete(i);
                                }}
                                style={[styles.topBadge, styles.deleteBadge]}
                              >
                                <Trash2 size={10} color="#FFF" strokeWidth={2.5} />
                              </Pressable>
                            )}
                          </View>
                        </Pressable>
                      </AnimatedClip>
                    </GestureDetector>
                  </View>
                );
              })}

              <Pressable style={styles.addBtn} onPress={onAddMedia}>
                <Plus size={20} color="#8E8E93" strokeWidth={2} />
              </Pressable>
            </View>
            <View style={{ width: padStart }} />
          </AnimatedScrollView>

          {/* Playhead */}
          <View style={styles.playhead} pointerEvents="none">
            <View style={styles.playheadLine} />
            <View style={styles.playheadDot} />
          </View>
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0A0A0B',
    paddingVertical: 8,
  },
  stripArea: {
    height: RULER_H + STRIP_HEIGHT + 12,
    position: 'relative',
  },
  ruler: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: RULER_H,
    zIndex: 2,
  },
  tick: {
    position: 'absolute',
    top: 0,
    alignItems: 'center',
  },
  tickMajor: { width: 1, height: 10, backgroundColor: '#636366' },
  tickMinor: { width: 1, height: 5, backgroundColor: '#3A3A3C' },
  tickText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#8E8E93',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  scrollInner: {
    paddingTop: RULER_H + 4,
  },
  clipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GAP,
  },
  clipWrapper: {
    position: 'relative',
    height: STRIP_HEIGHT,
  },
  clipBlock: {
    height: STRIP_HEIGHT,
    borderRadius: 6,
    overflow: 'visible',
  },
  clipInner: {
    flex: 1,
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#2C2C2E',
  },
  clipInnerSelected: {
    borderWidth: 3,
    borderColor: '#FFCC00',
    borderRadius: 8,
  },
  filmstrip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'hidden',
  },
  filmTile: {
    width: THUMB_TILE_W,
    height: '100%',
    resizeMode: 'cover',
  },
  clipPlaceholder: {
    flex: 1,
    backgroundColor: '#1C1C1E',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 18,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  durationLabel: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  topRow: {
    position: 'absolute',
    top: 3,
    right: 3,
    flexDirection: 'row',
    gap: 3,
  },
  topBadge: {
    width: 18,
    height: 18,
    borderRadius: 5,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBadge: {
    backgroundColor: 'rgba(255, 59, 48, 0.85)',
  },
  trimHandle: {
    position: 'absolute',
    top: STRIP_HEIGHT / 2 - 14,
    width: 28,
    height: 28,
    zIndex: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trimHandleLeft: {
    left: -14,
  },
  trimHandleRight: {
    right: -14,
  },
  trimHandleInner: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFCC00',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
    elevation: 5,
  },
  addBtn: {
    width: ADD_BTN_W,
    height: STRIP_HEIGHT,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#2C2C2E',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  playhead: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '50%',
    marginLeft: -1,
    width: 2,
    zIndex: 100,
    pointerEvents: 'none',
  },
  playheadLine: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  playheadDot: {
    position: 'absolute',
    top: 0,
    left: -4,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
  },
});
