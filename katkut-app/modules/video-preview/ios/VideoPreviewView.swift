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

    // BUG FIX: without an explicit category, AVPlayer's audio runs under the implicit default
    // (.soloAmbient), which iOS silences whenever the hardware ring/silent switch is set to
    // silent. That made preview/editor playback appear to have "no audio" while export (which
    // encodes samples to a file rather than routing them through the audio session) was
    // unaffected — exactly the reported split. .playback ignores the silent switch, matching how
    // a video editor's preview is expected to behave, and matches Android (which has no
    // equivalent silent-switch muting).
    try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
    try? AVAudioSession.sharedInstance().setActive(true)

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

    var cursor = CMTime.zero
    var durations: [Double] = []
    var instructions: [AVMutableVideoCompositionInstruction] = []
    // BUG FIX: this used to start as this fallback value but then get overwritten by the FIRST
    // segment's own displaySize on its first iteration (`if !haveRenderSize { renderSize =
    // displaySize }`) — so if that first segment happened to be a raw landscape/square fallback
    // source (reopened draft, proxies not persisted, see OVERVIEW.md B5), the ENTIRE canvas
    // became landscape-shaped, corrupting the scale/position of every OTHER segment in the same
    // timeline too, including normal vertical proxies. Fixed to ProxyTranscoder's actual output
    // size (see ProxyTranscoder.swift outW/outH) so every segment always scales against the same
    // stable, known-vertical canvas regardless of what the first clip happens to be.
    let renderSize = CGSize(width: 720, height: 1280)

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

      // preferredTransform-oriented display rect for THIS segment, used to scale it against the
      // fixed renderSize above.
      let displayRect = CGRect(origin: .zero, size: sourceVideoTrack.naturalSize).applying(sourceVideoTrack.preferredTransform)
      let displaySize = CGSize(width: abs(displayRect.width), height: abs(displayRect.height))

      let instruction = AVMutableVideoCompositionInstruction()
      instruction.timeRange = CMTimeRange(start: cursor, duration: range.duration)
      let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: compVideoTrack)
      // preferredTransform per segment (not a single composition-wide transform) — sources can
      // differ in orientation even though the common case (proxies) is already uniform.
      //
      // BUG FIX: preferredTransform alone only rotates a segment into its oriented space — it
      // never scales. Uniform proxies (the common case: ProxyTranscoder renders every clip to
      // 720x1280, with blurred-fill already baked into the pixels for landscape/square sources
      // per HARD RULE 2) happen to already match renderSize, so this was invisible in normal use.
      // But when a saved draft is reopened, proxies aren't persisted (OVERVIEW.md B5) and playback
      // falls back to full-resolution originals of whatever size/orientation the source camera
      // shot — without a scale factor, a segment whose native size differs from the fixed
      // renderSize renders at raw 1:1 pixel scale instead of filling the frame.
      //
      // Cover-fit vs contain-fit must match the SAME srcAspect > dstAspect decision
      // ProxyTranscoder/FrameCompositor use for HARD RULE 2: a vertical source should cover-fit
      // (fill edge to edge), but a landscape/square source must contain-fit (show the full frame,
      // never cropped) — unconditional cover-fit was cropping landscape originals tight enough to
      // read as "zoomed in". This still bakes blur into the empty space only via the proxy path;
      // this raw-source fallback letterboxes (black bars) instead — a real fix for the "zoomed in"
      // complaint, short of a full custom AVVideoCompositing blur pass for this fallback case.
      let srcAspect = displaySize.width / displaySize.height
      let dstAspect = renderSize.width / renderSize.height
      let scale = srcAspect > dstAspect
        ? min(renderSize.width / displaySize.width, renderSize.height / displaySize.height)
        : max(renderSize.width / displaySize.width, renderSize.height / displaySize.height)
      let scaledSize = CGSize(width: displaySize.width * scale, height: displaySize.height * scale)
      let tx = (renderSize.width - scaledSize.width) / 2
      let ty = (renderSize.height - scaledSize.height) / 2
      let transform = sourceVideoTrack.preferredTransform
        // normalize into (0,0)-anchored oriented space first — preferredTransform can rotate
        // content to a negative origin depending on the rotation, which scaling must not carry
        // through as an unintended additional offset
        .concatenating(CGAffineTransform(translationX: -displayRect.minX, y: -displayRect.minY))
        .concatenating(CGAffineTransform(scaleX: scale, y: scale))
        .concatenating(CGAffineTransform(translationX: tx, y: ty))
      layerInstruction.setTransform(transform, at: cursor)
      instruction.layerInstructions = [layerInstruction]
      instructions.append(instruction)

      // BUG FIX: this used to always insert the segment's audio and rely on
      // AVMutableAudioMixInputParameters.setVolume(at:) keyframes (set exactly at each segment's
      // cursor boundary — the same instant as its insertTimeRange edit point) to mute it. In
      // practice this was unreliable: muted clips kept playing audio in the editor/Preview even
      // though the mute icon correctly showed muted, while export (a separate PCM-based muting
      // path, see PCMAudioBuilder.swift) was unaffected and always correct. Skipping the audio
      // insertion entirely for a muted segment leaves that time range as a genuine gap in the
      // composition's audio track, which AVFoundation plays back as unconditional silence — no
      // volume keyframe timing to get wrong.
      if !seg.muted, let sourceAudioTrack = asset.tracks(withMediaType: .audio).first {
        try? compAudioTrack.insertTimeRange(range, of: sourceAudioTrack, at: cursor)
      }

      durations.append(range.duration.seconds)
      cursor = CMTimeAdd(cursor, range.duration)
    }

    clipDurations = durations
    guard !instructions.isEmpty else {
      player.replaceCurrentItem(with: nil)
      return
    }

    let videoComposition = AVMutableVideoComposition()
    videoComposition.instructions = instructions
    videoComposition.renderSize = renderSize
    videoComposition.frameDuration = CMTime(value: 1, timescale: 30)

    let playerItem = AVPlayerItem(asset: composition)
    playerItem.videoComposition = videoComposition

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
