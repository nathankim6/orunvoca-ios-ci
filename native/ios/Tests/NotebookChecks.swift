import Foundation
@main struct NotebookChecks {
    @MainActor static func main() throws {
        let url = URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent("notebook-test.json")
        defer { try? FileManager.default.removeItem(at: url) }
        let store = NotebookStore(storageURL: url)
        store.add(word: " discover ", meaning: "발견하다")
        assert(store.cards.count == 1 && store.cards[0].word == "discover")
        assert(store.dueCards.count == 1)
        var single = VocabularyReviewSession(cards: store.dueCards)
        assert(single.totalCount == 1 && single.currentCard?.word == "discover")
        store.review(single.currentCard!, remembered: true)
        single.advance()
        assert(single.isComplete && single.completedCount == 1 && single.totalCount == 1)
        single.advance(); assert(single.completedCount == 1, "Completion must not overcount")
        assert(store.cards[0].intervalDays == 1 && store.dueCards.isEmpty)
        store.review(store.cards[0], remembered: true)
        assert(store.cards[0].intervalDays == 2)
        store.review(store.cards[0], remembered: false)
        assert(store.cards[0].intervalDays == 0 && store.cards[0].due > Date())
        let imported = try store.importTSV("word\tmeaning\nfocus\t집중하다\ndiscover\t발견하다\n")
        assert(imported == 1 && store.cards.count == 2)
        do { _ = try store.importTSV("good\t좋다\nbad-line"); assertionFailure("Expected invalid TSV") } catch {}
        assert(store.cards.count == 2, "Imports must be atomic")
        let reopened = NotebookStore(storageURL: url)
        assert(reopened.cards == store.cards)
        assert(store.exportTSV.contains("focus\t집중하다"))
        store.removeAll(); assert(store.cards.isEmpty)
        var empty = VocabularyReviewSession(cards: [])
        empty.advance(); assert(empty.isComplete && empty.completedCount == 0)
        for word in ["alpha", "beta", "gamma"] { store.add(word: word, meaning: word + " meaning") }
        var multiple = VocabularyReviewSession(cards: store.dueCards)
        let originalIDs = multiple.cards.map(\.id)
        for (index, id) in originalIDs.enumerated() {
            assert(multiple.currentCard?.id == id, "No card may be skipped after the due queue shrinks")
            store.review(multiple.currentCard!, remembered: index != 1)
            multiple.advance()
            assert(store.dueCards.count == 2 - index)
            assert(multiple.totalCount == 3 && multiple.completedCount == index + 1)
        }
        assert(multiple.isComplete && multiple.completedCount == 3)
        let reviewed = NotebookStore(storageURL: url)
        assert(reviewed.cards.allSatisfy { $0.reviews == 1 } && reviewed.dueCards.isEmpty)
        store.removeAll()
        print("PASS: add/trim, due queue, review scheduling, duplicate import, atomic invalid import, persistence, export, delete, immutable single/multi-card review sessions, exact completion counts")
    }
}
