import ExpoModulesCore
import AVFoundation

public class MediaProbeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MediaProbe")

    AsyncFunction("probe") { (uriString: String) -> [String: Any] in
      guard let url = URL(string: uriString) else {
        throw MediaProbeInvalidUriException(uriString)
      }
      if url.isFileURL && !FileManager.default.isReadableFile(atPath: url.path) {
        throw MediaProbeFileNotFoundException(uriString)
      }

      let asset = AVURLAsset(url: url)

      let durationSeconds = CMTimeGetSeconds(asset.duration)
      let durationMs: Int64 = durationSeconds.isFinite && durationSeconds > 0
        ? Int64(durationSeconds * 1000)
        : 0

      var width = 0
      var height = 0
      var rotation = 0

      if let track = asset.tracks(withMediaType: .video).first {
        let naturalSize = track.naturalSize
        width = Int(naturalSize.width)
        height = Int(naturalSize.height)
        rotation = Self.rotationDegrees(from: track.preferredTransform)
      }

      return [
        "durationMs": durationMs,
        "width": width,
        "height": height,
        "rotation": rotation,
      ]
    }
  }

  // naturalSize/preferredTransform: iOS reports the raw (pre-rotation) sample
  // dimensions plus a separate transform matrix, same split Android's
  // METADATA_KEY_VIDEO_WIDTH/HEIGHT + METADATA_KEY_VIDEO_ROTATION gives — decompose
  // the matrix into the same 0/90/180/270 degree convention so core/ can stay
  // platform-agnostic (see IOS_PORT_HANDOFF.md §8).
  private static func rotationDegrees(from transform: CGAffineTransform) -> Int {
    let degrees = Int(round(atan2(transform.b, transform.a) * 180 / .pi))
    switch degrees {
    case 90, -270: return 90
    case 180, -180: return 180
    case -90, 270: return 270
    default: return 0
    }
  }
}

internal final class MediaProbeInvalidUriException: GenericException<String> {
  override var reason: String {
    "Invalid URI: \(param)"
  }
}

internal final class MediaProbeFileNotFoundException: GenericException<String> {
  override var reason: String {
    "File not found: \(param)"
  }
}
