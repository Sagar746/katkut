import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Image, Pressable, StyleSheet, Text, View, Dimensions } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import { Plus, Trash2, Volume2, VolumeX, ChevronLeft, ChevronRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Edl } from '../core';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

function hapticLight() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

function hapticMedium() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export const PX_PER_SEC = 35;
export const STRIP_HEIGHT = 72;
const MIN_LEN_SEC = 0.3;
const GAP = 2;
const LONG_PRESS_MS = 180;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.5;
const RULER_H = 22;
const ADD_BTN_W = 52;
const HANDLE_HIT_WIDTH = 28;
const HANDLE_VISUAL_WIDTH = 6;
const EXPAND_SCALE = 1.0;
const SELECTED_BORDER = 3;

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

function ClipBlock({
  item,
  index,
  isSelected,
  thumbUri,
  clipWidth,
  durationSec,
  sourceDuration,
  pxPerSec,
  handlesEnabled,
  onSelect,
  onToggleMute,
  onDelete,
  onTrim,
  onReorder,
  timelineLength,
}: {
  item: Edl['timeline'][0];
  index: number;
  isSelected: boolean;
  thumbUri?: string;
  clipWidth: number;
  durationSec: number;
  sourceDuration: number;
  pxPerSec: number;
  handlesEnabled: boolean;
  onSelect: (index: number) => void;
  onToggleMute: (index: number) => void;
  onDelete: (index: number) => void;
  onTrim: (index: number, newIn: number, newOut: number) => void;
  onReorder: (from: number, to: number) => void;
  timelineLength: number;
}) {
  const translateX = useSharedValue(0);
  const scale = useSharedValue(1);
  const isDragging = useSharedValue(false);
  const startX = useSharedValue(0);
  
  const trimLeftPx = useSharedValue(0);
  const trimRightPx = useSharedValue(0);
  const baseIn = useSharedValue(item.in);
  const baseOut = useSharedValue(item.out);

  useEffect(() => {
    baseIn.value = item.in;
    baseOut.value = item.out;
    trimLeftPx.value = withSpring(0, { damping: 20, stiffness: 200 });
    trimRightPx.value = withSpring(0, { damping: 20, stiffness: 200 });
  }, [item.in, item.out]);

  const blockStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { scale: scale.value },
    ],
    zIndex: isDragging.value ? 100 : 1,
    opacity: isDragging.value ? 0.92 : 1,
  }));

  const leftHandleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: trimLeftPx.value }],
  }));

  const rightHandleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: trimRightPx.value }],
  }));

  // Drag to reorder
  const dragGesture = Gesture.Pan()
    .activateAfterLongPress(LONG_PRESS_MS)
    .onStart(() => {
      isDragging.value = true;
      scale.value = withSpring(1.06, { damping: 15 });
      startX.value = translateX.value;
      runOnJS(hapticMedium)();
    })
    .onUpdate((e) => {
      translateX.value = startX.value + e.translationX;
    })
    .onEnd((e) => {
      const totalClipW = clipWidth + GAP;
      const slots = Math.round(e.translationX / totalClipW);
      const newIndex = Math.max(0, Math.min(timelineLength - 1, index + slots));
      
      isDragging.value = false;
      scale.value = withSpring(1, { damping: 15, stiffness: 150 });
      translateX.value = withSpring(0, { damping: 18, stiffness: 160 });
      
      if (newIndex !== index) {
        runOnJS(hapticMedium)();
        runOnJS(onReorder)(index, newIndex);
      }
    });

  // Left trim
  const trimLeftGesture = Gesture.Pan()
    .enabled(handlesEnabled && isSelected)
    .onStart(() => {
      baseIn.value = item.in;
      baseOut.value = item.out;
      runOnJS(hapticLight)();
    })
    .onUpdate((e) => {
      const deltaSec = e.translationX / pxPerSec;
      const newIn = Math.max(0, Math.min(baseOut.value - MIN_LEN_SEC, baseIn.value + deltaSec));
      trimLeftPx.value = (newIn - baseIn.value) * pxPerSec;
      runOnJS(onTrim)(index, newIn, baseOut.value);
    })
    .onEnd(() => {
      trimLeftPx.value = withSpring(0, { damping: 20, stiffness: 200 });
      runOnJS(hapticLight)();
    });

  // Right trim
  const trimRightGesture = Gesture.Pan()
    .enabled(handlesEnabled && isSelected)
    .onStart(() => {
      baseIn.value = item.in;
      baseOut.value = item.out;
      runOnJS(hapticLight)();
    })
    .onUpdate((e) => {
      const deltaSec = e.translationX / pxPerSec;
      const newOut = Math.min(sourceDuration, Math.max(baseIn.value + MIN_LEN_SEC, baseOut.value + deltaSec));
      trimRightPx.value = (newOut - baseOut.value) * pxPerSec;
      runOnJS(onTrim)(index, baseIn.value, newOut);
    })
    .onEnd(() => {
      trimRightPx.value = withSpring(0, { damping: 20, stiffness: 200 });
      runOnJS(hapticLight)();
    });

  const formattedDuration = durationSec >= 60
    ? `${Math.floor(durationSec / 60)}:${String(Math.floor(durationSec % 60)).padStart(2, '0')}`
    : `${durationSec.toFixed(1)}s`;

  return (
    <View style={[styles.clipOuter, { width: clipWidth }]}>
      {/* Trim handles */}
      {isSelected && handlesEnabled && (
        <>
          <GestureDetector gesture={trimLeftGesture}>
            <Animated.View style={[styles.handleHitArea, styles.handleHitLeft, leftHandleStyle]}>
              <View style={styles.handleVisual}>
                <ChevronLeft size={8} color="#000" strokeWidth={3} />
              </View>
            </Animated.View>
          </GestureDetector>
          
          <GestureDetector gesture={trimRightGesture}>
            <Animated.View style={[styles.handleHitArea, styles.handleHitRight, rightHandleStyle]}>
              <View style={styles.handleVisual}>
                <ChevronRight size={8} color="#000" strokeWidth={3} />
              </View>
            </Animated.View>
          </GestureDetector>
        </>
      )}

      {/* Main clip */}
      <GestureDetector gesture={dragGesture}>
        <Animated.View style={[styles.clipBlock, blockStyle]}>
          <Pressable
            onPress={() => {
              hapticLight();
              onSelect(index);
            }}
            style={[styles.clipInner, isSelected && styles.clipInnerSelected]}
          >
            {thumbUri ? (
              <Image source={{ uri: thumbUri }} style={styles.clipThumb} />
            ) : (
              <View style={styles.clipPlaceholder} />
            )}

            {/* Bottom info bar */}
            <View style={styles.bottomBar}>
              <Text style={styles.durationLabel} numberOfLines={1}>
                {formattedDuration}
              </Text>
            </View>

            {/* Mute indicator */}
            {item.muted && (
              <View style={styles.muteIndicator}>
                <VolumeX size={10} color="#FF9F0A" strokeWidth={2.5} />
              </View>
            )}

            {/* Top row: delete + mute */}
            <View style={styles.topRow}>
              {item.muted ? (
                <Pressable
                  hitSlop={6}
                  onPress={() => onToggleMute(index)}
                  style={styles.topBadge}
                >
                  <VolumeX size={10} color="#FF9F0A" strokeWidth={2.5} />
                </Pressable>
              ) : null}
              
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
    </View>
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
  playbackSec,
  onScrub,
  onScrubStart,
}: ClipStripProps) {
  const scrollRef = useRef<ScrollView>(null);
  const [stripWidth, setStripWidth] = useState(SCREEN_WIDTH);
  const [zoom, setZoom] = useState(1);
  const zoomStartRef = useRef(1);
  const userScrubbingRef = useRef(false);

  const pxPerSec = PX_PER_SEC * zoom;
  const padStart = stripWidth / 2;

  const layoutData = useMemo(() => {
    const widths: number[] = [];
    const leftEdges: number[] = [];
    const lens: number[] = [];
    let cursor = padStart;

    timeline.forEach((item) => {
      const lenSec = Math.max(0, item.out - item.in);
      const w = Math.max(52, lenSec * pxPerSec);
      widths.push(w);
      lens.push(lenSec);
      leftEdges.push(cursor);
      cursor += w + GAP;
    });

    const totalDuration = lens.reduce((sum, l) => sum + l, 0);
    return { widths, leftEdges, lens, totalDuration, totalWidth: cursor };
  }, [timeline, pxPerSec, padStart]);

  function timeAtPixel(px: number): number {
    const { widths, leftEdges, lens } = layoutData;
    let elapsed = 0;
    for (let i = 0; i < widths.length; i++) {
      if (px < leftEdges[i] + widths[i] || i === widths.length - 1) {
        const within = Math.min(1, Math.max(0, (px - leftEdges[i]) / widths[i]));
        return elapsed + within * lens[i];
      }
      elapsed += lens[i];
    }
    return elapsed;
  }

  function pixelForTime(t: number): number {
    const { leftEdges, widths, lens } = layoutData;
    let elapsed = 0;
    for (let i = 0; i < lens.length; i++) {
      if (t <= elapsed + lens[i] || i === lens.length - 1) {
        const within = lens[i] > 0 ? Math.min(1, (t - elapsed) / lens[i]) : 0;
        return leftEdges[i] + within * widths[i];
      }
      elapsed += lens[i];
    }
    return padStart;
  }

  useEffect(() => {
    if (userScrubbingRef.current) return;
    const px = pixelForTime(playbackSec);
    scrollRef.current?.scrollTo({ x: Math.max(0, px - stripWidth / 2), animated: true });
  }, [playbackSec]);

  const handleScroll = useCallback((e: any) => {
    if (!userScrubbingRef.current) return;
    const centerPx = e.nativeEvent.contentOffset.x + stripWidth / 2;
    onScrub(timeAtPixel(centerPx));
  }, [stripWidth, layoutData, onScrub]);

  const pinchGesture = Gesture.Pinch()
    .onStart(() => { zoomStartRef.current = zoom; })
    .onUpdate((e) => {
      const newZoom = zoomStartRef.current * e.scale;
      setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newZoom)));
    });

  const rulerTicks = useMemo(() => {
    const ticks: number[] = [];
    const interval = zoom < 1 ? 10 : zoom < 2 ? 5 : 1;
    for (let s = 0; s <= Math.ceil(layoutData.totalDuration); s += interval) {
      ticks.push(s);
    }
    return ticks;
  }, [layoutData.totalDuration, zoom]);

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

          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            onScrollBeginDrag={() => {
              userScrubbingRef.current = true;
              onScrubStart?.();
            }}
            onScrollEndDrag={() => { userScrubbingRef.current = false; }}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            contentContainerStyle={styles.scrollInner}
          >
            <View style={{ width: padStart }} />
            
            <View style={styles.clipsRow}>
              {timeline.map((item, i) => (
                <ClipBlock
                  key={`${item.clipId}-${i}`}
                  item={item}
                  index={i}
                  isSelected={i === selectedIndex}
                  thumbUri={thumbs[item.clipId]}
                  clipWidth={layoutData.widths[i]}
                  durationSec={layoutData.lens[i]}
                  sourceDuration={durationByClipId.get(item.clipId) ?? item.out}
                  pxPerSec={pxPerSec}
                  handlesEnabled={handlesEnabled}
                  onSelect={onSelect}
                  onToggleMute={onToggleMute}
                  onDelete={onDelete}
                  onTrim={onTrim}
                  onReorder={onReorder}
                  timelineLength={timeline.length}
                />
              ))}

              <Pressable style={styles.addBtn} onPress={onAddMedia}>
                <Plus size={20} color="#8E8E93" strokeWidth={2} />
              </Pressable>
            </View>

            <View style={{ width: padStart }} />
          </ScrollView>

          {/* Playhead */}
          <View style={styles.playhead} pointerEvents="none">
            <View style={styles.playheadLine} />
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

  // Ruler
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
    gap: GAP,
    alignItems: 'center',
  },

  // Clip outer wrapper
  clipOuter: {
    height: STRIP_HEIGHT,
    position: 'relative',
  },

  // Clip block
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
    borderWidth: SELECTED_BORDER,
    borderColor: '#FFCC00', // Yellow selection
    borderRadius: 8,
  },
  clipThumb: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  clipPlaceholder: {
    flex: 1,
    backgroundColor: '#1C1C1E',
  },

  // Bottom bar
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

  // Mute indicator
  muteIndicator: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Top row
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

  // Trim handles
  handleHitArea: {
    position: 'absolute',
    top: -2,
    bottom: -2,
    width: HANDLE_HIT_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 60,
  },
  handleHitLeft: {
    left: -HANDLE_HIT_WIDTH / 2,
    alignItems: 'flex-end',
    paddingRight: 2,
  },
  handleHitRight: {
    right: -HANDLE_HIT_WIDTH / 2,
    alignItems: 'flex-start',
    paddingLeft: 2,
  },
  handleVisual: {
    width: HANDLE_VISUAL_WIDTH,
    height: 22,
    borderRadius: 3,
    backgroundColor: '#FFCC00',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Add button
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

  // Playhead
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
});