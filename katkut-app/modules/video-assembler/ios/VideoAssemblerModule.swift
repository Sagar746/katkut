import ExpoModulesCore

struct SegmentRecord: Record {
  @Field var uri: String = ""
  @Field var inSec: Double = 0.0
  @Field var outSec: Double = 0.0
  @Field var muted: Bool = true
}

struct Segment {
  let uri: String
  let inSec: Double
  let outSec: Double
  let muted: Bool
}

public class VideoAssemblerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VideoAssembler")

    // Trim+concat segments → one 1080x1920 MP4 at outputPath (a local filesystem path).
    // audioMode: "smart" (per-clip muted flags) | "on" (all audio) | "off" (silent).
    // applyWatermark (HARD RULE 6): free exports carry it, Pro removes it — decided by the caller
    // from account entitlement (see exportReel.ts), this module just executes it.
    AsyncFunction("assemble") {
      (
        segments: [SegmentRecord], outputPath: String, audioMode: String, resolution: String,
        applyWatermark: Bool
      ) -> [String: Any] in
      let path = Self.filePath(from: outputPath)
      let segs = segments.map { Segment(uri: $0.uri, inSec: $0.inSec, outSec: $0.outSec, muted: $0.muted) }
      do {
        try Transcoder().assemble(
          segments: segs, outputPath: path, audioMode: audioMode, resolution: resolution,
          applyWatermark: applyWatermark
        )
      } catch {
        throw VideoAssemblerException("Assemble failed: \(error)")
      }
      return ["outputPath": outputPath]
    }

    // Render one still photo into a short H.264 MP4 (video-only) with Ken Burns motion, sized
    // w x h. The result is a normal MP4, so preview + concat/export consume it like a video clip.
    AsyncFunction("renderPhoto") {
      (
        uri: String, outputPath: String, width: Int, height: Int, durationSec: Double,
        motionType: String, motionAmount: Double
      ) -> [String: Any] in
      let path = Self.filePath(from: outputPath)
      do {
        try PhotoClipEncoder().render(
          uri: uri, outputPath: path, outW: width, outH: height, durationSec: durationSec,
          motionType: motionType, motionAmount: motionAmount
        )
      } catch {
        throw VideoAssemblerException("Photo render failed: \(error)")
      }
      return ["outputPath": outputPath]
    }

    // Generate a low-res 720x1280 preview proxy of one source clip (whole clip, audio passed
    // through) at outputPath. Preview-only; export still uses the full-res original.
    AsyncFunction("makeProxy") { (uri: String, outputPath: String) -> [String: Any] in
      let path = Self.filePath(from: outputPath)
      do {
        try ProxyTranscoder().makeProxy(uri: uri, outputPath: path)
      } catch {
        throw VideoAssemblerException("Proxy failed: \(error)")
      }
      return ["outputPath": outputPath]
    }
  }

  private static func filePath(from outputPath: String) -> String {
    outputPath.hasPrefix("file://") ? String(outputPath.dropFirst("file://".count)) : outputPath
  }
}

internal final class VideoAssemblerException: GenericException<String> {
  override var reason: String {
    param
  }
}
