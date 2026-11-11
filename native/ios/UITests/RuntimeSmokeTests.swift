import XCTest
import UIKit

final class RuntimeSmokeTests: XCTestCase {
    private var devicePrefix: String { UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone" }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "\(devicePrefix)-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func assertLabel(_ app: XCUIApplication, id: String, equals expected: String,
                             file: StaticString = #filePath, line: UInt = #line) {
        let element = app.staticTexts[id]
        XCTAssertTrue(element.waitForExistence(timeout: 10), "Missing \(id)", file: file, line: line)
        XCTAssertEqual(element.label, expected, file: file, line: line)
    }

    private func addCard(_ app: XCUIApplication, word: String, meaning: String) {
        app.buttons["단어 추가"].tap()
        let wordField = app.textFields["예: discover"]
        XCTAssertTrue(wordField.waitForExistence(timeout: 5))
        wordField.tap()
        wordField.typeText(word)
        // The multiline SwiftUI field may be exposed as a text field or text view.
        let meaningField = app.descendants(matching: .any).matching(identifier: "native-card-meaning").firstMatch
        XCTAssertTrue(meaningField.waitForExistence(timeout: 5))
        meaningField.tap()
        meaningField.typeText(meaning)
        app.buttons["저장"].tap()
        XCTAssertTrue(app.staticTexts[word].waitForExistence(timeout: 5))
    }

    private func reviewCard(_ app: XCUIApplication, word: String, meaning: String, progress: String) {
        assertLabel(app, id: "native-review-progress", equals: progress)
        XCTAssertTrue(app.staticTexts[word].exists, "The immutable queue must present every card in order")
        let reveal = app.buttons["뜻 확인하기"]
        XCTAssertTrue(reveal.waitForExistence(timeout: 5))
        reveal.tap()
        XCTAssertTrue(app.staticTexts[meaning].waitForExistence(timeout: 5))
        capture("revealed-\(word)")
        app.buttons["기억나요 · 다음 복습으로"].tap()
    }

    private func assertCompletion(_ app: XCUIApplication, count: Int) {
        XCTAssertTrue(app.staticTexts["오늘의 복습을 마쳤어요"].waitForExistence(timeout: 10))
        let description = "총 \(count)개를 복습했어요. 어려운 단어는 10분 뒤, 기억한 단어는 1일 이후 다시 만나요."
        assertLabel(app, id: "native-review-summary", equals: description)
        XCTAssertFalse(app.staticTexts["native-review-summary"].label.contains("총 0개"))
        XCTAssertFalse(app.buttons["뜻 확인하기"].exists)
        capture("review-completed-\(count)")
        app.buttons["단어장으로"].tap()
    }

    // One launch/test runner covers empty state, exact counts, queue shrink regression and persistence.
    func testEmptyNotebookAddRevealReview() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.orunvoca.app")
        app.launch()
        // iPad presents native tabs as top-level buttons, not descendants of a TabBar.
        // The captured iPad AX hierarchy contains nested duplicate buttons: firstMatch is intentional.
        let offlineTab = app.buttons.matching(identifier: "오프라인 단어장").firstMatch
        XCTAssertTrue(offlineTab.waitForExistence(timeout: 30))
        capture("online-first-screen")
        offlineTab.tap()
        XCTAssertTrue(app.staticTexts["나만의 단어장을 만들어 보세요"].waitForExistence(timeout: 10))
        capture("empty-native-notebook")

        addCard(app, word: "smokealpha", meaning: "first local hint")
        assertLabel(app, id: "native-notebook-summary", equals: "단어 1개 · 지금 복습 1개")
        capture("added-native-card")
        app.buttons["오늘의 복습 시작"].tap()
        reviewCard(app, word: "smokealpha", meaning: "first local hint", progress: "1 / 1")
        assertCompletion(app, count: 1)
        assertLabel(app, id: "native-notebook-summary", equals: "단어 1개 · 지금 복습 0개")

        // The reviewed first card is no longer due. Both new cards must still be reviewed,
        // even though marking the first remembered shrinks NotebookStore.dueCards.
        addCard(app, word: "smokebeta", meaning: "second local hint")
        addCard(app, word: "smokegamma", meaning: "third local hint")
        assertLabel(app, id: "native-notebook-summary", equals: "단어 3개 · 지금 복습 2개")
        app.buttons["오늘의 복습 시작"].tap()
        reviewCard(app, word: "smokebeta", meaning: "second local hint", progress: "1 / 2")
        reviewCard(app, word: "smokegamma", meaning: "third local hint", progress: "2 / 2")
        assertCompletion(app, count: 2)
        assertLabel(app, id: "native-notebook-summary", equals: "단어 3개 · 지금 복습 0개")

        app.terminate()
        app.launch()
        XCTAssertTrue(offlineTab.waitForExistence(timeout: 20))
        offlineTab.tap()
        assertLabel(app, id: "native-notebook-summary", equals: "단어 3개 · 지금 복습 0개")
        for word in ["smokealpha", "smokebeta", "smokegamma"] {
            XCTAssertTrue(app.staticTexts[word].exists, "Persisted card missing: \(word)")
        }
        XCTAssertFalse(app.buttons["오늘의 복습 시작"].isEnabled)
        capture("persisted-native-cards")
    }
}
