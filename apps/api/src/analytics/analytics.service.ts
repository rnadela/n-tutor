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
  rankTopics,
  trendPointsOf,
  type ProfileAnalyticsView,
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
}
