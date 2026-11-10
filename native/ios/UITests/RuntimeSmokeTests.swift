import XCTest

final class RuntimeSmokeTests: XCTestCase {
    func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
    func testEmptyNotebookAddRevealReview() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.orunvoca.app")
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["오프라인 단어장"].waitForExistence(timeout: 20))
        capture("iPhone-online-first-screen")
        app.tabBars.buttons["오프라인 단어장"].tap()
        XCTAssertTrue(app.staticTexts["나만의 단어장을 만들어 보세요"].waitForExistence(timeout: 10))
        capture("iPhone-empty-native-notebook")
        app.buttons["단어 추가"].tap()
        let word = app.textFields["예: discover"]
        XCTAssertTrue(word.waitForExistence(timeout: 5))
        word.tap(); word.typeText("smoketest")
        let meaning = app.descendants(matching: .any).matching(identifier: "native-card-meaning").firstMatch
        XCTAssertTrue(meaning.exists)
        meaning.tap(); meaning.typeText("local test only")
        app.buttons["저장"].tap()
        XCTAssertTrue(app.staticTexts["smoketest"].waitForExistence(timeout: 5))
        capture("iPhone-added-native-card")
        app.buttons["오늘의 복습 시작"].tap()
        XCTAssertTrue(app.buttons["뜻 확인하기"].waitForExistence(timeout: 5))
        app.buttons["뜻 확인하기"].tap()
        XCTAssertTrue(app.staticTexts["local test only"].exists)
        capture("iPhone-revealed-native-card")
        app.buttons["기억나요 · 다음 복습으로"].tap()
        XCTAssertTrue(app.staticTexts["오늘의 복습을 마쳤어요"].waitForExistence(timeout: 5))
        capture("iPhone-review-completed")
        app.buttons["단어장으로"].tap()
        app.terminate(); app.launch()
        app.tabBars.buttons["오프라인 단어장"].tap()
        XCTAssertTrue(app.staticTexts["smoketest"].waitForExistence(timeout: 5))
        capture("iPhone-persisted-native-card")
    }
}
