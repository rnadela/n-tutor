import { Injectable } from '@nestjs/common';
import { AllowanceService } from '../allowance/allowance.service.js';
import { ExplanationService } from '../explanation/explanation.service.js';
import { GradingService } from '../grading/grading.service.js';
import { MASTERY_ATTEMPT_WINDOW } from '../grading/mastery.js';
import { weakAreaRuntime } from '../grading/weak-area-policy.js';
import { PracticeTestService } from '../practicetest/practice-test.service.js';
import { TopicService } from '../topics/topic.service.js';
import {
  activityOf,
  countAwaiting,
  describedTopics,
  drillDownRowsOf,
  rankTopics,
  trendPointsOf,
  type ProfileAnalyticsView,
  type TopicDrillDownView,
} from './analytics-view.js';

/**
 * The one composition behind the Parent View dashboard.
 *
 * **Five parent-scoped reads, a name lookup and a policy resolve, assembled
 * once.** Every figure a parent reads about one child comes out of this method, so
 * there is exactly one place that decides what the dashboard *is* — a second
 * surface assembling its own would be a second dashboard that agreed with this one
 * only by coincidence.
 *
 * **It owns no table and writes nothing.** Each read belongs to the module that
 * owns the rows behind it (AD-17): Mastery and the trend to `grading`, the
 * released list to `practicetest`, the reported Explanations to `explanation`, the
 * allowance to `allowance`, the Topic names to `topics`. Nothing here holds a
 * Prisma delegate, and there is no write of any kind on this path.
 *
 * **Every read carries the account in its own `where`.** A foreign or unknown
 * profile is therefore not a special case and not a refusal: each read answers
 * empty on its own, and the composition of five empty answers is an empty
 * dashboard (AD-18). A 404 for an unknown id would be a confirmation for a known
 * one, so there is deliberately no existence check in front of any of this.
 *
 * The reads run concurrently because none of them depends on another's answer; the
 * Topic names are the one read that has to wait, because it is a lookup over ids
 * the Mastery read produced.
 *
 * No cost, tier, model name or grading rationale reaches this response (AD-20,
 * AD-26).
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly grading: GradingService,
    private readonly practiceTests: PracticeTestService,
    private readonly explanations: ExplanationService,
    private readonly allowance: AllowanceService,
    private readonly topics: TopicService,
  ) {}

  /** The whole dashboard for one child of this account. */
  async profileAnalyticsFor(
    parentAccountId: string,
    studentProfileId: string,
  ): Promise<ProfileAnalyticsView> {
    const scope = { parentAccountId };
    const [mastery, scores, released, disputes, flags, consumption] = await Promise.all([
      this.grading.masteryFor(scope, studentProfileId),
      this.grading.qualifyingScoresFor(scope, studentProfileId),
      this.practiceTests.releasedFor(parentAccountId, studentProfileId),
      this.grading.gradeDisputesFor(scope, studentProfileId),
      this.explanations.studentFlagsFor(scope, studentProfileId),
      // Account-level and not per child, which is the whole reason the response
      // says so rather than letting the dashboard imply it is this child's.
      this.allowance.consumptionFor(parentAccountId),
    ]);

    // After the Mastery read, because it is a lookup over the ids that read
    // produced — and one statement for the whole set, never one per row.
    const names = await this.topics.describe(mastery.map((row) => row.topicId));

    return {
      studentProfileId,
      topics: rankTopics(describedTopics(mastery, names)),
      trend: { windowSize: MASTERY_ATTEMPT_WINDOW, points: trendPointsOf(scores) },
      activity: activityOf(released),
      digest: {
        // Awaiting is the absence of a decision on both lists, and it is read off
        // the field that records the decision rather than compared against
        // anything: a parent who set a mark and set it back has decided.
        disputesAwaiting: countAwaiting(disputes, (entry) => entry.overriddenAt === null),
        explanationFlagsAwaiting: countAwaiting(flags, (entry) => entry.disposition === null),
      },
      explanationAllowance: {
        used: consumption.allowances.explanation.used,
        limit: consumption.allowances.explanation.limit,
        resetAt: consumption.resetAt,
        timezone: consumption.timezone,
      },
      // The figures the verdict was resolved against, so the web states neither.
      // Copied rather than handed out: `weakAreaRuntime` memoizes one object for
      // the process, and a response that shared it would be one serializer away
      // from a caller mutating the boot-resolved policy.
      weakArea: { ...weakAreaRuntime() },
    };
  }

  /**
   * One Topic's drill-down for one child of this account: the stored figure, the
   * evidence behind it, and the single weighted-generation target it can be acted on
   * through.
   *
   * **One composition in one place, as the dashboard's is.** Four reads across three
   * modules and a policy resolve, assembled here — so there is exactly one place that
   * decides what the drill-down *is*, and no surface assembles its own.
   *
   * **The evidence read comes first and an empty one short-circuits.** A Topic this
   * child has no stored figure for — a foreign profile, an unknown profile, a Topic
   * they have never been asked about, a Topic met only on retakes — has nothing to
   * name, no words to look up and nothing to generate from, so none of the three
   * further reads is issued at all. That is the AD-18 empty answer, and it is 200.
   *
   * **The target is resolved from the evidence, server-side.** The Questions handed
   * to `weightedTargetFor` are exactly the ones the parent is looking at, and the
   * label it answers with is the Extraction's own spelling — so the request the screen
   * fires cannot 409 on a label the drill-down invented. `null` is a legitimate
   * answer and the screen says so rather than offering a fire.
   *
   * It owns no table and writes nothing (AD-17): the figure and the refs are
   * `grading`'s, the words and the target `practicetest`'s, the Topic's name `topics`'.
   * No cost, tier, model name or grading rationale reaches this response (AD-20,
   * AD-26) — the allowance the screen states is the account's own
   * `GET parent/allowance/generation` read, which is Story 4.1's and is not
   * duplicated here.
   */
  async topicDrillDownFor(
    parentAccountId: string,
    studentProfileId: string,
    topicId: string,
  ): Promise<TopicDrillDownView> {
    const weakArea = { ...weakAreaRuntime() };
    const evidence = await this.grading.topicEvidenceFor(
      { parentAccountId },
      studentProfileId,
      topicId,
    );
    if (evidence.mastery === null) {
      return {
        topicId,
        topicName: null,
        subjectName: null,
        mastery: null,
        missed: [],
        unanswered: [],
        target: null,
        weakArea,
      };
    }

    const refs = [...evidence.missed, ...evidence.unanswered];
    // The name and the words are independent of each other, so they are read
    // together. Neither depends on the other's answer.
    const [names, words] = await Promise.all([
      this.topics.describe([topicId]),
      this.practiceTests.questionEvidenceFor(
        parentAccountId,
        refs.map((ref) => ({ attemptId: ref.attemptId, questionId: ref.questionId })),
      ),
    ]);
    const described = names.get(topicId) ?? null;

    // After the name, because the canonical spelling is the first label the resolver
    // tries — and over **every tagged Question of the window**, not only the failed
    // ones: a Topic the child answered perfectly has a figure, no failed row, and an
    // upload that plainly still carries the Topic, so resolving from the two lists
    // would tell that parent no upload of theirs covers it. The window's own question
    // ids come from `topicEvidenceFor`, which already held them — re-resolving the
    // window here would be the second selection rule this story exists to avoid.
    const target = await this.practiceTests.weightedTargetFor(
      parentAccountId,
      evidence.windowQuestionIds,
      described?.name ?? null,
    );

    return {
      topicId,
      topicName: described?.name ?? null,
      subjectName: described?.subjectName ?? null,
      // The same join the dashboard's table uses, over the one row: a row whose Topic
      // is missing from the map keeps its place and loses its label.
      mastery: describedTopics([evidence.mastery], names)[0] ?? null,
      missed: drillDownRowsOf(evidence.missed, words),
      unanswered: drillDownRowsOf(evidence.unanswered, words),
      target,
      weakArea,
    };
  }
}
