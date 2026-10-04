import CoreGraphics
import XCTest
@testable import HodeyCore

final class NameMatcherTests: XCTestCase {
    func testIgnoresCaseAndSurroundingSpace() {
        XCTAssertTrue(NameMatcher.matches(pattern: "Settings", name: "  settings "))
        XCTAssertFalse(NameMatcher.matches(pattern: "Settings", name: "Settings & Privacy"))
    }

    func testWildcardMatchesAnyRun() {
        XCTAssertTrue(NameMatcher.matches(pattern: "Display*Brightness", name: "Display & Brightness"))
        XCTAssertTrue(NameMatcher.matches(pattern: "*Add New Wallpaper*", name: "+ Add New Wallpaper"))
        XCTAssertFalse(NameMatcher.matches(pattern: "Display*Brightness", name: "Display"))
    }

    func testRegexCharactersInNamesAreLiteral() {
        XCTAssertTrue(NameMatcher.matches(pattern: "Wi-Fi (2.4)", name: "wi-fi (2.4)"))
        XCTAssertFalse(NameMatcher.matches(pattern: "a.c", name: "abc"))
    }
}

final class VisionBoxTests: XCTestCase {
    func testFlipsBottomLeftNormalizedBoxToTopLeftPixels() {
        let size = CGSize(width: 1000, height: 2000)
        let normalized = CGRect(x: 0.1, y: 0.75, width: 0.2, height: 0.05)
        let pixels = VisionBox.toPixels(normalized: normalized, imageSize: size)
        XCTAssertEqual(pixels.minX, 100, accuracy: 0.001)
        XCTAssertEqual(pixels.minY, 400, accuracy: 0.001)
        XCTAssertEqual(pixels.width, 200, accuracy: 0.001)
        XCTAssertEqual(pixels.height, 100, accuracy: 0.001)
    }
}

final class GuideGeometryTests: XCTestCase {
    let frame = CGSize(width: 1179, height: 2556)
    let aspect: CGFloat = 3.0 / 4.0

    func testCropIsCentredOnTheTargetWithTheRequestedAspect() {
        let target = CGRect(x: 500, y: 1200, width: 180, height: 60)
        let crop = GuideGeometry.focusCrop(target: target, frame: frame, aspect: aspect, padding: 3)
        XCTAssertEqual(crop.width / crop.height, aspect, accuracy: 0.001)
        XCTAssertEqual(crop.midX, target.midX, accuracy: 0.5)
        XCTAssertEqual(crop.midY, target.midY, accuracy: 0.5)
        XCTAssertTrue(crop.contains(target))
    }

    func testCropNearACornerStaysInsideTheFrame() {
        let target = CGRect(x: 10, y: 2500, width: 120, height: 40)
        let crop = GuideGeometry.focusCrop(target: target, frame: frame, aspect: aspect, padding: 3)
        XCTAssertTrue(CGRect(origin: .zero, size: frame).contains(crop))
        XCTAssertTrue(crop.contains(target))
    }

    func testHugeTargetFallsBackToTheWholeFrameWidth() {
        let target = CGRect(x: 0, y: 0, width: 1179, height: 2556)
        let crop = GuideGeometry.focusCrop(target: target, frame: frame, aspect: aspect, padding: 3)
        XCTAssertTrue(CGRect(origin: .zero, size: frame).contains(crop))
        XCTAssertEqual(crop.width / crop.height, aspect, accuracy: 0.001)
    }

    func testMapsAFrameRectIntoTheOutput() {
        let crop = CGRect(x: 100, y: 200, width: 300, height: 400)
        let output = CGSize(width: 600, height: 800)
        let mapped = GuideGeometry.map(CGRect(x: 250, y: 400, width: 30, height: 20), from: crop, to: output)
        XCTAssertEqual(mapped, CGRect(x: 300, y: 400, width: 60, height: 40))
    }
}
