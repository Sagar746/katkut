import ExpoModulesCore

public class VideoPreviewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VideoPreview")

    View(VideoPreviewView.self) {
      Events("onProgress", "onActiveIndexChange", "onPlayingChange", "onReady")

      Prop("timeline") { (view: VideoPreviewView, items: [PreviewItemRecord]) in
        view.setTimeline(
          items.map { PreviewItem(uri: $0.uri, inSec: $0.inSec, outSec: $0.outSec, muted: $0.muted) }
        )
      }
      Prop("loop") { (view: VideoPreviewView, value: Bool) in view.setLoop(value) }
      Prop("paused") { (view: VideoPreviewView, value: Bool) in view.setPaused(value) }

      AsyncFunction("play") { (view: VideoPreviewView) in view.playNow() }
      AsyncFunction("pause") { (view: VideoPreviewView) in view.pauseNow() }
      AsyncFunction("seekToTime") { (view: VideoPreviewView, sec: Double) in view.seekToTimeSec(sec) }
    }
  }
}
