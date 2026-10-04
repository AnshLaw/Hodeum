import CoreVideo
import HodeyCore
import Vision

/// One line of text Hodey read on the screen, in frame pixels (top-left origin).
struct ScreenText {
    let text: String
    let rect: CGRect
}

/// On-device OCR (Apple Vision). Frames never leave the phone.
enum TextReader {
    struct Result {
        let lines: [ScreenText]
        /// Where `name` is, narrowed to the word itself when it shares a line with other labels.
        let target: CGRect?
    }

    static func read(_ frame: CVPixelBuffer, looking name: String) throws -> Result {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        request.recognitionLanguages = ["en-US"]
        try VNImageRequestHandler(cvPixelBuffer: frame, orientation: .up, options: [:]).perform([request])
        let size = CGSize(width: CVPixelBufferGetWidth(frame), height: CVPixelBufferGetHeight(frame))
        let observations = request.results ?? []
        let lines = observations.compactMap { observation -> ScreenText? in
            guard let top = observation.topCandidates(1).first else { return nil }
            return ScreenText(text: top.string, rect: VisionBox.toPixels(normalized: observation.boundingBox, imageSize: size))
        }
        return Result(lines: lines, target: locate(name, in: observations, size: size))
    }

    private static func locate(_ name: String, in observations: [VNRecognizedTextObservation], size: CGSize) -> CGRect? {
        for observation in observations {
            guard let top = observation.topCandidates(1).first else { continue }
            if NameMatcher.matches(pattern: name, name: top.string) {
                return VisionBox.toPixels(normalized: observation.boundingBox, imageSize: size)
            }
            if let range = top.string.range(of: name, options: .caseInsensitive),
               let box = try? top.boundingBox(for: range) {
                return VisionBox.toPixels(normalized: box.boundingBox, imageSize: size)
            }
        }
        return nil
    }
}
