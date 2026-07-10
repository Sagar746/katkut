import AVFoundation
import CoreImage
import CoreImage.CIFilterBuiltins
import CoreVideo

// CoreImage equivalent of GlRenderer.kt's shader pipeline. Where Android hand-rolls a 5-pass GL
// blur over small offscreen FBOs for performance, CIGaussianBlur does the same visual job directly
// at full resolution — cheaper here, per IOS_PORT_HANDOFF.md §8. Stateless: every method takes a
// CIImage and returns one, so a single CIContext is safely reused across segments/frames.
enum FrameCompositor {
  static let ciContext = CIContext()

  // Forces AVAssetReader to tone-map HDR (HLG/PQ, common on iPhone footage) down to standard
  // Rec.709 SDR during decode. Left unspecified, HDR source color characteristics can end up
  // mismatched with CIContext's (also unconfigured) default color handling downstream, which
  // shows up as blown-out brightness/exposure — only on clips actually shot in HDR, hence some
  // clips looking wrong and others not. See IOS_PORT_HANDOFF.md §8's HDR/tone-mapping gotcha.
  static let videoReaderOutputSettings: [String: Any] = [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    AVVideoColorPropertiesKey: [
      AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
      AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
      AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
    ],
  ]

  private static let watermarkWidthFraction = 0.16
  private static let watermarkMarginFraction = 0.04
  private static let watermarkOpacity = 0.85

  // preferredTransform is a matrix, not a metadata flag (the iOS gotcha flagged in
  // IOS_PORT_HANDOFF.md §8) — bake it in immediately so every downstream step works in already
  // correctly-oriented, (0,0)-anchored image space, same as Android's post-rotation dw/dh.
  //
  // preferredTransform is authored for a top-left-origin, Y-down space (CGImage/UIKit convention),
  // but CIImage uses Core Image's bottom-left-origin, Y-up Cartesian space. Applying the matrix
  // directly via .transformed(by:) ignores that axis mismatch and inverts the effective rotation
  // (e.g. a portrait clip's ~90° transform comes out mirrored/upside down). Converting to a
  // CGImagePropertyOrientation and using .oriented(_:) — Core Image's own EXIF-orientation API —
  // handles the coordinate-space conversion correctly instead.
  static func orientedImage(pixelBuffer: CVPixelBuffer, transform: CGAffineTransform) -> CIImage {
    let raw = CIImage(cvPixelBuffer: pixelBuffer)
    return raw.oriented(cgOrientation(from: transform))
  }

  static func cgOrientation(from transform: CGAffineTransform) -> CGImagePropertyOrientation {
    switch (transform.a, transform.b, transform.c, transform.d) {
    case (0, 1, -1, 0): return .right
    case (0, -1, 1, 0): return .left
    case (-1, 0, 0, -1): return .down
    default: return .up
    }
  }

  static func normalizedOrigin(_ image: CIImage) -> CIImage {
    let origin = image.extent.origin
    if origin == .zero { return image }
    return image.transformed(by: CGAffineTransform(translationX: -origin.x, y: -origin.y))
  }

  // Mirrors GlRenderer.setCoverCrop: crop to the destination aspect (centered), then the caller
  // scales the result to fill the destination pixel size.
  static func coverCropped(_ image: CIImage, dstAspect: Double) -> CIImage {
    let size = image.extent.size
    guard size.width > 0, size.height > 0 else { return image }
    let srcAspect = Double(size.width / size.height)
    var cropRect: CGRect
    if srcAspect > dstAspect {
      let newWidth = size.height * CGFloat(dstAspect)
      let xOffset = (size.width - newWidth) / 2
      cropRect = CGRect(x: image.extent.minX + xOffset, y: image.extent.minY, width: newWidth, height: size.height)
    } else {
      let newHeight = size.width / CGFloat(dstAspect)
      let yOffset = (size.height - newHeight) / 2
      cropRect = CGRect(x: image.extent.minX, y: image.extent.minY + yOffset, width: size.width, height: newHeight)
    }
    return normalizedOrigin(image.cropped(to: cropRect))
  }

  // Uniformly scale an image (already cropped to the right aspect) to exactly fill dstSize.
  static func scaledToFill(_ image: CIImage, dstSize: CGSize) -> CIImage {
    guard image.extent.width > 0 else { return image }
    let scale = dstSize.width / image.extent.width
    return normalizedOrigin(image.transformed(by: CGAffineTransform(scaleX: scale, y: scale)))
  }

  // Mirrors GlRenderer.setBlurredFill's foreground half: contain-fit (whole frame visible,
  // centered, un-cropped) — the mirror image of cover-crop. Returns the placed image plus the
  // rect it occupies, so the same rect can be reused every frame for Ken Burns cropping.
  static func containFitRect(srcSize: CGSize, dstSize: CGSize) -> CGRect {
    let scale = min(dstSize.width / srcSize.width, dstSize.height / srcSize.height)
    let scaledSize = CGSize(width: srcSize.width * scale, height: srcSize.height * scale)
    let origin = CGPoint(x: (dstSize.width - scaledSize.width) / 2, y: (dstSize.height - scaledSize.height) / 2)
    return CGRect(origin: origin, size: scaledSize)
  }

  static func placed(_ image: CIImage, in rect: CGRect) -> CIImage {
    guard image.extent.width > 0 else { return image }
    let scale = rect.width / image.extent.width
    return image
      .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
      .transformed(by: CGAffineTransform(translationX: rect.minX, y: rect.minY))
  }

  // Mirrors GlRenderer.drawBlurredFillFrame passes 1-4: cover-crop + blur + dark tint, filling
  // the whole canvas as a backdrop for the sharp contain-fit foreground drawn on top of it.
  static func blurredFillBackground(_ image: CIImage, dstSize: CGSize) -> CIImage {
    let dstAspect = Double(dstSize.width / dstSize.height)
    let filled = scaledToFill(coverCropped(image, dstAspect: dstAspect), dstSize: dstSize)

    let blur = CIFilter.gaussianBlur()
    blur.inputImage = filled
    blur.radius = Float(dstSize.width * 0.025)
    let blurred = (blur.outputImage ?? filled).cropped(to: CGRect(origin: .zero, size: dstSize))

    let tint = CIImage(color: CIColor(red: 0, green: 0, blue: 0, alpha: 0.35)).cropped(to: blurred.extent)
    return tint.composited(over: blurred)
  }

  // Mirrors GlRenderer.setWatermark/drawWatermark (HARD RULE 6): top-right corner, width a fixed
  // fraction of canvas width (aspect preserved), equal pixel margin on both edges, faded opacity.
  // In real pixel space (unlike Android's GL NDC) the margin needs no aspect correction — an equal
  // pixel margin is already equal in both axes.
  static func watermarked(_ image: CIImage, watermark: CIImage, dstSize: CGSize) -> CIImage {
    let wmSize = watermark.extent.size
    guard wmSize.width > 0, wmSize.height > 0 else { return image }
    let wmWidth = dstSize.width * watermarkWidthFraction
    let wmHeight = wmWidth * (wmSize.height / wmSize.width)
    let margin = dstSize.width * watermarkMarginFraction
    let origin = CGPoint(x: dstSize.width - margin - wmWidth, y: dstSize.height - margin - wmHeight)

    let positioned = placed(normalizedOrigin(watermark), in: CGRect(origin: origin, size: CGSize(width: wmWidth, height: wmHeight)))
    let faded = positioned.applyingFilter(
      "CIColorMatrix", parameters: ["inputAVector": CIVector(x: 0, y: 0, z: 0, w: watermarkOpacity)]
    )
    return faded.composited(over: image)
  }

  // Ken Burns crop window in the ORIGINAL (uncropped) source's pixel space — mirrors
  // PhotoClipEncoder's buildTexMatrix/buildForegroundTexMatrix, which both sample directly from
  // the full source texture. coverScale is the static cover-crop factor for the cover-fit path
  // (baked in alongside the motion, exactly like Android multiplies coverX*zoom); pass (1,1) for
  // the contain-fit foreground path, which shows the full frame with no additional crop.
  static func kenBurnsCropRect(
    baseSize: CGSize, coverScale: CGSize, motionType: String, amount: Double, t: Double
  ) -> CGRect {
    var zoom = 1.0
    var panU = 0.0
    let tight = 1.0 / (1.0 + amount)
    switch motionType {
    case "zoomIn": zoom = lerp(1.0, tight, t)
    case "zoomOut": zoom = lerp(tight, 1.0, t)
    case "panLR":
      zoom = tight
      panU = lerp(amount * 0.5, -amount * 0.5, t)
    case "panRL":
      zoom = tight
      panU = lerp(-amount * 0.5, amount * 0.5, t)
    default: break
    }
    let cropW = baseSize.width * coverScale.width * zoom
    let cropH = baseSize.height * coverScale.height * zoom
    let centerX = baseSize.width * (0.5 + panU)
    let centerY = baseSize.height * 0.5
    return CGRect(x: centerX - cropW / 2, y: centerY - cropH / 2, width: cropW, height: cropH)
  }

  // Static cover-crop scale factors (no motion) — used for the blurred-fill backdrop, which never
  // moves; only the sharp foreground carries the Ken Burns motion (same split as Android).
  static func coverScale(srcAspect: Double, dstAspect: Double) -> CGSize {
    srcAspect > dstAspect
      ? CGSize(width: dstAspect / srcAspect, height: 1)
      : CGSize(width: 1, height: srcAspect / dstAspect)
  }

  static func lerp(_ a: Double, _ b: Double, _ t: Double) -> Double { a + (b - a) * t }

  static func render(_ image: CIImage, to pixelBuffer: CVPixelBuffer) {
    ciContext.render(image, to: pixelBuffer)
  }

  static func loadWatermark() -> CIImage? {
    guard
      let bundleURL = Bundle(for: VideoAssemblerModule.self)
        .url(forResource: "VideoAssemblerResources", withExtension: "bundle"),
      let bundle = Bundle(url: bundleURL),
      let imageURL = bundle.url(forResource: "watermark", withExtension: "png"),
      let image = CIImage(contentsOf: imageURL)
    else {
      return nil
    }
    return normalizedOrigin(image)
  }
}
