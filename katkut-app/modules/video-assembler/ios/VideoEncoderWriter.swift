import AVFoundation
import CoreVideo

// Shared AVAssetWriter + hardware H.264 (VideoToolbox, satisfying HARD RULE 7 "for free" — see
// IOS_PORT_HANDOFF.md §8) setup used by Transcoder, ProxyTranscoder and PhotoClipEncoder.
final class VideoEncoderWriter {
  let writer: AVAssetWriter
  let videoInput: AVAssetWriterInput
  private let pixelBufferAdaptor: AVAssetWriterInputPixelBufferAdaptor

  // allKeyframes forces every frame to be a sync frame (AVVideoMaxKeyFrameIntervalKey = 1) instead
  // of a time-based interval — used by ProxyTranscoder so the preview player's playlist can clip
  // to an arbitrary in-point on any frame without a decode-and-discard stall at clip boundaries.
  init(
    outputPath: String, width: Int, height: Int, bitrate: Int, fps: Int, keyframeIntervalSec: Double,
    allKeyframes: Bool = false
  ) throws {
    let url = URL(fileURLWithPath: outputPath)
    try? FileManager.default.removeItem(at: url)
    writer = try AVAssetWriter(outputURL: url, fileType: .mp4)

    var compressionProperties: [String: Any] = [
      AVVideoAverageBitRateKey: bitrate,
      AVVideoExpectedSourceFrameRateKey: fps,
    ]
    if allKeyframes {
      compressionProperties[AVVideoMaxKeyFrameIntervalKey] = 1
    } else {
      compressionProperties[AVVideoMaxKeyFrameIntervalDurationKey] = keyframeIntervalSec
    }
    let videoSettings: [String: Any] = [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: width,
      AVVideoHeightKey: height,
      AVVideoCompressionPropertiesKey: compressionProperties,
    ]
    videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
    videoInput.expectsMediaDataInRealTime = false

    pixelBufferAdaptor = AVAssetWriterInputPixelBufferAdaptor(
      assetWriterInput: videoInput,
      sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height,
      ]
    )

    guard writer.canAdd(videoInput) else {
      throw VideoAssemblerException("Cannot add video input to writer")
    }
    writer.add(videoInput)
  }

  func addAudioInput(_ input: AVAssetWriterInput) throws {
    guard writer.canAdd(input) else {
      throw VideoAssemblerException("Cannot add audio input to writer")
    }
    writer.add(input)
  }

  func start() throws {
    guard writer.startWriting() else {
      throw VideoAssemblerException("startWriting failed: \(writer.error?.localizedDescription ?? "unknown")")
    }
    writer.startSession(atSourceTime: .zero)
  }

  func makePixelBuffer() -> CVPixelBuffer? {
    guard let pool = pixelBufferAdaptor.pixelBufferPool else { return nil }
    var pixelBuffer: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pixelBuffer)
    return pixelBuffer
  }

  @discardableResult
  func append(_ pixelBuffer: CVPixelBuffer, at time: CMTime) -> Bool {
    while !videoInput.isReadyForMoreMediaData {
      Thread.sleep(forTimeInterval: 0.001)
    }
    return pixelBufferAdaptor.append(pixelBuffer, withPresentationTime: time)
  }

  func finishVideoInput() {
    videoInput.markAsFinished()
  }

  func finishSync() throws {
    let semaphore = DispatchSemaphore(value: 0)
    writer.finishWriting { semaphore.signal() }
    semaphore.wait()
    if writer.status != .completed {
      throw VideoAssemblerException("Writer finished with status \(writer.status.rawValue): \(writer.error?.localizedDescription ?? "unknown")")
    }
  }
}
