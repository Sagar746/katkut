import AVFoundation

// Builds one continuous PCM timeline for the whole export (source audio for un-muted segments,
// silence for muted ones) at a fixed 44.1kHz stereo format — mirrors AudioTimelineEncoder.kt.
// Unlike Android (which hand-rolls linear resampling/channel-mixing because MediaCodec's PCM
// output is whatever the source format is), AVAssetReaderTrackOutput can request the target
// sample rate/channel count directly in outputSettings and AVFoundation performs the conversion,
// so no manual resampling code is needed here.
enum PCMAudioBuilder {
  static let sampleRate = 44_100
  static let channels = 2

  static func buildTimeline(segments: [Segment]) -> Data {
    var pcm = Data()
    for seg in segments {
      let durSec = max(0, seg.outSec - seg.inSec)
      pcm.append(seg.muted ? silence(durSec: durSec) : segmentPcm(seg: seg, durSec: durSec))
    }
    return pcm
  }

  private static func frameCount(durSec: Double) -> Int {
    Int((durSec * Double(sampleRate)).rounded())
  }

  private static func silence(durSec: Double) -> Data {
    Data(count: frameCount(durSec: durSec) * channels * 2)
  }

  private static func segmentPcm(seg: Segment, durSec: Double) -> Data {
    guard let url = URL(string: seg.uri) else { return silence(durSec: durSec) }
    let asset = AVURLAsset(url: url)
    guard let audioTrack = asset.tracks(withMediaType: .audio).first,
      let reader = try? AVAssetReader(asset: asset)
    else {
      return silence(durSec: durSec) // no audio track → silence, matches AudioTimelineEncoder.kt
    }

    let outputSettings: [String: Any] = [
      AVFormatIDKey: kAudioFormatLinearPCM,
      AVSampleRateKey: sampleRate,
      AVNumberOfChannelsKey: channels,
      AVLinearPCMBitDepthKey: 16,
      AVLinearPCMIsBigEndianKey: false,
      AVLinearPCMIsFloatKey: false,
      AVLinearPCMIsNonInterleaved: false,
    ]
    let output = AVAssetReaderTrackOutput(track: audioTrack, outputSettings: outputSettings)
    output.alwaysCopiesSampleData = false
    guard reader.canAdd(output) else { return silence(durSec: durSec) }
    reader.add(output)
    reader.timeRange = CMTimeRange(
      start: CMTime(seconds: seg.inSec, preferredTimescale: 600),
      duration: CMTime(seconds: durSec, preferredTimescale: 600)
    )
    guard reader.startReading() else { return silence(durSec: durSec) }

    var raw = Data()
    while let sampleBuffer = output.copyNextSampleBuffer() {
      guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { continue }
      var length = 0
      var pointer: UnsafeMutablePointer<Int8>?
      let status = CMBlockBufferGetDataPointer(
        blockBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &pointer
      )
      if status == noErr, let pointer {
        raw.append(contentsOf: UnsafeRawBufferPointer(start: pointer, count: length))
      }
    }

    // Force EXACTLY durSec long so audio/video segment durations stay identical across the
    // timeline (otherwise audio drifts onto later clips) — matches AudioTimelineEncoder.kt.
    let targetBytes = frameCount(durSec: durSec) * channels * 2
    var fitted = Data(count: targetBytes)
    fitted.replaceSubrange(0..<min(raw.count, targetBytes), with: raw.prefix(targetBytes))
    return fitted
  }

  // Chunk raw PCM bytes into hand-built CMSampleBuffers and feed them to an AAC-output
  // AVAssetWriterInput — AVAssetWriter transcodes PCM → AAC internally, so unlike Android there's
  // no separate manual MediaCodec AAC-encode pass.
  static func appendPCM(_ pcmData: Data, to input: AVAssetWriterInput) {
    let bytesPerFrame = channels * 2
    let framesPerChunk = 4096
    let bytesPerChunk = framesPerChunk * bytesPerFrame

    var asbd = AudioStreamBasicDescription(
      mSampleRate: Float64(sampleRate),
      mFormatID: kAudioFormatLinearPCM,
      mFormatFlags: kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked,
      mBytesPerPacket: UInt32(bytesPerFrame),
      mFramesPerPacket: 1,
      mBytesPerFrame: UInt32(bytesPerFrame),
      mChannelsPerFrame: UInt32(channels),
      mBitsPerChannel: 16,
      mReserved: 0
    )
    var formatDescription: CMAudioFormatDescription?
    CMAudioFormatDescriptionCreate(
      allocator: kCFAllocatorDefault, asbd: &asbd, layoutSize: 0, layout: nil, magicCookieSize: 0,
      magicCookie: nil, extensions: nil, formatDescriptionOut: &formatDescription
    )
    guard let formatDescription else { return }

    var offset = 0
    var frameOffset: Int64 = 0
    while offset < pcmData.count {
      while !input.isReadyForMoreMediaData {
        Thread.sleep(forTimeInterval: 0.001)
      }
      let chunkSize = min(bytesPerChunk, pcmData.count - offset)
      let frameCount = chunkSize / bytesPerFrame
      guard frameCount > 0 else { break }

      var blockBuffer: CMBlockBuffer?
      CMBlockBufferCreateWithMemoryBlock(
        allocator: kCFAllocatorDefault, memoryBlock: nil, blockLength: chunkSize,
        blockAllocator: kCFAllocatorDefault, customBlockSource: nil, offsetToData: 0,
        dataLength: chunkSize, flags: 0, blockBufferOut: &blockBuffer
      )
      guard let blockBuffer else { offset += chunkSize; continue }
      pcmData.subdata(in: offset..<(offset + chunkSize)).withUnsafeBytes { raw in
        _ = CMBlockBufferReplaceDataBytes(
          with: raw.baseAddress!, blockBuffer: blockBuffer, offsetIntoDestination: 0, dataLength: chunkSize
        )
      }

      var timing = CMSampleTimingInfo(
        duration: CMTime(value: 1, timescale: Int32(sampleRate)),
        presentationTimeStamp: CMTime(value: frameOffset, timescale: Int32(sampleRate)),
        decodeTimeStamp: .invalid
      )
      var sampleBuffer: CMSampleBuffer?
      CMSampleBufferCreate(
        allocator: kCFAllocatorDefault, dataBuffer: blockBuffer, dataReady: true,
        makeDataReadyCallback: nil, refcon: nil, formatDescription: formatDescription,
        sampleCount: frameCount, sampleTimingEntryCount: 1, sampleTimingArray: &timing,
        sampleSizeEntryCount: 0, sampleSizeArray: nil, sampleBufferOut: &sampleBuffer
      )
      if let sampleBuffer {
        input.append(sampleBuffer)
      }
      offset += chunkSize
      frameOffset += Int64(frameCount)
    }
  }
}
