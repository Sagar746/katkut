package com.katkut.mediaprobe

import android.media.MediaMetadataRetriever
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.FileNotFoundException

class MediaProbeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MediaProbe")

    AsyncFunction("probe") { uri: String ->
      val retriever = MediaMetadataRetriever()
      try {
        retriever.setDataSource(appContext.reactContext, android.net.Uri.parse(uri))

        val durationMs = retriever
          .extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
          ?.toLongOrNull() ?: 0L
        val width = retriever
          .extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)
          ?.toIntOrNull() ?: 0
        val height = retriever
          .extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)
          ?.toIntOrNull() ?: 0
        val rotation = retriever
          .extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)
          ?.toIntOrNull() ?: 0

        mapOf(
          "durationMs" to durationMs,
          "width" to width,
          "height" to height,
          "rotation" to rotation
        )
      } catch (e: FileNotFoundException) {
        throw MediaProbeException("File not found: $uri", e)
      } finally {
        retriever.release()
      }
    }
  }
}

class MediaProbeException(message: String, cause: Throwable) :
  expo.modules.kotlin.exception.CodedException(message, cause)
