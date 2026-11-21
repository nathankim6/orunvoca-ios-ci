package com.orunvoca.app;

import java.util.UUID;

/** Immutable vocabulary card with simple spaced-repetition state. */
public final class VocabularyCard {
    public final String id;
    public final String word;
    public final String meaning;
    public final long dueMillis;
    public final int intervalDays;
    public final int reviews;

    public VocabularyCard(String id, String word, String meaning, long dueMillis, int intervalDays, int reviews) {
        this.id = id;
        this.word = word;
        this.meaning = meaning;
        this.dueMillis = dueMillis;
        this.intervalDays = intervalDays;
        this.reviews = reviews;
    }

    public static VocabularyCard create(String word, String meaning, long now) {
        return new VocabularyCard(UUID.randomUUID().toString(), word, meaning, now, 0, 0);
    }

    public VocabularyCard withText(String newWord, String newMeaning) {
        return new VocabularyCard(id, newWord, newMeaning, dueMillis, intervalDays, reviews);
    }
}
