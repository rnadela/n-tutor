-- One index, and it is the one every grade-changing trigger needs.
--
-- The Mastery recompute's first statement is "which Topics is this paper tagged with" —
-- `question_topic` by `practiceTestId`, distinct on `topicId` — and neither index the
-- table shipped with leads with that column: the unique one leads with the Question, and
-- the lookup index leads with the Topic. So that statement was a sequential scan, run
-- inside the transaction that a hand-in, a results read and a parent's override all hold
-- open while a person waits on them.
--
-- `topicId` is the second column deliberately: the read wants distinct Topic ids and
-- nothing else, so it is answered from the index alone rather than by fetching every tag
-- row of the paper to throw most of them away.

-- CreateIndex
CREATE INDEX "question_topic_practiceTestId_topicId_idx" ON "question_topic"("practiceTestId", "topicId");
