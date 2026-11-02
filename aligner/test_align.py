import unittest

from align import Fragment, cue_confidence, group_words, map_fragments, spoken_text, word_ends


class SpokenTextTest(unittest.TestCase):
    def test_drops_labels_and_keeps_offsets(self):
        cue = "（各務原(かがみはら)なでしこ）\nハァ"
        spoken = spoken_text(cue)
        self.assertEqual(spoken.text.strip(), "ハァ")
        self.assertEqual(cue[spoken.offsets[-1]], "ァ")

    def test_drops_furigana_inside_a_word(self):
        self.assertEqual(spoken_text("焚(た)き火").text, "焚き火")

    def test_sounds_and_music_have_no_speech(self):
        for cue in ("（カメラのシャッター音）", "♪～", "～♪", "（リンの息遣い）"):
            self.assertEqual(spoken_text(cue).text, "")


class MapFragmentsTest(unittest.TestCase):
    def test_skips_spaces_between_lines(self):
        placed = map_fragments(spoken_text("ほい\nしま"), [("ほい", 0, 1, 1), (" しま", 1, 2, 1)])
        self.assertEqual([(f.from_char, f.to_char) for f in placed], [(0, 2), (3, 5)])

    def test_rejects_text_that_does_not_match(self):
        self.assertIsNone(map_fragments(spoken_text("ほい"), [("はい", 0, 1, 1)]))

    def test_rejects_unconsumed_text(self):
        self.assertIsNone(map_fragments(spoken_text("ほいほい"), [("ほい", 0, 1, 1)]))


class GroupWordsTest(unittest.TestCase):
    def test_joins_fragments_and_spans_furigana(self):
        cue = "焚(た)き火を"
        spoken = spoken_text(cue)
        fragments = [
            Fragment(0, 1, 1.0, 1.2, 1.0),
            Fragment(1, 3, 1.2, 1.5, 0.5),
            Fragment(3, 4, 1.5, 1.6, 1.0),
        ]
        words = group_words(spoken, fragments, {3, 4})
        self.assertEqual([cue[w["from"]:w["to"]] for w in words], ["焚(た)き火", "を"])
        self.assertEqual((words[0]["start"], words[0]["end"]), (1.0, 1.5))
        self.assertAlmostEqual(words[0]["probability"], 0.667, places=3)

    def test_punctuation_stays_with_its_word(self):
        self.assertEqual(word_ends("だろ？", ["だろ", "？"]), {3})

    def test_confidence_weights_by_length(self):
        words = [{"from": 0, "to": 3, "probability": 1.0}, {"from": 3, "to": 4, "probability": 0.0}]
        self.assertEqual(cue_confidence(words), 0.75)


if __name__ == "__main__":
    unittest.main()
