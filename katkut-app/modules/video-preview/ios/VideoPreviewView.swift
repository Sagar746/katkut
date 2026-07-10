import AVFoundation
import ExpoModulesCore

struct PreviewItemRecord: Record {
  @Field var uri: String = ""
  @Field var inSec: Double = 0.0
  @Field var outSec: Double = 0.0
  @Field var muted: Bool = false
}

struct PreviewItem {
  let uri: String
  let inSec: Double
  let outSec: Double
  let muted: Bool
}

// AVPlayerLayer-backed UIView, matching Android's PlayerView usage.
private final class PlayerLayerView: UIView {
  override static var layerClass: AnyClass { AVPlayerLayer.self }
  var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
}

// Single AVPlayer fed one AVMutableComposition built from the whole EDL (one clip per timeline
// item, back to back) — mirrors VideoPreviewView.kt's single-ExoPlayer-with-clipped-playlist
// design, but per IOS_PORT_HANDOFF.md §8 this is actually simpler on iOS: AVMutableComposition
// concatenates segments into ONE AVPlayerItem, gapless by construction (no per-item decoder
// teardown/keyframe workarounds the way Android's playlist approach needs).
public final class VideoPreviewView: ExpoView {
  let onProgress = EventDispatcher()
  let onActiveIndexChange = EventDispatcher()
  let onPlayingChange = EventDispatcher()
  let onReady = EventDispatcher()

  private let player = AVPlayer()
  private let playerLayerView = PlayerLayerView()

  private var items: [PreviewItem] = []
  private var clipDurations: [Double] = []
  private var loop = true
  private var paused = false
  private var lastActiveIndex = -1

  private var timeObserver: Any?
  private var endObserver: NSObjectProtocol?
  private var statusObservation: NSKeyValueObservation?
  private var timeControlObservation: NSKeyValueObservation?

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    playerLayerView.playerLayer.player = player
    playerLayerView.playerLayer.videoGravity = .resizeAspect
    addSubview(playerLayerView)

    timeControlObservation = player.observe(\.timeControlStatus, options: [.new]) { [weak self] player, _ in
      let isPlaying = player.timeControlStatus == .playing
      DispatchQueue.main.async {
        self?.onPlayingChange(["isPlaying": isPlaying])
      }
    }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    playerLayerView.frame = bounds
  }

  deinit {
    removeItemObservers()
    if let timeObserver {
      player.removeTimeObserver(timeObserver)
    }
  }

  // MARK: - Props

  func setTimeline(_ newItems: [PreviewItem]) {
    items = newItems
    rebuild(preserveTimeSec: currentGlobalSec())
  }

  func setLoop(_ value: Bool) {
    loop = value
  }

  func setPaused(_ value: Bool) {
    paused = value
    if value {
      player.pause()
    } else {
      player.play()
    }
  }

  // MARK: - Imperative functions (play/pause/seekToTime)

  func playNow() {
    paused = false
    player.play()
  }

  func pauseNow() {
    paused = true
    player.pause()
  }

  func seekToTimeSec(_ sec: Double) {
    let total = clipDurations.reduce(0, +)
    let clamped = max(0, min(sec, total))
    player.seek(to: CMTime(seconds: clamped, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
      self?.emitProgress()
      self?.updateActiveIndex()
    }
  }

  // MARK: - Composition build

  private func currentGlobalSec() -> Double {
    let t = player.currentTime()
    return t.isValid ? max(0, CMTimeGetSeconds(t)) : 0
  }

  private func rebuild(preserveTimeSec: Double) {
    removeItemObservers()
    lastActiveIndex = -1

    guard !items.isEmpty else {
      clipDurations = []
      player.replaceCurrentItem(with: nil)
      return
    }

    let composition = AVMutableComposition()
    guard
      let compVideoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
      let compAudioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
    else {
      return
    }

    let audioParams = AVMutableAudioMixInputParameters(track: compAudioTrack)

    var cursor = CMTime.zero
    var durations: [Double] = []
    var instructions: [AVMutableVideoCompositionInstruction] = []
    // Proxies are rendered to one uniform size (see ProxyTranscoder), so the first segment's
    // display size is representative of the whole timeline in the normal case.
    var renderSize = CGSize(width: 720, height: 1280)
    var haveRenderSize = false

    for seg in items {
      guard let url = URL(string: seg.uri) else { continue }
      let asset = AVURLAsset(url: url)
      let inTime = CMTime(seconds: seg.inSec, preferredTimescale: 600)
      let outTime = CMTime(seconds: max(seg.inSec, seg.outSec), preferredTimescale: 600)
      let range = CMTimeRange(start: inTime, end: outTime)
      guard range.duration.seconds > 0, let sourceVideoTrack = asset.tracks(withMediaType: .video).first else { continue }

      do {
        try compVideoTrack.insertTimeRange(range, of: sourceVideoTrack, at: cursor)
      } catch {
        print("[VideoPreview] Failed to insert segment \(seg.uri): \(error)")
        continue
      }

      let instruction = AVMutableVideoCompositionInstruction()
      instruction.timeRange = CMTimeRange(start: cursor, duration: range.duration)
      let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: compVideoTrack)
      // preferredTransform per segment (not a single composition-wide transform) — sources can
      // differ in orientation even though the common case (proxies) is already uniform.
      layerInstruction.setTransform(sourceVideoTrack.preferredTransform, at: cursor)
      instruction.layerInstructions = [layerInstruction]
      instructions.append(instruction)

      if !haveRenderSize {
        let displayRect = CGRect(origin: .zero, size: sourceVideoTrack.naturalSize).applying(sourceVideoTrack.preferredTransform)
        renderSize = CGSize(width: abs(displayRect.width), height: abs(displayRect.height))
        haveRenderSize = true
      }

      if let sourceAudioTrack = asset.tracks(withMediaType: .audio).first {
        try? compAudioTrack.insertTimeRange(range, of: sourceAudioTrack, at: cursor)
      }
      // Per-segment mute on the one shared composition audio track — holds until the next
      // setVolume call, i.e. for exactly this segment's slice.
      audioParams.setVolume(seg.muted ? 0 : 1, at: cursor)

      durations.append(range.duration.seconds)
      cursor = CMTimeAdd(cursor, range.duration)
    }

    clipDurations = durations
    guard !instructions.isEmpty else {
      player.replaceCurrentItem(with: nil)
      return
    }

    let audioMix = AVMutableAudioMix()
    audioMix.inputParameters = [audioParams]

    let videoComposition = AVMutableVideoComposition()
    videoComposition.instructions = instructions
    videoComposition.renderSize = renderSize
    videoComposition.frameDuration = CMTime(value: 1, timescale: 30)

    let playerItem = AVPlayerItem(asset: composition)
    playerItem.videoComposition = videoComposition
    playerItem.audioMix = audioMix

    statusObservation = playerItem.observe(\.status, options: [.new]) { [weak self] item, _ in
      guard item.status == .readyToPlay else { return }
      DispatchQueue.main.async {
        self?.onReady()
      }
    }

    endObserver = NotificationCenter.default.addObserver(
      forName: .AVPlayerItemDidPlayToEndTime, object: playerItem, queue: .main
    ) { [weak self] _ in
      guard let self, self.loop else { return }
      self.player.seek(to: .zero)
      if !self.paused {
        self.player.play()
      }
    }

    player.replaceCurrentItem(with: playerItem)

    let seekTarget = max(0, min(preserveTimeSec, durations.reduce(0, +)))
    if seekTarget > 0 {
      player.seek(to: CMTime(seconds: seekTarget, preferredTimescale: 600))
    }
    if !paused {
      player.play()
    }

    if timeObserver == nil {
      timeObserver = player.addPeriodicTimeObserver(
        forInterval: CMTime(seconds: 0.1, preferredTimescale: 600), queue: .main
      ) { [weak self] _ in
        self?.emitProgress()
        self?.updateActiveIndex()
      }
    }
  }

  private func emitProgress() {
    let total = clipDurations.reduce(0, +)
    onProgress(["currentSec": currentGlobalSec(), "totalSec": total])
  }

  private func updateActiveIndex() {
    guard !clipDurations.isEmpty else { return }
    let current = currentGlobalSec()
    var acc = 0.0
    var idx = clipDurations.count - 1
    for (i, d) in clipDurations.enumerated() {
      if current < acc + d {
        idx = i
        break
      }
      acc += d
    }
    if idx != lastActiveIndex {
      lastActiveIndex = idx
      onActiveIndexChange(["index": idx])
    }
  }

  private func removeItemObservers() {
    statusObservation = nil
    if let endObserver {
      NotificationCenter.default.removeObserver(endObserver)
    }
    endObserver = nil
  }
}
