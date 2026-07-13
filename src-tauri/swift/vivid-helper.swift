// vivid-helper — small macOS helper exposing Apple framework features to the
// Vivid Rust backend over a simple "subcommand + JSON on stdout" contract.
//
// Subcommands:
//   ocr <imagePath>                          → {"text": "..."}    (Vision text recognition)
//   frame <videoPath> <outPath>               → {"ok": true}       (poster frame → JPEG)
//   audiocover <audioPath> <outPath>          → {"ok": true}       (embedded picture track → JPEG)
//   trim <srcPath> <destPath> <start> <end> [maxHeight] → {"ok": true} (time-range export → MP4)
//   gif <srcPath> <destPath> <start> <end> [maxHeight] → {"ok": true, "frames": N} (time-range → animated GIF)
//
// All video/audio work here goes through AVFoundation/ImageIO — no ffmpeg or
// any other external process. AVFoundation only demuxes Apple's own container
// family (mp4/mov/m4v/3gp); wmv/avi/flv/mkv aren't supported by any subcommand
// here and never will be without an external demuxer, which is a deliberate
// scope boundary, not an oversight — see the Rust-side get_playable_video_path
// for how that's handled as a fully optional ffmpeg fallback.
//
// Designed so future subcommands (faces, geocode) can be added behind the same
// binary without changing the invocation pattern on the Rust side.

import Foundation
import Vision
import CoreImage
import ImageIO
import AVFoundation
import CoreMedia

// Print a JSON object to stdout and exit.
func emit(_ object: [String: Any]) -> Never {
    if let data = try? JSONSerialization.data(withJSONObject: object, options: []),
       let str = String(data: data, encoding: .utf8) {
        print(str)
    } else {
        print("{}")
    }
    exit(0)
}

func fail(_ message: String) -> Never {
    // Errors go to stderr; stdout stays clean JSON-or-nothing.
    FileHandle.standardError.write((message + "\n").data(using: .utf8) ?? Data())
    exit(1)
}

// Load a CGImage from any path ImageIO can decode (jpeg/png/heic/tiff/…).
func loadCGImage(_ path: String) -> CGImage? {
    let url = URL(fileURLWithPath: path)
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(src, 0, nil)
}

func runOCR(_ path: String) -> Never {
    guard let cgImage = loadCGImage(path) else { fail("Could not load image: \(path)") }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    do {
        try handler.perform([request])
    } catch {
        fail("Vision request failed: \(error)")
    }

    var lines: [String] = []
    if let results = request.results {
        for observation in results {
            if let candidate = observation.topCandidates(1).first {
                lines.append(candidate.string)
            }
        }
    }
    emit(["text": lines.joined(separator: "\n")])
}

// ── Video/image helpers ──────────────────────────────────────────────────────

@discardableResult
func writeJPEG(_ image: CGImage, to path: String, quality: CGFloat = 0.88) -> Bool {
    try? FileManager.default.removeItem(atPath: path)
    let url = URL(fileURLWithPath: path)
    guard let dest = CGImageDestinationCreateWithURL(url as CFURL, "public.jpeg" as CFString, 1, nil) else {
        return false
    }
    CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
    return CGImageDestinationFinalize(dest)
}

// Downscale (never upscale) to at most `maxHeight` tall, preserving aspect
// ratio — matches the conventional "Xp" video resolution naming (e.g. 1080p
// = 1080 lines tall, however wide that makes it), not a width cap.
func scaleDown(_ image: CGImage, maxHeight: CGFloat) -> CGImage {
    let h = CGFloat(image.height)
    guard h > maxHeight else { return image }
    let scale = maxHeight / h
    let newW = max(1, Int(CGFloat(image.width) * scale))
    let newH = max(1, Int(h * scale))
    guard let ctx = CGContext(
        data: nil, width: newW, height: newH,
        bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return image }
    ctx.interpolationQuality = .high
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: newW, height: newH))
    return ctx.makeImage() ?? image
}

// Extract a poster frame from a video. Tries 5s first (past typical intros/
// black frames), falls back to 0s for clips shorter than that.
func extractFrame(_ videoPath: String, _ outPath: String) -> Never {
    let asset = AVURLAsset(url: URL(fileURLWithPath: videoPath))
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.requestedTimeToleranceBefore = .zero
    generator.requestedTimeToleranceAfter = .zero

    let durationSeconds = CMTimeGetSeconds(asset.duration)
    let candidates: [Double] = durationSeconds.isFinite && durationSeconds > 5 ? [5, 0] : [0]

    for t in candidates {
        let time = CMTime(seconds: t, preferredTimescale: 600)
        if let cgImage = try? generator.copyCGImage(at: time, actualTime: nil), writeJPEG(cgImage, to: outPath) {
            emit(["ok": true])
        }
    }
    fail("could not extract a frame from \(videoPath)")
}

// Pull the first frame of an audio file's embedded picture/video track (some
// containers carry cover art this way rather than as a tag). `Ok(None)`-style
// "no cover" is signaled by a non-zero exit — the Rust caller already treats
// any failure here as "no artwork", not an error.
func extractAudioCover(_ audioPath: String, _ outPath: String) -> Never {
    let asset = AVURLAsset(url: URL(fileURLWithPath: audioPath))
    guard !asset.tracks(withMediaType: .video).isEmpty else {
        fail("no embedded picture/video track")
    }
    let generator = AVAssetImageGenerator(asset: asset)
    guard let cgImage = try? generator.copyCGImage(at: .zero, actualTime: nil) else {
        fail("could not read the embedded picture track")
    }
    guard writeJPEG(cgImage, to: outPath) else { fail("failed to write cover image") }
    emit(["ok": true])
}

// Export `[start, end]` of srcPath to destPath as MP4. When `maxHeight` is
// nil or the source's rendered height already fits, tries Passthrough first
// (re-multiplex only, no re-encode — fast and lossless, and AVFoundation's
// trimming is sample-accurate unlike a keyframe-snapped `ffmpeg -c copy`),
// falling back to a re-encoding preset if the source/preset combo can't
// produce MP4 via passthrough. When downscaling is needed, passthrough is
// skipped entirely (it can't resize) and a video composition scales every
// frame via Core Image — `request.sourceImage` there is already corrected
// for the track's preferredTransform, so rotated (e.g. portrait phone)
// source video scales correctly without any manual transform math.
func trimVideo(_ srcPath: String, _ destPath: String, _ start: Double, _ end: Double, _ maxHeight: CGFloat?) -> Never {
    guard end > start else { fail("end must be after start") }
    let asset = AVURLAsset(url: URL(fileURLWithPath: srcPath))
    let destURL = URL(fileURLWithPath: destPath)
    let timeRange = CMTimeRange(
        start: CMTime(seconds: start, preferredTimescale: 600),
        end: CMTime(seconds: end, preferredTimescale: 600)
    )

    var videoComposition: AVMutableVideoComposition? = nil
    if let maxHeight = maxHeight, let track = asset.tracks(withMediaType: .video).first {
        let natural = track.naturalSize.applying(track.preferredTransform)
        let renderW = abs(natural.width)
        let renderH = abs(natural.height)
        if renderH > maxHeight {
            let scale = maxHeight / renderH
            let outSize = CGSize(
                width: (renderW * scale).rounded(.down),
                height: (renderH * scale).rounded(.down)
            )
            let composition = AVMutableVideoComposition(asset: asset) { request in
                let scaled = request.sourceImage.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
                request.finish(with: scaled, context: nil)
            }
            composition.renderSize = outSize
            videoComposition = composition
        }
    }

    var lastError = "no compatible export preset for this source"
    let presets: [String] = videoComposition == nil
        ? [AVAssetExportPresetPassthrough, AVAssetExportPresetHighestQuality]
        : [AVAssetExportPresetHighestQuality]
    for preset in presets {
        guard let session = AVAssetExportSession(asset: asset, presetName: preset) else { continue }
        guard session.supportedFileTypes.contains(.mp4) else { continue }
        try? FileManager.default.removeItem(at: destURL)
        session.outputURL = destURL
        session.outputFileType = .mp4
        session.timeRange = timeRange
        if let videoComposition = videoComposition {
            session.videoComposition = videoComposition
        }

        let sem = DispatchSemaphore(value: 0)
        session.exportAsynchronously { sem.signal() }
        sem.wait()

        if session.status == .completed {
            emit(["ok": true])
        }
        lastError = session.error?.localizedDescription ?? "export did not complete"
        try? FileManager.default.removeItem(at: destURL)
    }
    fail("trim failed: \(lastError)")
}

// Export `[start, end]` of srcPath as an animated GIF at destPath. Frames are
// sampled at 12fps and downscaled to at most `maxHeight` pixels tall (never
// upscaled), assembled via ImageIO's GIF writer — no external tool.
func exportGif(_ srcPath: String, _ destPath: String, _ start: Double, _ end: Double, _ maxHeight: CGFloat) -> Never {
    guard end > start else { fail("end must be after start") }
    let asset = AVURLAsset(url: URL(fileURLWithPath: srcPath))
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.requestedTimeToleranceBefore = .zero
    generator.requestedTimeToleranceAfter = .zero

    let fps = 12.0
    let frameDuration = 1.0 / fps
    var times: [CMTime] = []
    var t = start
    while t < end {
        times.append(CMTime(seconds: t, preferredTimescale: 600))
        t += frameDuration
    }
    guard !times.isEmpty else { fail("empty time range") }

    try? FileManager.default.removeItem(atPath: destPath)
    let destURL = URL(fileURLWithPath: destPath)
    guard let dest = CGImageDestinationCreateWithURL(destURL as CFURL, "com.compuserve.gif" as CFString, times.count, nil) else {
        fail("could not create GIF destination")
    }
    CGImageDestinationSetProperties(dest, [
        kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0],
    ] as CFDictionary)
    let frameProps: CFDictionary = [
        kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: frameDuration],
    ] as CFDictionary

    var count = 0
    for time in times {
        guard let cg = try? generator.copyCGImage(at: time, actualTime: nil) else { continue }
        CGImageDestinationAddImage(dest, scaleDown(cg, maxHeight: maxHeight), frameProps)
        count += 1
    }
    guard count > 0 else { fail("no frames could be extracted") }
    guard CGImageDestinationFinalize(dest) else { fail("failed to write GIF") }
    emit(["ok": true, "frames": count])
}

// ── Entry point ────────────────────────────────────────────────────────────────
let args = CommandLine.arguments
guard args.count >= 2 else { fail("usage: vivid-helper <subcommand> [args]") }

switch args[1] {
case "ocr":
    guard args.count >= 3 else { fail("usage: vivid-helper ocr <imagePath>") }
    runOCR(args[2])
case "frame":
    guard args.count >= 4 else { fail("usage: vivid-helper frame <videoPath> <outPath>") }
    extractFrame(args[2], args[3])
case "audiocover":
    guard args.count >= 4 else { fail("usage: vivid-helper audiocover <audioPath> <outPath>") }
    extractAudioCover(args[2], args[3])
case "trim":
    guard args.count >= 6, let start = Double(args[4]), let end = Double(args[5]) else {
        fail("usage: vivid-helper trim <srcPath> <destPath> <start> <end> [maxHeight]")
    }
    var trimMaxHeight: CGFloat? = nil
    if args.count >= 7, let parsed = Double(args[6]) {
        trimMaxHeight = CGFloat(parsed)
    }
    trimVideo(args[2], args[3], start, end, trimMaxHeight)
case "gif":
    guard args.count >= 6, let start = Double(args[4]), let end = Double(args[5]) else {
        fail("usage: vivid-helper gif <srcPath> <destPath> <start> <end> [maxHeight]")
    }
    var maxHeight: CGFloat = 720
    if args.count >= 7, let parsed = Double(args[6]) {
        maxHeight = CGFloat(parsed)
    }
    exportGif(args[2], args[3], start, end, maxHeight)
default:
    fail("unknown subcommand: \(args[1])")
}
