import AVFoundation
import CoreImage

// Trim + concat a list of segments into one H.264 MP4 using the hardware encoder (VideoToolbox,
// via AVAssetWriter — satisfies HARD RULE 7 "for free"). Each segment is decoded, composited
// (cover-fit or blurred-fill per HARD RULE 2) via CoreImage, and appended to a single writer
// session with continuous timestamps — mirrors Transcoder.kt.
final class Transcoder {
  private static let fps = 30
  private static let keyframeIntervalSec = 1.0

  func assemble(
    segments: [Segment], outputPath: String, audioMode: String, resolution: String, applyWatermark: Bool
  ) throws {
    guard !segments.isEmpty else { throw VideoAssemblerException("No segments to assemble") }

    // Output dimensions/bitrate — default 1080x1920 (HARD RULE 2); "720p" is the fast-export option.
    let (outW, outH, bitrate): (Int, Int, Int) =
      resolution == "720p" ? (720, 1280, 5_000_000) : (1080, 1920, 10_000_000)

    let effectiveSegments = segments.map { seg -> Segment in
      let muted: Bool
      switch audioMode {
      case "on": muted = false
      case "off": muted = true
      default: muted = seg.muted // "smart"
      }
      return Segment(uri: seg.uri, inSec: seg.inSec, outSec: seg.outSec, muted: muted)
    }
    let needAudio = audioMode != "off" && (audioMode == "on" || effectiveSegments.contains { !$0.muted })

    let writer = try VideoEncoderWriter(
      outputPath: outputPath, width: outW, height: outH, bitrate: bitrate, fps: Self.fps,
      keyframeIntervalSec: Self.keyframeIntervalSec
    )

    var audioInput: AVAssetWriterInput?
    if needAudio {
      let settings: [String: Any] = [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: PCMAudioBuilder.sampleRate,
        AVNumberOfChannelsKey: PCMAudioBuilder.channels,
        AVEncoderBitRateKey: 128_000,
      ]
      let input = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
      input.expectsMediaDataInRealTime = false
      try writer.addAudioInput(input)
      audioInput = input
    }

    // HARD RULE 6 (freemium): watermark free exports, Pro removes it — applyWatermark is decided
    // by the caller from account entitlement (see exportReel.ts); this module only executes it.
    // Best-effort: a missing/bad asset skips the watermark rather than failing the export.
    let watermark = applyWatermark ? FrameCompositor.loadWatermark() : nil
    if applyWatermark && watermark == nil {
      print("[VideoAssembler] Watermark asset failed to load — exporting without one.")
    }

    // Built up front (pure AVAssetReader decode, doesn't touch the writer) so the audio and video
    // queues below can start feeding the writer at the same time.
    let audioPcm = needAudio ? PCMAudioBuilder.buildTimeline(segments: effectiveSegments) : nil

    try writer.start()

    // AVAssetWriter interleaves multiple tracks by presentation time internally, and throttles
    // isReadyForMoreMediaData on one track while waiting for the other to catch up. Writing 100%
    // of the video track before starting audio (or vice versa) deadlocks once that internal buffer
    // window fills — both tracks must be fed concurrently.
    var videoError: Error?
    let group = DispatchGroup()

    group.enter()
    DispatchQueue.global(qos: .userInitiated).async { [self] in
      do {
        var timelineCursor = CMTime.zero
        for seg in segments {
          timelineCursor = try transcodeSegment(
            seg, writer: writer, outW: outW, outH: outH, watermark: watermark, timelineStart: timelineCursor
          )
        }
      } catch {
        videoError = error
      }
      writer.finishVideoInput()
      group.leave()
    }

    if needAudio, let audioInput, let audioPcm {
      group.enter()
      DispatchQueue.global(qos: .userInitiated).async {
        PCMAudioBuilder.appendPCM(audioPcm, to: audioInput)
        audioInput.markAsFinished()
        group.leave()
      }
    }

    group.wait()
    if let videoError { throw videoError }

    try writer.finishSync()
  }

  private func transcodeSegment(
    _ seg: Segment, writer: VideoEncoderWriter, outW: Int, outH: Int, watermark: CIImage?,
    timelineStart: CMTime
  ) throws -> CMTime {
    guard let url = URL(string: seg.uri) else { throw VideoAssemblerException("Bad URI: \(seg.uri)") }
    let asset = AVURLAsset(url: url)
    guard let track = asset.tracks(withMediaType: .video).first else {
      throw VideoAssemblerException("No video track in \(seg.uri)")
    }

    // HARD RULE 2: vertical sources fill (cover); landscape/square sources are shown uncropped,
    // centered, over a blurred fill of the same footage — never a hard crop, never black bars.
    let transform = track.preferredTransform
    let displayRect = CGRect(origin: .zero, size: track.naturalSize).applying(transform)
    let displaySize = CGSize(width: abs(displayRect.width), height: abs(displayRect.height))
    let srcAspect = Double(displaySize.width / displaySize.height)
    let dstAspect = Double(outW) / Double(outH)
    let blurredFill = srcAspect > dstAspect
    let dstSize = CGSize(width: outW, height: outH)
    let containRect = blurredFill ? FrameCompositor.containFitRect(srcSize: displaySize, dstSize: dstSize) : .zero

    let reader = try AVAssetReader(asset: asset)
    let output = AVAssetReaderTrackOutput(
      track: track, outputSettings: FrameCompositor.videoReaderOutputSettings
    )
    output.alwaysCopiesSampleData = false
    guard reader.canAdd(output) else {
      throw VideoAssemblerException("Cannot read video track for \(seg.uri)")
    }
    reader.add(output)
    reader.timeRange = CMTimeRange(
      start: CMTime(seconds: seg.inSec, preferredTimescale: 600),
      duration: CMTime(seconds: max(0, seg.outSec - seg.inSec), preferredTimescale: 600)
    )
    guard reader.startReading() else {
      throw VideoAssemblerException(
        "Failed to start reading \(seg.uri): \(reader.error?.localizedDescription ?? "unknown error")"
      )
    }

    var lastAppended = timelineStart
    var firstPts: CMTime?
    let frameDuration = CMTime(value: 1, timescale: Int32(Self.fps))

    while let sampleBuffer = output.copyNextSampleBuffer() {
      // Each frame allocates real backing memory (BGRA pixel buffers + CoreImage intermediates).
      // Without draining per iteration, autoreleased objects pile up for the whole segment instead
      // of being freed frame-by-frame — enough over a full reel to trigger an OS memory kill.
      autoreleasepool {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        if firstPts == nil { firstPts = pts }

        let oriented = FrameCompositor.orientedImage(pixelBuffer: pixelBuffer, transform: transform)
        var composited: CIImage
        if blurredFill {
          let background = FrameCompositor.blurredFillBackground(oriented, dstSize: dstSize)
          let foreground = FrameCompositor.placed(oriented, in: containRect)
          composited = foreground.composited(over: background)
        } else {
          composited = FrameCompositor.scaledToFill(
            FrameCompositor.coverCropped(oriented, dstAspect: dstAspect), dstSize: dstSize
          )
        }
        if let watermark {
          composited = FrameCompositor.watermarked(composited, watermark: watermark, dstSize: dstSize)
        }

        guard let outPixelBuffer = writer.makePixelBuffer() else { return }
        FrameCompositor.render(composited, to: outPixelBuffer)
        let outputTime = CMTimeAdd(timelineStart, CMTimeSubtract(pts, firstPts!))
        writer.append(outPixelBuffer, at: outputTime)
        lastAppended = outputTime
      }
    }

    if reader.status == .failed {
      throw VideoAssemblerException(
        "Decoding failed for \(seg.uri): \(reader.error?.localizedDescription ?? "unknown error")"
      )
    }

    // next segment starts one frame after the last rendered frame
    return CMTimeAdd(lastAppended, frameDuration)
  }
}
