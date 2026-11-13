import XCTest
import UIKit

// Simulator runtime smoke for the online-only shell and the native pronunciation bridge.
// Runs on CI iOS Simulator VMs, not physical devices. Never logs in, types into, submits,
// creates, saves or deletes anything on the website; only the public login page is loaded.
final class RuntimeSmokeTests: XCTestCase {
    private var devicePrefix: String { UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone" }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "\(devicePrefix)-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func attachHierarchy(_ app: XCUIApplication, _ name: String) {
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "\(devicePrefix)-\(name)-hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
    }

    private func webText(_ app: XCUIApplication, matching regex: String) -> XCUIElement {
        app.webViews.firstMatch.descendants(matching: .any)
            .matching(NSPredicate(format: "label MATCHES %@", regex)).firstMatch
    }

    /// Waits for live public login-page content from the real WKWebView document.
    private func waitForOnlineLoginPage(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let heading = app.webViews.firstMatch.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "액세스 코드")).firstMatch
        let ready = heading.waitForExistence(timeout: 90)
        if !ready { capture("online-load-failed"); attachHierarchy(app, "online-load-failed") }
        XCTAssertTrue(ready, "The live public login page must finish loading in WKWebView", file: file, line: line)
    }

    /// Waits for the exact QA status line; on failure reports the actual line verbatim.
    private func expectStatus(_ app: XCUIApplication, id: String, pass: String, any: String, timeout: TimeInterval,
                              file: StaticString = #filePath, line: UInt = #line) {
        let ok = webText(app, matching: pass).waitForExistence(timeout: timeout)
        if !ok {
            let actual = webText(app, matching: any)
            capture("qa-\(id)-failed"); attachHierarchy(app, "qa-\(id)-failed")
            XCTFail("Expected \(id) /\(pass)/; actual: \(actual.exists ? actual.label : "missing")", file: file, line: line)
        }
    }

    private func tapWebButton(_ app: XCUIApplication, _ label: String, file: StaticString = #filePath, line: UInt = #line) {
        let button = app.webViews.firstMatch.buttons[label]
        XCTAssertTrue(button.waitForExistence(timeout: 10), "Missing QA button \(label)", file: file, line: line)
        button.tap() // Real synthesized touch: WebKit dispatches isTrusted pointer/click events.
    }

    func testOnlineLaunchWithoutNotebookOrTabs() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.orunvoca.app")
        app.launch()
        waitForOnlineLoginPage(app)
        XCTAssertEqual(app.tabBars.count, 0, "Online-only shell must not show a tab bar")
        for removed in ["오프라인 단어장", "단어 추가", "TSV 가져오기", "TSV 내보내기", "오늘의 복습 시작"] {
            XCTAssertFalse(app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", removed)).firstMatch.exists,
                           "Removed notebook UI is present: \(removed)")
        }
        // Without --qa-pronunciation even the QA build must not inject the test fixture.
        XCTAssertFalse(webText(app, matching: "QA SMOKE.*").exists, "QA fixture must require the explicit launch argument")
        capture("online-login-no-tabs")
    }

    func testPronunciationBridgeNativeCompletion() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.orunvoca.app")
        app.launchArguments = ["--qa-pronunciation"]
        app.launch()
        waitForOnlineLoginPage(app)
        let fixture = webText(app, matching: "QA SMOKE test build only")
        if !fixture.waitForExistence(timeout: 30) { capture("qa-fixture-missing"); attachHierarchy(app, "qa-fixture-missing") }
        XCTAssertTrue(fixture.exists, "QA_SMOKE fixture missing: app was not built with QA_SMOKE or injection failed")
        // Negative: no user gesture yet in this fresh launch, so the native gate must reject.
        expectStatus(app, id: "gate", pass: "QA no-gesture rejected: Not allowed", any: "QA (gate|no-gesture).*", timeout: 20)
        capture("qa-ready-gate-rejected")

        tapWebButton(app, "QA speak hello")
        // "finished" is only produced by AVSpeechSynthesizer's real didFinish delegate.
        expectStatus(app, id: "speak", pass: "QA finished: finished in [0-9]+ms, trusted click true", any: "QA (speak|finished).*", timeout: 45)
        capture("qa-speak-finished")

        tapWebButton(app, "QA invalid language")
        expectStatus(app, id: "invalid", pass: "QA invalid rejected: Invalid pronunciation request", any: "QA invalid.*", timeout: 15)
        capture("qa-invalid-rejected")

        tapWebButton(app, "QA cancel speech")
        expectStatus(app, id: "cancel", pass: "QA cancel: speak rejected Pronunciation cancelled; stop stopped", any: "QA cancel.*", timeout: 20)
        capture("qa-cancelled")
    }
}
