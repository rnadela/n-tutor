-- Story 5.4 adds the table grade state lives in, and the enum FR-37 fixes the
-- membership of.
--
-- Nothing derives a grade from an empty answer field at read time: a blank on an
-- Attempt handed in early is `Unanswered` and a blank on one whose time ran out is
-- `Incorrect`, and the absent answer row looks identical in both. So the state is
-- persisted, by the transaction that closed the Attempt.
--
-- `question_grade` is a table of its own rather than a column on `answer`: a blank
-- Question has no `answer` row to hang a grade on, and `answer` is `practicetest`'s
-- table while grade state is `grading`'s (AD-6, AD-17).

-- CreateEnum
-- All four of FR-37's literals, now, because FR-37 fixes them and a two-member
-- enum would force Story 5.5 to migrate an enum rather than insert rows. There is
-- deliberately **no** fifth "pending" member: the absence of a row already means
-- "not graded yet", and `Ungraded` is a grading failure rather than a wait.
CREATE TYPE "grade_state" AS ENUM ('Correct', 'Incorrect', 'Unanswered', 'Ungraded');

-- CreateTable
-- Story 5.4 writes exactly one state into this table -- `Unanswered`, for a blank
-- on a manually submitted Attempt the server judged unexpired. No rationale column
-- and no score: Story 5.5 adds what its own verdicts need.
CREATE TABLE "question_grade" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "state" "grade_state" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_grade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One grade per Question per Attempt, which is what makes "a grade is a fact about
-- one (Attempt, Question) pair" a property of the table rather than of a check.
CREATE UNIQUE INDEX "question_grade_attemptId_questionId_key" ON "question_grade"("attemptId", "questionId");

-- CreateIndex
-- The read every later story makes: one Attempt's grades, whole.
CREATE INDEX "question_grade_attemptId_idx" ON "question_grade"("attemptId");

-- AddForeignKey
-- Cascade on both edges, like `answer`'s: a grade never blocks a deletion and
-- leaves no tombstone behind it.
ALTER TABLE "question_grade" ADD CONSTRAINT "question_grade_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_grade" ADD CONSTRAINT "question_grade_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "practice_test_question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
