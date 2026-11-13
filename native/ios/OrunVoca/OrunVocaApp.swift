import SwiftUI

// Kept for legacy source files still compiled by the project; no notebook is initialized.
// Explicit alias preserves the property-wrapper API with the Xcode 27 SDK.
typealias ValueState<Value> = SwiftUI.State<Value>

@main
struct OrunVocaApp: App {
    var body: some Scene {
        WindowGroup {
            WebStudyView()
                .tint(Color(red: 0, green: 113.0 / 255.0, blue: 227.0 / 255.0))
        }
    }
}
