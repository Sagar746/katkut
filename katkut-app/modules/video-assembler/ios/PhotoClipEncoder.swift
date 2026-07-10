import AVFoundation
import CoreImage

// Renders a single still photo into a short H.264 MP4 (video-only, no audio) with Ken Burns motion
// (slow zoom/pan) so it doesn't freeze the reel's momentum — mirrors PhotoClipEncoder.kt. The
// produced clip is a normal MP4, so the rest of the pipeline (preview player, concat/export)
// consumes it exactly like a video segment.
final class PhotoClipEncoder {
  private static let fps = 30

  func render(
    uri: String, outputPath: String, outW: Int, outH: Int, durationSec: Double, motionType: String,
    motionAmount: Double
  ) throws {
    guard let url = URL(string: uri) else { throw VideoAssemblerException("Bad URI: \(uri)") }
    // CIImage bakes the EXIF orientation tag into the pixel data, replacing Android's manual
    // ExifInterface + Bitmap rotation.
    guard let loaded = CIImage(contentsOf: url, options: [.applyOrientationProperty: true]) else {
      throw VideoAssemblerException("Failed to decode photo: \(uri)")
    }
    let original = FrameCompositor.normalizedOrigin(loaded)
    let srcSize = original.extent.size
    guard srcSize.width > 0, srcSize.height > 0 else {
      throw VideoAssemblerException("Invalid photo dimensions: \(uri)")
    }

    // HARD RULE 2: a portrait/vertical photo fills the canvas (cover-fit). A landscape/square
    // photo is shown uncropped, centered, over a blurred fill of itself — never a hard crop.
    let srcAspect = Double(srcSize.width / srcSize.height)
    let dstAspect = Double(outW) / Double(outH)
    let blurredFill = srcAspect > dstAspect
    let dstSize = CGSize(width: outW, height: outH)
    let bitrate = max(outW, outH) >= 1920 ? 10_000_000 : 5_000_000

    let coverScaleStatic = FrameCompositor.coverScale(srcAspect: srcAspect, dstAspect: dstAspect)
    let containRect = blurredFill ? FrameCompositor.containFitRect(srcSize: srcSize, dstSize: dstSize) : .zero
    // Background stays static (no motion) — only the sharp foreground carries the Ken Burns move.
    // Computed once, outside the frame loop, since the photo's aspect never changes frame to frame.
    let background = blurredFill ? FrameCompositor.blurredFillBackground(original, dstSize: dstSize) : nil

    let writer = try VideoEncoderWriter(
      outputPath: outputPath, width: outW, height: outH, bitrate: bitrate, fps: Self.fps,
      keyframeIntervalSec: 1.0
    )
    try writer.start()

    let totalFrames = max(1, Int((durationSec * Double(Self.fps)).rounded()))

    for i in 0..<totalFrames {
      autoreleasepool {
        let t = totalFrames <= 1 ? 0.0 : Double(i) / Double(totalFrames - 1)
        let composited: CIImage
        if blurredFill, let background {
          // foreground: Ken Burns motion only (no cover-crop — contain shows the full frame)
          let cropRect = FrameCompositor.kenBurnsCropRect(
            baseSize: srcSize, coverScale: CGSize(width: 1, height: 1), motionType: motionType,
            amount: motionAmount, t: t
          )
          let foreground = FrameCompositor.placed(
            FrameCompositor.normalizedOrigin(original.cropped(to: cropRect)), in: containRect
          )
          composited = foreground.composited(over: background)
        } else {
          let cropRect = FrameCompositor.kenBurnsCropRect(
            baseSize: srcSize, coverScale: coverScaleStatic, motionType: motionType, amount: motionAmount, t: t
          )
          let cropped = FrameCompositor.normalizedOrigin(original.cropped(to: cropRect))
          composited = FrameCompositor.scaledToFill(cropped, dstSize: dstSize)
        }

        guard let pixelBuffer = writer.makePixelBuffer() else { return }
        FrameCompositor.render(composited, to: pixelBuffer)
        writer.append(pixelBuffer, at: CMTime(value: Int64(i), timescale: Int32(Self.fps)))
      }
    }

    writer.finishVideoInput()
    try writer.finishSync()
  }
}
