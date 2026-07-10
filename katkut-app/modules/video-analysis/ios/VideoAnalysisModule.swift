import ExpoModulesCore
import AVFoundation
import CoreMedia
import CoreVideo

// ---- tunables — ported 1:1 from AnalysisModule.kt so scoring constants tuned
// against Android footage transfer to iOS without retuning (see IOS_PORT_HANDOFF.md §8) ----
private let sampleIntervalSec = 0.25 // ~4 fps
private let gridMax = 96 // downsample target for cheap luma math
private let windowSec = 1.0
private let freezeDiff = 2.0 // mean abs luma diff below this => frozen
private let sceneDiff = 30.0 // above this => scene cut
private let sharpRef = 300.0 // Laplacian variance treated as "fully sharp"
private let silenceDbfs = -120.0 // window with no audio samples / no audio track

// One sampled frame's video metrics.
private struct Sample {
  let tSec: Double
  let blur: Double
  let exposure: Double
  let frozen: Bool
}

public class VideoAnalysisModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VideoAnalysis")

    AsyncFunction("analyze") { (uriString: String, clipId: String) -> [String: Any] in
      guard let url = URL(string: uriString) else {
        throw VideoAnalysisException("Invalid URI: \(uriString)")
      }
      if url.isFileURL && !FileManager.default.isReadableFile(atPath: url.path) {
        throw VideoAnalysisException("File not found: \(uriString)")
      }
      return try Self.analyzeVideo(url: url, uriString: uriString, clipId: clipId)
    }
  }

  private static func clamp01(_ x: Double) -> Double {
    x < 0.0 ? 0.0 : (x > 1.0 ? 1.0 : x)
  }

  private static func round1(_ x: Double) -> Double { (x * 10.0).rounded() / 10.0 }
  private static func round3(_ x: Double) -> Double { (x * 1000.0).rounded() / 1000.0 }

  private static func classifyOrientation(_ w: Int, _ h: Int) -> String {
    if w == 0 || h == 0 { return "portrait" }
    let ratio = Double(w) / Double(h)
    if ratio >= 0.95 && ratio <= 1.05 { return "square" }
    return ratio < 0.95 ? "portrait" : "landscape"
  }

  // preferredTransform encodes rotation as a matrix, not a metadata flag (the iOS gotcha
  // flagged in IOS_PORT_HANDOFF.md §8) — decompose to the same 0/90/180/270 convention
  // Android's METADATA_KEY_VIDEO_ROTATION already uses.
  private static func rotationDegrees(from transform: CGAffineTransform) -> Int {
    let degrees = Int(round(atan2(transform.b, transform.a) * 180 / .pi))
    switch degrees {
    case 90, -270: return 90
    case 180, -180: return 180
    case -90, 270: return 270
    default: return 0
    }
  }

  private static func analyzeVideo(url: URL, uriString: String, clipId: String) throws -> [String: Any] {
    let asset = AVURLAsset(url: url)

    guard let videoTrack = asset.tracks(withMediaType: .video).first else {
      throw VideoAnalysisException("No video track found in \(uriString)")
    }

    let durationSeconds = CMTimeGetSeconds(asset.duration)
    var durationSec = durationSeconds.isFinite && durationSeconds > 0 ? durationSeconds : 0.0

    let naturalSize = videoTrack.naturalSize
    let rotation = rotationDegrees(from: videoTrack.preferredTransform)
    let (ow, oh) = (rotation == 90 || rotation == 270)
      ? (Int(naturalSize.height), Int(naturalSize.width))
      : (Int(naturalSize.width), Int(naturalSize.height))
    let orientation = classifyOrientation(ow, oh)

    // --- decode video track once, sampling frames every ~250ms ---
    let reader = try AVAssetReader(asset: asset)
    let videoOutputSettings: [String: Any] = [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
    ]
    let videoOutput = AVAssetReaderTrackOutput(track: videoTrack, outputSettings: videoOutputSettings)
    videoOutput.alwaysCopiesSampleData = false
    guard reader.canAdd(videoOutput) else {
      throw VideoAnalysisException("Cannot read video track for \(uriString)")
    }
    reader.add(videoOutput)
    guard reader.startReading() else {
      throw VideoAnalysisException(
        "Failed to start reading \(uriString): \(reader.error?.localizedDescription ?? "unknown error")"
      )
    }

    var samples: [Sample] = []
    var sceneCuts: [Double] = []
    var nextSampleSec = 0.0
    var prevGrid: [Int]? = nil
    var prevGw = 0
    var prevGh = 0

    while let sampleBuffer = videoOutput.copyNextSampleBuffer() {
      let tSec = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
      guard tSec >= nextSampleSec, let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
        continue
      }

      let (grid, gw, gh) = lumaGrid(from: pixelBuffer)
      let exposure = grid.isEmpty ? 0.0 : Double(grid.reduce(0, +)) / Double(grid.count) / 255.0
      let blur = blurFromGrid(grid, gw, gh)

      var frozen = false
      if let prev = prevGrid, prevGw == gw, prevGh == gh {
        let meanDiff = meanAbsDiff(grid, prev)
        frozen = meanDiff < freezeDiff
        if meanDiff > sceneDiff { sceneCuts.append(round1(tSec)) }
      }
      samples.append(Sample(tSec: tSec, blur: blur, exposure: exposure, frozen: frozen))
      prevGrid = grid
      prevGw = gw
      prevGh = gh
      nextSampleSec = tSec + sampleIntervalSec
    }

    if reader.status == .failed && samples.isEmpty {
      throw VideoAnalysisException(
        "Decoding failed for \(uriString): \(reader.error?.localizedDescription ?? "unknown error")"
      )
    }

    if durationSec <= 0.0, let last = samples.last {
      durationSec = last.tSec + windowSec
    }

    // --- audio pass (secondary signal; never fails the whole analysis) ---
    let audioByWindow = audioRmsByWindow(asset: asset)

    let windows = buildWindows(samples: samples, durationSec: durationSec, audioByWindow: audioByWindow)

    return [
      "clipId": clipId,
      "duration": round1(durationSec),
      "orientation": orientation,
      "sceneCuts": sceneCuts,
      "windows": windows,
      "uri": uriString,
    ]
  }

  // Downsample the Y (luma) plane of a bi-planar 4:2:0 pixel buffer to a small grid.
  private static func lumaGrid(from pixelBuffer: CVPixelBuffer) -> (grid: [Int], gw: Int, gh: Int) {
    CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }

    guard let base = CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, 0) else {
      return ([], 0, 0)
    }
    let rowStride = CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, 0)
    let width = CVPixelBufferGetWidthOfPlane(pixelBuffer, 0)
    let height = CVPixelBufferGetHeightOfPlane(pixelBuffer, 0)
    let gw = max(1, min(gridMax, width))
    let gh = max(1, min(gridMax, height))
    let ptr = base.assumingMemoryBound(to: UInt8.self)

    var grid = [Int](repeating: 0, count: gw * gh)
    for gy in 0..<gh {
      let sy = gy * height / gh
      for gx in 0..<gw {
        let sx = gx * width / gw
        grid[gy * gw + gx] = Int(ptr[sy * rowStride + sx])
      }
    }
    return (grid, gw, gh)
  }

  // Laplacian variance → blurriness in 0..1 (1 = very blurry).
  private static func blurFromGrid(_ grid: [Int], _ gw: Int, _ gh: Int) -> Double {
    if gw < 3 || gh < 3 { return 0.0 }
    var sum = 0.0
    var sumSq = 0.0
    var n = 0
    for y in 1..<(gh - 1) {
      for x in 1..<(gw - 1) {
        let c = grid[y * gw + x]
        let lap = 4 * c - grid[(y - 1) * gw + x] - grid[(y + 1) * gw + x]
          - grid[y * gw + (x - 1)] - grid[y * gw + (x + 1)]
        sum += Double(lap)
        sumSq += Double(lap * lap)
        n += 1
      }
    }
    if n == 0 { return 0.0 }
    let mean = sum / Double(n)
    let variance = sumSq / Double(n) - mean * mean
    return clamp01(1.0 - variance / sharpRef)
  }

  private static func meanAbsDiff(_ a: [Int], _ b: [Int]) -> Double {
    let n = min(a.count, b.count)
    if n == 0 { return 0.0 }
    var d = 0.0
    for i in 0..<n { d += Double(abs(a[i] - b[i])) }
    return d / Double(n)
  }

  private static func buildWindows(
    samples: [Sample],
    durationSec: Double,
    audioByWindow: [Int: Double]
  ) -> [[String: Any]] {
    if samples.isEmpty { return [] }
    var byWindow: [Int: [Sample]] = [:]
    for s in samples {
      let idx = Int(floor(s.tSec / windowSec))
      byWindow[idx, default: []].append(s)
    }
    var result: [[String: Any]] = []
    for idx in byWindow.keys.sorted() {
      let group = byWindow[idx]!
      let blur = group.reduce(0.0) { $0 + $1.blur } / Double(group.count)
      let exposure = group.reduce(0.0) { $0 + $1.exposure } / Double(group.count)
      let frozenCount = group.filter { $0.frozen }.count
      let frozen = frozenCount * 2 > group.count
      let start = Double(idx) * windowSec
      let end = durationSec > 0 ? min(Double(idx + 1) * windowSec, durationSec) : Double(idx + 1) * windowSec
      result.append([
        "start": round1(start),
        "end": round1(end),
        "blur": round3(blur),
        "audioRMS": round1(audioByWindow[idx] ?? silenceDbfs),
        "exposure": round3(exposure),
        "frozen": frozen,
      ])
    }
    return result
  }

  // Decode the audio track once → per-window RMS loudness in dBFS. Best-effort: any
  // failure (or no audio track) yields an empty map, never fails the whole analysis.
  private static func audioRmsByWindow(asset: AVURLAsset) -> [Int: Double] {
    guard let audioTrack = asset.tracks(withMediaType: .audio).first else { return [:] }
    guard let reader = try? AVAssetReader(asset: asset) else { return [:] }

    let outputSettings: [String: Any] = [
      AVFormatIDKey: kAudioFormatLinearPCM,
      AVLinearPCMBitDepthKey: 16,
      AVLinearPCMIsBigEndianKey: false,
      AVLinearPCMIsFloatKey: false,
      AVLinearPCMIsNonInterleaved: false,
    ]
    let output = AVAssetReaderTrackOutput(track: audioTrack, outputSettings: outputSettings)
    output.alwaysCopiesSampleData = false
    guard reader.canAdd(output) else { return [:] }
    reader.add(output)
    guard reader.startReading() else { return [:] }

    var sumSq: [Int: Double] = [:]
    var count: [Int: Int64] = [:]

    while let sampleBuffer = output.copyNextSampleBuffer() {
      let idx = Int(floor(CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer)) / windowSec))
      guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { continue }

      var totalLength = 0
      var dataPointer: UnsafeMutablePointer<Int8>?
      let status = CMBlockBufferGetDataPointer(
        blockBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &totalLength,
        dataPointerOut: &dataPointer
      )
      guard status == noErr, let dataPointer else { continue }

      let shortCount = totalLength / 2
      dataPointer.withMemoryRebound(to: Int16.self, capacity: shortCount) { shorts in
        var localSq = 0.0
        for i in 0..<shortCount {
          let s = Double(shorts[i])
          localSq += s * s
        }
        sumSq[idx, default: 0] += localSq
        count[idx, default: 0] += Int64(shortCount)
      }
    }

    var result: [Int: Double] = [:]
    for (idx, sq) in sumSq {
      guard let n = count[idx], n > 0 else { continue }
      let rms = sqrt(sq / Double(n))
      let dbfs = rms > 0.0 ? 20.0 * log10(rms / 32768.0) : silenceDbfs
      result[idx] = max(dbfs, silenceDbfs)
    }
    return result
  }
}

internal final class VideoAnalysisException: GenericException<String> {
  override var reason: String {
    param
  }
}
