import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Image, Pressable, StyleSheet, Text, View, Dimensions } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useAnimatedRef,
  useDerivedValue,
  useSharedValue,
  SharedValue,
  scrollTo,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import { Plus, Trash2, VolumeX, ChevronLeft, ChevronRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Edl, TimelineItem } from '../core';

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
const MIN_CLIP_W = 52;
const LONG_PRESS_MS = 180;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.5;
const RULER_H = 22;
const ADD_BTN_W = 52;

const SHIFT_SPRING = { damping: 22, stiffness: 240, mass: 0.6 };

export interface ClipStripProps {
  timeline: Edl['timeline'];
  selectedIndex: number;
  thumbs: Record<string, string>;
  durationByClipId: Map<string, number>;
  handlesEnabled: boolean;
  onSelect: (index: number) => void;
  onToggleMute: (index: number) => void;
  onDelete: (index: number) => void;
  /**
   * A trim drag COMMITTED (fired once, on release — never per frame). During the drag the strip
   * animates entirely on the UI thread; React state is untouched until this fires.
   */
  onTrim: (index: number, newIn: number, newOut: number) => void;
  onReorder: (from: number, to: number) => void;
  onAddMedia: () => void;
  /** Current playback position (seconds) as a shared value — drives the strip on the UI thread. */
  playbackSv: SharedValue<number>;
  onScrub: (sec: number) => void;
  onScrubStart?: () => void;
}

// ─── One clip row ─────────────────────────────────────────────────────────────
// Owns its width shared value and its gestures, so gesture-frame work never touches React and a
// re-render of the strip doesn't recreate every clip's gesture objects (the row is memoized).
interface ClipItemProps {
  item: TimelineItem;
  index: number;
  isSelected: boolean;
  handlesEnabled: boolean;
  pxPerSec: number;
  /** source clip length (already MAX_PHOTO_SEC for photos) */
  maxOutSec: number;
  thumbUri: string | undefined;
  /** committed widths/offsets of every clip (plain arrays — captured by worklets) */
  widthsPx: number[];
  offsetsPx: number[];
  dragActiveSv: SharedValue<number>;
  dragXSv: SharedValue<number>;
  dragTargetSv: SharedValue<number>;
  onSelect: (index: number) => void;
  onToggleMute: (index: number) => void;
  onDelete: (index: number) => void;
  onTrimCommit: (index: number, newIn: number, newOut: number) => void;
  onReorder: (from: number, to: number) => void;
}

const ClipItem = React.memo(function ClipItem({
  item,
  index,
  isSelected,
  handlesEnabled,
  pxPerSec,
  maxOutSec,
  thumbUri,
  widthsPx,
  offsetsPx,
  dragActiveSv,
  dragXSv,
  dragTargetSv,
  onSelect,
  onToggleMute,
  onDelete,
  onTrimCommit,
  onReorder,
}: ClipItemProps) {
  // Committed in/out — plain numbers captured by the trim worklets. Safe because nothing
  // re-renders mid-drag (commits happen only on release), so these can't change under a gesture.
  const baseIn = item.in;
  const baseOut = item.out;

  const widthSv = useSharedValue(Math.max(MIN_CLIP_W, (baseOut - baseIn) * pxPerSec));
  // Extending from the LEFT handle grows width the same way extending from the right does — but
  // a flex row only ever extends a box's RIGHT edge when its width grows. Without compensation,
  // left-handle drags visually grow the block into the NEXT clip while the left edge (and the
  // handle itself) never appears to move — "front stays frozen, back seems to change." This shift
  // moves the whole item left by exactly the width gained, so the RIGHT edge stays anchored and
  // the LEFT edge is the one that visually extends, matching the handle you're actually dragging.
  const leftShiftSv = useSharedValue(0);
  // Sync width + shift when the committed trim or zoom changes (covers undo/redo too) — kept in
  // the same effect so they animate back to their settled state in lockstep, no visual jump.
  useEffect(() => {
    widthSv.value = withTiming(Math.max(MIN_CLIP_W, (baseOut - baseIn) * pxPerSec), { duration: 160 });
    leftShiftSv.value = withTiming(0, { duration: 160 });
  }, [baseIn, baseOut, pxPerSec, widthSv, leftShiftSv]);

  // Live trim values, written by the UI-thread worklets and read once on release for the commit.
  const trimInSv = useSharedValue(baseIn);
  const trimOutSv = useSharedValue(baseOut);

  const commitLeft = useCallback((newIn: number) => {
    hapticLight();
    if (Math.abs(newIn - baseIn) > 1e-4) onTrimCommit(index, newIn, baseOut);
  }, [index, baseIn, baseOut, onTrimCommit]);

  const commitRight = useCallback((newOut: number) => {
    hapticLight();
    if (Math.abs(newOut - baseOut) > 1e-4) onTrimCommit(index, baseIn, newOut);
  }, [index, baseIn, baseOut, onTrimCommit]);

  // Trim gestures: width follows the finger ON THE UI THREAD; JS is involved exactly once (commit).
  const trimLeftGesture = Gesture.Pan()
    .enabled(handlesEnabled && isSelected)
    .onStart(() => {
      trimInSv.value = baseIn;
      leftShiftSv.value = 0;
      runOnJS(hapticLight)();
    })
    .onUpdate((e) => {
      const newIn = Math.max(0, Math.min(baseOut - MIN_LEN_SEC, baseIn + e.translationX / pxPerSec));
      trimInSv.value = newIn;
      widthSv.value = Math.max(MIN_CLIP_W, (baseOut - newIn) * pxPerSec);
      // Negative when extending backward (newIn < baseIn) — shifts the item left so the RIGHT
      // edge stays anchored while the LEFT edge is the one that visibly extends.
      leftShiftSv.value = (newIn - baseIn) * pxPerSec;
    })
    .onEnd(() => {
      runOnJS(commitLeft)(trimInSv.value);
    });

  const trimRightGesture = Gesture.Pan()
    .enabled(handlesEnabled && isSelected)
    .onStart(() => {
      trimOutSv.value = baseOut;
      runOnJS(hapticLight)();
    })
    .onUpdate((e) => {
      const newOut = Math.min(maxOutSec, Math.max(baseIn + MIN_LEN_SEC, baseOut + e.translationX / pxPerSec));
      trimOutSv.value = newOut;
      widthSv.value = Math.max(MIN_CLIP_W, (newOut - baseIn) * pxPerSec);
    })
    .onEnd(() => {
      runOnJS(commitRight)(trimOutSv.value);
    });

  // Long-press drag reorder: the dragged clip follows the finger raw; the target slot is computed
  // in the same worklet from the committed layout. Other clips spring aside via their own
  // animated styles reacting to dragActive/dragTarget.
  const dragGesture = Gesture.Pan()
    .activateAfterLongPress(LONG_PRESS_MS)
    .onStart(() => {
      dragActiveSv.value = index;
      dragTargetSv.value = index;
      dragXSv.value = 0;
      runOnJS(hapticMedium)();
    })
    .onUpdate((e) => {
      dragXSv.value = e.translationX;
      const center = offsetsPx[index] + e.translationX + widthsPx[index] / 2;
      let target = widthsPx.length - 1;
      let acc = 0;
      for (let i = 0; i < widthsPx.length; i++) {
        const cellEnd = acc + widthsPx[i] + GAP;
        if (center < cellEnd) {
          target = i;
          break;
        }
        acc = cellEnd;
      }
      dragTargetSv.value = target;
    })
    .onEnd(() => {
      const from = dragActiveSv.value;
      const to = dragTargetSv.value;
      dragActiveSv.value = -1;
      dragXSv.value = 0;
      if (from >= 0 && to !== from) {
        runOnJS(hapticMedium)();
        runOnJS(onReorder)(from, to);
      }
    });

  // Applied to the WRAPPER (handles + block together), so both move in lockstep: reorder-shift
  // (clips gliding aside) and the left-trim compensation above both live here, never on the block
  // alone — otherwise the handles (siblings of the block, not children of it) wouldn't track it.
  const wrapperAnimStyle = useAnimatedStyle(() => {
    const from = dragActiveSv.value;
    const isDragged = from === index;
    let translateX;
    if (isDragged) {
      translateX = dragXSv.value; // raw finger-follow, no spring lag
    } else if (from >= 0) {
      const to = dragTargetSv.value;
      const dw = widthsPx[from] + GAP;
      let shift = 0;
      if (from < to && index > from && index <= to) shift = -dw;
      else if (from > to && index >= to && index < from) shift = dw;
      translateX = withSpring(shift, SHIFT_SPRING); // clips glide aside to make room
    } else {
      translateX = withSpring(0, SHIFT_SPRING);
    }
    return {
      transform: [{ translateX: translateX + leftShiftSv.value }],
      zIndex: isDragged ? 100 : isSelected ? 50 : 1,
    };
  });

  // Block only ever needs its width animated — position comes entirely from the wrapper above.
  const blockAnimStyle = useAnimatedStyle(() => ({ width: widthSv.value }));

  // The right handle must track the live width directly rather than relying on CSS `right`
  // positioning against a box whose width is being mutated by Reanimated on the UI thread — that
  // dependency is exactly the kind of thing that produced the left-handle bug this fixes.
  const rightHandleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: widthSv.value - 14 }],
  }));

  // Filmstrip tiles from the COMMITTED duration (tile count updating mid-drag would re-render;
  // the width visual still follows the finger via widthSv).
  const durationSec = Math.max(0, baseOut - baseIn);
  const clipW = Math.max(MIN_CLIP_W, durationSec * pxPerSec);
  const tileCount = Math.max(1, Math.ceil(clipW / THUMB_TILE_W));
  const formattedDuration = durationSec >= 60
    ? `${Math.floor(durationSec / 60)}:${String(Math.floor(durationSec % 60)).padStart(2, '0')}`
    : `${durationSec.toFixed(1)}s`;

  return (
    <Animated.View style={[styles.clipWrapper, wrapperAnimStyle]}>
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
            <Animated.View style={[styles.trimHandle, styles.trimHandleRightBase, rightHandleStyle]}>
              <View style={styles.trimHandleInner}>
                <ChevronRight size={12} color="#000" strokeWidth={3} />
              </View>
            </Animated.View>
          </GestureDetector>
        </>
      )}

      <GestureDetector gesture={dragGesture}>
        <Animated.View style={[styles.clipBlock, blockAnimStyle]}>
          <Pressable
            onPress={() => {
              hapticLight();
              onSelect(index);
            }}
            style={[styles.clipInner, isSelected && styles.clipInnerSelected]}
          >
            {thumbUri ? (
              <View style={styles.filmstrip} pointerEvents="none">
                {Array.from({ length: tileCount }).map((_, k) => (
                  <Image key={k} source={{ uri: thumbUri }} style={styles.filmTile} fadeDuration={0} />
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
                <Pressable hitSlop={6} onPress={() => onToggleMute(index)} style={styles.topBadge}>
                  <VolumeX size={10} color="#FF9F0A" strokeWidth={2.5} />
                </Pressable>
              )}
              {isSelected && handlesEnabled && (
                <Pressable
                  hitSlop={6}
                  onPress={() => {
                    hapticMedium();
                    onDelete(index);
                  }}
                  style={[styles.topBadge, styles.deleteBadge]}
                >
                  <Trash2 size={10} color="#FFF" strokeWidth={2.5} />
                </Pressable>
              )}
            </View>
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
});

// ─── The strip ────────────────────────────────────────────────────────────────
function ClipStrip({
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
  const lastZoomTsRef = useRef(0);
  const userScrubbingRef = useRef(false);
  const scrubEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pxPerSec = PX_PER_SEC * zoom;
  const padStart = stripWidth / 2;

  // Cross-clip drag coordination (read by every ClipItem's animated style).
  const dragActiveSv = useSharedValue(-1);
  const dragXSv = useSharedValue(0);
  const dragTargetSv = useSharedValue(-1);

  // Committed layout as plain arrays — captured by the drag worklets and cheap to recompute.
  const widthsPx = useMemo(
    () => timeline.map((t) => Math.max(MIN_CLIP_W, Math.max(0, t.out - t.in) * pxPerSec)),
    [timeline, pxPerSec],
  );
  const offsetsPx = useMemo(() => {
    let acc = 0;
    return widthsPx.map((w) => {
      const o = acc;
      acc += w + GAP;
      return o;
    });
  }, [widthsPx]);

  // Precomputed layout + scrubbing flag for the UI-thread scroll driver worklet.
  const layoutSv = useSharedValue<ClipLayout[]>([]);
  const scrubbingSv = useSharedValue(false);

  useEffect(() => {
    let offsetPx = padStart;
    let startSec = 0;
    layoutSv.value = timeline.map((item, i) => {
      const durSec = Math.max(0, item.out - item.in);
      const widthPx = widthsPx[i];
      const entry: ClipLayout = { startSec, durSec, offsetPx, widthPx };
      startSec += durSec;
      offsetPx += widthPx + GAP;
      return entry;
    });
  }, [timeline, widthsPx, padStart, layoutSv]);

  const totalDuration = useMemo(
    () => timeline.reduce((sum, t) => sum + Math.max(0, t.out - t.in), 0),
    [timeline],
  );

  const rulerTicks = useMemo(() => {
    const ticks: number[] = [];
    const interval = zoom < 1 ? 10 : zoom < 2 ? 5 : 1;
    for (let s = 0; s <= Math.ceil(totalDuration); s += interval) ticks.push(s);
    return ticks;
  }, [totalDuration, zoom]);

  // Scroll-center pixel → timeline seconds (inverse of the scroll driver's mapping).
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

  // UI-thread playhead driver: playback second → scroll offset, every frame, no JS round-trips.
  useDerivedValue(() => {
    const layout = layoutSv.value;
    if (scrubbingSv.value || dragActiveSv.value >= 0 || layout.length === 0) return;
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

  // Scrubbing = the user owns the scroll until the strip settles (finger up AND momentum done).
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
    if (scrubEndTimer.current) clearTimeout(scrubEndTimer.current);
    scrubEndTimer.current = setTimeout(endScrub, 80);
  }, [endScrub]);

  const onMomentumBegin = useCallback(() => {
    if (scrubEndTimer.current) { clearTimeout(scrubEndTimer.current); scrubEndTimer.current = null; }
  }, []);

  useEffect(() => () => {
    if (scrubEndTimer.current) clearTimeout(scrubEndTimer.current);
  }, []);

  // Pinch zoom — runs on JS (it re-layouts React anyway) but throttled to ~30fps so a 120Hz
  // pinch doesn't trigger 120 re-layouts a second.
  const pinchGesture = Gesture.Pinch()
    .runOnJS(true)
    .onStart(() => {
      zoomStartRef.current = zoom;
    })
    .onUpdate((e) => {
      const now = Date.now();
      if (now - lastZoomTsRef.current < 32) return;
      lastZoomTsRef.current = now;
      const newZoom = zoomStartRef.current * e.scale;
      setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newZoom)));
    });

  return (
    <View
      style={styles.container}
      onLayout={(e) => setStripWidth(e.nativeEvent.layout.width)}
    >
      <GestureDetector gesture={pinchGesture}>
        <View style={styles.stripArea}>
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
            {/* Ruler — INSIDE the scroll content so ticks track the clips (offset by padStart). */}
            <View
              style={[styles.ruler, { left: padStart, width: totalDuration * pxPerSec + 60 }]}
              pointerEvents="none"
            >
              {rulerTicks.map((s) => (
                <View key={`t-${s}`} style={[styles.tick, { left: s * pxPerSec }]}>
                  <View style={s % 10 === 0 ? styles.tickMajor : styles.tickMinor} />
                  {s % 10 === 0 && (
                    <Text style={styles.tickText}>
                      {s >= 60 ? `${Math.floor(s / 60)}m` : `${s}s`}
                    </Text>
                  )}
                </View>
              ))}
            </View>

            <View style={{ width: padStart }} />
            <View style={styles.clipsRow}>
              {timeline.map((item, i) => (
                <ClipItem
                  key={`${item.clipId}-${i}`}
                  item={item}
                  index={i}
                  isSelected={i === selectedIndex}
                  handlesEnabled={handlesEnabled}
                  pxPerSec={pxPerSec}
                  maxOutSec={
                    item.kind === 'photo'
                      ? MAX_PHOTO_SEC
                      : durationByClipId.get(item.clipId) ?? item.out
                  }
                  thumbUri={thumbs[item.clipId]}
                  widthsPx={widthsPx}
                  offsetsPx={offsetsPx}
                  dragActiveSv={dragActiveSv}
                  dragXSv={dragXSv}
                  dragTargetSv={dragTargetSv}
                  onSelect={onSelect}
                  onToggleMute={onToggleMute}
                  onDelete={onDelete}
                  onTrimCommit={onTrim}
                  onReorder={onReorder}
                />
              ))}

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

// Memoized so EditorScreen re-renders (timecode/selection ticks) don't rebuild the whole strip.
export default React.memo(ClipStrip);

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
  // Positioned via the animated rightHandleStyle (translateX = widthSv - 14), not CSS `right` —
  // see the comment on rightHandleStyle for why.
  trimHandleRightBase: {
    left: 0,
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
