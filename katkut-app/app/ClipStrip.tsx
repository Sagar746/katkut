import { useEffect, useRef, useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import { Edl } from '../core';

export const PX_PER_SEC = 26;
export const STRIP_HEIGHT = 72;
const MIN_LEN_SEC = 0.5;
const GAP = 4;
const PADDING = 12;
const LONG_PRESS_MS = 300;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 4;
const RULER_H = 18;
const ADD_BTN_W = 44;

export interface ClipStripProps {
  timeline: Edl['timeline'];
  selectedIndex: number;
  thumbs: Record<string, string>;
  durationByClipId: Map<string, number>;
  /** show trim handles + delete on the selected clip (only when paused) */
  handlesEnabled: boolean;
  onSelect: (index: number) => void;
  onToggleMute: (index: number) => void;
  onDelete: (index: number) => void;
  onTrim: (index: number, newIn: number, newOut: number) => void;
  /** committed on drag release (long-press + drag to reorder) */
  onReorder: (from: number, to: number) => void;
  /** pick more clips to append to the timeline (+ button at the strip end) */
  onAddMedia: () => void;
  /** elapsed seconds across the whole edited timeline — the strip scrolls so this position
   * always sits exactly under the fixed center line (playing, paused, or after a tap-seek) */
  playbackSec: number;
  /** user is dragging the strip itself to scrub; sec is the exact time now under the line */
  onScrub: (sec: number) => void;
  /** fired once when a manual scrub drag begins, so the parent can pause playback first */
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scrollRef = useRef<any>(null);
  const [trimDraft, setTrimDraft] = useState<TrimDraft | null>(null);
  const pendingRef = useRef<TrimDraft | null>(null);
  const [drag, setDragState] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  // native-driven offset for the dragged block — updated every gesture frame without
  // a React re-render; only the *target slot* (drag.target) triggers a re-render.
  const dragX = useRef(new Animated.Value(0)).current;
  const centersRef = useRef<number[]>([]);
  const [stripWidth, setStripWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const zoomStartRef = useRef(1);
  // true while the user is actively dragging/flinging the strip itself to scrub —
  // suppresses the playbackSec-tracking effect so it doesn't fight the user's finger
  const userScrubbingRef = useRef(false);

  function applyDraft(d: TrimDraft) {
    pendingRef.current = d;
    setTrimDraft(d);
  }
  function endTrim(index: number) {
    const p = pendingRef.current;
    pendingRef.current = null;
    setTrimDraft(null);
    if (p && p.index === index) onTrim(index, p.in, p.out);
  }
  function setDrag(d: DragState | null) {
    dragRef.current = d;
    setDragState(d);
  }
  // re-render only when the highlighted drop slot actually changes; the live tx offset
  // is carried by dragX (native driver) so per-pixel movement never touches React state.
  function setDragTarget(from: number, target: number) {
    const prev = dragRef.current;
    const next = { from, tx: 0, target };
    dragRef.current = next;
    if (!prev || prev.from !== from || prev.target !== target) {
      setDragState(next);
    }
  }
  function targetForDrag(from: number, tx: number): number {
    const centers = centersRef.current;
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

  // half-viewport leading/trailing pad so the first/last clip can sit in the center
  const padStart = stripWidth > 0 ? stripWidth / 2 : PADDING;
  // pinch-to-zoom scales the time-to-pixels factor (wider = finer trimming)
  const pxPerSec = PX_PER_SEC * zoom;

  // layout: compute each clip's width/left-edge/length (content coords) — used for
  // reorder hit-testing and for the time<->pixel mapping that drives the scrub head
  const widths: number[] = [];
  const centers: number[] = [];
  const leftEdges: number[] = [];
  const lens: number[] = [];
  let cursor = padStart;
  timeline.forEach((t, i) => {
    const draft = trimDraft && trimDraft.index === i ? trimDraft : null;
    const inPt = draft ? draft.in : t.in;
    const outPt = draft ? draft.out : t.out;
    const lenSec = Math.max(0, outPt - inPt);
    const w = Math.max(40, lenSec * pxPerSec);
    widths[i] = w;
    lens[i] = lenSec;
    leftEdges[i] = cursor;
    centers[i] = cursor + w / 2;
    cursor += w + GAP;
  });
  centersRef.current = centers;

  // global elapsed-seconds -> pixel position under the line (and back). Drives both the
  // continuous follow-during-playback effect and the manual drag-to-scrub handler below.
  function pixelForTime(t: number): number {
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

  // the line is the scrub head: keep whatever time is "now" exactly under it. Skip while
  // the user is mid-drag/trim/scrub so this doesn't fight their finger.
  useEffect(() => {
    if (stripWidth <= 0) return;
    if (drag || trimDraft || userScrubbingRef.current) return;
    const px = pixelForTime(playbackSec);
    scrollRef.current?.scrollTo({ x: Math.max(0, px - stripWidth / 2), animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackSec, stripWidth, timeline.length, zoom]);

  function handleScrubBegin() {
    userScrubbingRef.current = true;
    onScrubStart?.();
  }
  function handleScrubEnd() {
    userScrubbingRef.current = false;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleStripScroll(e: any) {
    if (!userScrubbingRef.current) return;
    const centerPx = e.nativeEvent.contentOffset.x + stripWidth / 2;
    onScrub(timeAtPixel(centerPx));
  }

  // right edge of each block in clips-row coords, for the white pill separators
  const rightEdges: number[] = [];
  let acc = 0;
  for (let i = 0; i < widths.length; i++) {
    acc += widths[i];
    rightEdges[i] = acc + i * GAP;
  }

  // time-ruler ticks (every 5s, labelled every 10s) across the edited duration
  const totalSec = timeline.reduce((s, t) => s + Math.max(0, t.out - t.in), 0);
  const ticks: number[] = [];
  for (let s = 0; s <= Math.ceil(totalSec); s += 5) ticks.push(s);

  const pinch = Gesture.Pinch()
    .onStart(() => {
      zoomStartRef.current = zoom;
    })
    .onUpdate((e) => {
      setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomStartRef.current * e.scale)));
    });

  return (
    <View
      style={styles.stripContainer}
      onLayout={(e) => setStripWidth(e.nativeEvent.layout.width)}
    >
      <GestureDetector gesture={pinch}>
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
          scrollEventThrottle={32}
        >
          <View>
            {/* time ruler — ticks every 5s, labelled every 10s */}
            {ticks.map((s) => (
              <View key={`tick-${s}`} pointerEvents="none" style={[styles.tick, { left: s * pxPerSec }]}>
                <View style={styles.tickMark} />
                {s % 10 === 0 && <Text style={styles.tickLabel}>{s}s</Text>}
              </View>
            ))}

            <View style={styles.clipsRow}>
              {timeline.map((t, i) => {
                const selected = i === selectedIndex;
                const sourceDur = durationByClipId.get(t.clipId) ?? t.out;
                const isDragged = drag?.from === i;
                const isTarget = drag != null && drag.target === i && drag.from !== i;

                const reorderPan = Gesture.Pan()
                  .activateAfterLongPress(LONG_PRESS_MS)
                  .blocksExternalGesture(scrollRef)
                  .onStart(() => {
                    dragX.setValue(0);
                    setDrag({ from: i, tx: 0, target: i });
                  })
                  .onUpdate((e) => {
                    dragX.setValue(e.translationX);
                    setDragTarget(i, targetForDrag(i, e.translationX));
                  })
                  .onEnd(() => {
                    const ds = dragRef.current;
                    setDrag(null);
                    dragX.setValue(0);
                    if (ds && ds.from !== ds.target) onReorder(ds.from, ds.target);
                  })
                  .onFinalize(() => {
                    setDrag(null);
                    dragX.setValue(0);
                  });

                return (
                  <GestureDetector key={`${t.clipId}-${i}`} gesture={reorderPan}>
                    <Animated.View
                      style={[
                        styles.block,
                        { width: widths[i] },
                        selected && styles.blockSelected,
                        isTarget && styles.blockTarget,
                        isDragged && {
                          transform: [{ translateX: dragX }],
                          zIndex: 10,
                          opacity: 0.85,
                        },
                      ]}
                    >
                    <Pressable onPress={() => onSelect(i)} style={styles.blockInner}>
                      {thumbs[t.clipId] ? (
                        <Image source={{ uri: thumbs[t.clipId] }} style={styles.thumb} />
                      ) : (
                        <View style={[styles.thumb, styles.placeholder]} />
                      )}

                      <Pressable hitSlop={8} onPress={() => onToggleMute(i)} style={styles.muteBtn}>
                        <Text style={styles.muteIcon}>{t.muted ? '🔇' : '🔊'}</Text>
                      </Pressable>

                      {selected && handlesEnabled && (
                        <>
                          <Pressable hitSlop={8} onPress={() => onDelete(i)} style={styles.deleteBtn}>
                            <Text style={styles.deleteIcon}>🗑️</Text>
                          </Pressable>

                          <TrimHandle
                            side="left"
                            scrollRef={scrollRef}
                            pxPerSec={pxPerSec}
                            origIn={t.in}
                            origOut={t.out}
                            onChange={(deltaSec, origIn, origOut) => {
                              const newIn = Math.min(Math.max(origIn + deltaSec, 0), origOut - MIN_LEN_SEC);
                              applyDraft({ index: i, in: newIn, out: origOut });
                            }}
                            onEnd={() => endTrim(i)}
                          />
                          <TrimHandle
                            side="right"
                            scrollRef={scrollRef}
                            pxPerSec={pxPerSec}
                            origIn={t.in}
                            origOut={t.out}
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

              {/* white pill separators between clips */}
              {timeline.slice(0, -1).map((_, i) => (
                <View
                  key={`sep-${i}`}
                  pointerEvents="none"
                  style={[styles.pill, { left: rightEdges[i] + GAP / 2 - 1 }]}
                />
              ))}

              {/* + Add media — pick more clips, appended at the end */}
              <Pressable onPress={onAddMedia} style={styles.addBtn}>
                <Text style={styles.addIcon}>+</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </GestureDetector>

      {/* fixed center playhead — the strip scrolls under it */}
      <View pointerEvents="none" style={styles.playhead} />
    </View>
  );
}

interface TrimHandleProps {
  side: 'left' | 'right';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scrollRef: React.RefObject<any>;
  pxPerSec: number;
  origIn: number;
  origOut: number;
  onChange: (deltaSec: number, origIn: number, origOut: number) => void;
  onEnd: () => void;
}

function TrimHandle({ side, scrollRef, pxPerSec, origIn, origOut, onChange, onEnd }: TrimHandleProps) {
  const orig = useRef({ in: origIn, out: origOut });
  const pan = Gesture.Pan()
    .blocksExternalGesture(scrollRef)
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
      <View style={[styles.handle, side === 'left' ? styles.handleLeft : styles.handleRight]}>
        <View style={styles.handleGrip} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  stripContainer: {
    backgroundColor: '#111',
    paddingVertical: 8,
    justifyContent: 'center',
  },
  tick: {
    position: 'absolute',
    top: 0,
    alignItems: 'center',
  },
  tickMark: { width: 1, height: 6, backgroundColor: '#555', marginBottom: 2 },
  tickLabel: { color: '#888', fontSize: 9, fontVariant: ['tabular-nums'] },
  clipsRow: {
    marginTop: RULER_H,
    flexDirection: 'row',
    gap: GAP,
    alignItems: 'center',
  },
  pill: {
    position: 'absolute',
    top: 6,
    bottom: 6,
    width: 2,
    borderRadius: 1,
    backgroundColor: '#fff',
  },
  addBtn: {
    width: ADD_BTN_W,
    height: STRIP_HEIGHT,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#555',
    backgroundColor: '#1c1c1c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addIcon: { color: '#fff', fontSize: 26, lineHeight: 28 },
  playhead: {
    position: 'absolute',
    left: '50%',
    marginLeft: -1,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#fff',
    zIndex: 5,
  },
  block: {
    height: STRIP_HEIGHT,
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: '#000',
  },
  blockInner: { flex: 1 },
  blockSelected: { borderColor: '#3478f6' },
  blockTarget: { borderColor: '#7fb0ff', borderStyle: 'dashed' },
  thumb: { width: '100%', height: '100%' },
  placeholder: { backgroundColor: '#ccc' },
  muteBtn: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 10,
    paddingHorizontal: 3,
  },
  muteIcon: { fontSize: 13 },
  deleteBtn: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 10,
    paddingHorizontal: 3,
  },
  deleteIcon: { fontSize: 13 },
  handle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 18,
    backgroundColor: 'rgba(52,120,246,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleLeft: { left: 0, borderTopLeftRadius: 4, borderBottomLeftRadius: 4 },
  handleRight: { right: 0, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  handleGrip: { width: 3, height: 24, borderRadius: 2, backgroundColor: '#fff' },
});
