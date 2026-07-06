import { useEffect, useState } from 'react';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { Edl } from '../core';

/** Cache key for one timeline entry's thumbnail. Keyed by clipId + in-point (not clipId alone) —
 *  Auto's multi-clip extraction can put two segments from the SAME source clip on the timeline,
 *  and each needs its own thumbnail at its own in-point rather than sharing one cache slot. */
export function thumbKey(t: { clipId: string; in: number }): string {
  return `${t.clipId}@${t.in}`;
}

/** Lazily generate one thumbnail per timeline entry (at its in-point). Cached by clipId+in-point. */
export function useClipThumbnails(timeline: Edl['timeline'], uriByClipId: Map<string, string>) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const t of timeline) {
        const key = thumbKey(t);
        if (thumbs[key]) continue;
        const uri = uriByClipId.get(t.clipId);
        if (!uri) continue;
        // A photo's source IS an image — use it straight as the thumbnail (getThumbnailAsync
        // only works on video and would throw here).
        if (t.kind === 'photo') {
          if (!cancelled) setThumbs((prev) => ({ ...prev, [key]: uri }));
          continue;
        }
        try {
          const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(uri, {
            time: Math.max(0, t.in) * 1000,
          });
          if (!cancelled) setThumbs((prev) => ({ ...prev, [key]: thumbUri }));
        } catch {
          // thumbnails are a nice-to-have; ignore failures
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline, uriByClipId]);

  return thumbs;
}
