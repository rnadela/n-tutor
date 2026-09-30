import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { adminCopy } from '@/copy/admin';

const PAGE_SOURCE = readFileSync(path.resolve(import.meta.dirname, 'page.tsx'), 'utf8');
const LIST_SOURCE = readFileSync(
  path.resolve(import.meta.dirname, '../_components/TopicCurationList.tsx'),
  'utf8',
);
const CHROME_SOURCE = readFileSync(
  path.resolve(import.meta.dirname, '../_components/AdminChrome.tsx'),
  'utf8',
);

/** Comments stripped, so a rule is never satisfied by a sentence about it. */
const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

const PAGE = strip(PAGE_SOURCE);
const LIST = strip(LIST_SOURCE);
const CHROME = strip(CHROME_SOURCE);

/**
 * The Topic curation screen, asserted over its own source.
 *
 * `apps/web` runs vitest with `environment: 'node'` and ships no DOM testing library,
 * so a screen's rules are pinned by reading what it says — exactly as the flagged
 * queue, the dashboard and the disputes screens beside it are. What the rendered queue
 * looks like in a browser is a different question; what it is *allowed to do* is this
 * one, and the three actions it composes are the whole of the story here.
 *
 * The behaviour behind each call — the transaction, the re-point, the recompute — is
 * proved against real Postgres by `apps/api/test/topic-curation.int-spec.ts`.
 */
describe('what the Topic curation screen does', () => {
  it('reads the queue and makes exactly the five calls this story defines', () => {
    expect(new Set([...PAGE.matchAll(/adminApi\.(\w+)/gu)].map((match) => match[1]))).toEqual(
      new Set(['provisionalTopics', 'subjectTopics', 'confirmTopic', 'renameTopic', 'mergeTopic']),
    );
    // Every write goes through the one client, so 401/404/409 map to copy in one place.
    expect(LIST).not.toMatch(/adminApi\./u);
    expect(LIST).not.toMatch(/fetch\(/u);
  });

  it('re-derives nothing the API already decided', () => {
    // The queue's order is the server's (oldest first), the tagged count is the
    // server's, and a browser-side sort or recount would be a second opinion about a
    // settled fact.
    expect(PAGE).not.toMatch(/\.sort\(/u);
    expect(LIST).not.toMatch(/\.sort\(/u);
    expect(LIST).not.toMatch(/\.reverse\(\)/u);
    expect(LIST).toContain('topic.taggedQuestionCount');
  });

  it('fetches merge targets per row’s Subject, never one global list', () => {
    // A merge across Subjects is refused by the API, so a global target list would
    // offer an operator targets every one of which is a 400.
    expect(PAGE).toContain('adminApi.subjectTopics(subjectId)');
    expect(LIST).toContain('props.loadTargets(topic.subjectId)');
    // And it is fetched when the control opens, not once per row on load.
    expect(LIST).toContain('async function openMerge(topic: ProvisionalTopic)');
    expect(LIST).not.toMatch(/useEffect/u);
  });

  it('never offers a Topic as its own merge target', () => {
    // The one refusal an operator could otherwise walk into by mis-clicking.
    expect(LIST).toContain('found.filter((candidate) => candidate.topicId !== topic.topicId)');
  });

  it('never lands one row’s targets under another’s panel', () => {
    // Opening row A's control then row B's before A answers would otherwise show A's
    // Subject's Topics under B — every one of which the API refuses, and which can
    // include B itself.
    expect(LIST).toContain('const targetsRequest = useRef(0)');
    // Both the answer and the failure are guarded, and closing invalidates too.
    expect(LIST.match(/if \(targetsRequest\.current !== request\) return;/gu)).toHaveLength(2);
    expect(LIST.match(/targetsRequest\.current \+= 1;/gu)).toHaveLength(2);
  });

  it('renders the created instant in one fixed format, not the ambient locale', () => {
    // This screen is server-rendered and then hydrated: `toLocaleString()` reads
    // whichever locale and zone the process has, so the two renderings disagree.
    expect(LIST).not.toMatch(/toLocaleString\(\)|toLocaleDateString\(\)/u);
    expect(LIST).toContain('new Intl.DateTimeFormat(');
    expect(LIST).toContain("timeZone: 'UTC'");
    // The zone name comes out of the formatter rather than being written here (AD-32).
    expect(LIST).toContain("timeZoneName: 'short'");
  });

  it('states the merge’s blast radius before the merge can be fired', () => {
    // Nothing on this screen undoes a merge: the tags move, the Topic is removed and
    // Mastery is recomputed for every affected child.
    expect(LIST).toContain('adminCopy.topics.mergeConfirmation(');
    expect(LIST).toContain('data-testid="topic-merge-confirmation"');
    // The confirmation is rendered before the control that fires it.
    expect(LIST.indexOf('topic-merge-confirmation')).toBeLessThan(
      LIST.indexOf('props.onMerge(topic, target)'),
    );
    // And the button cannot fire without a chosen target.
    expect(LIST).toContain("disabled={targetId === '' || isPending(topic.topicId)}");
  });

  it('reloads the queue after every write, successful or not', () => {
    // A merge removes a row. A screen still showing it would offer actions on a Topic
    // that no longer exists.
    expect(PAGE.match(/await refresh\(\)/gu)).toHaveLength(2);
    expect(PAGE).toContain('adminApi.provisionalTopics()');
  });

  it('never reports a successful write as failed because the re-read failed', () => {
    // The write already committed. Telling the operator it failed is what sends them
    // back to retry a confirm on a Topic that is already confirmed.
    expect(PAGE).toContain('setAnnouncement(message);');
    // The success is announced before the re-read, and the re-read's own failure is a
    // load error rather than the action's message.
    expect(PAGE.indexOf('setAnnouncement(message);')).toBeLessThan(
      PAGE.lastIndexOf('await refresh();'),
    );
    expect(PAGE).toMatch(/const refresh = useCallback/u);
    expect(PAGE).toContain('setError(adminCopy.topics.loadFailed);');
    // And `run` returns true on a committed write whatever the re-read came to.
    expect(PAGE).toMatch(/await refresh\(\);\s*return true;/u);
  });

  it('keeps one write at a time per row, so a double-click cannot race', () => {
    expect(LIST).toContain('const [pendingIds, setPendingIds]');
    expect(LIST).toContain('if (pendingIds.has(id)) return false;');
  });

  it('keeps the operator’s typed name when a rename is refused', () => {
    // A 409 on a taken key must not throw away what they typed.
    expect(LIST).toContain('if (saved) setRenamingId(null);');
  });

  it('renders the empty queue as a sentence, and only once the read has answered', () => {
    expect(PAGE).toContain('useState<ProvisionalTopic[] | null>(null)');
    expect(LIST).toContain('topics.length === 0');
    expect(LIST).toContain('adminCopy.topics.empty');
    expect(adminCopy.topics.empty).not.toMatch(/error|fail/iu);
  });

  it('shows a load failure as a sentence with a Retry, not an empty screen', () => {
    expect(PAGE).toContain('adminCopy.topics.loadFailed');
    expect(PAGE).toContain('onClick={load}');
    expect(PAGE).toContain('adminCopy.topics.retry');
  });

  it('sends an operator back to sign-in only on the guard’s own refusal', () => {
    expect(PAGE.match(/status === 401/gu)).toHaveLength(4);
    expect(PAGE).toContain('clearToken()');
  });

  it('announces every change into a live region', () => {
    expect(PAGE).toContain('aria-live="polite"');
    expect(PAGE).toContain('adminCopy.announce.topicConfirmed(');
    expect(PAGE).toContain('adminCopy.announce.topicRenamed(');
    expect(PAGE).toContain('adminCopy.announce.topicMerged(');
  });

  it('uses the shared density tokens and no bespoke spacing', () => {
    expect(PAGE).toContain("from '@/theme/tokens'");
    expect(LIST).toContain("from '@/theme/tokens'");
    for (const source of [PAGE, LIST]) {
      expect(source).not.toMatch(/padding:\s*['"]?\d+px/u);
      expect(source).not.toMatch(/margin:\s*['"]?\d+px/u);
    }
  });

  it('shows no fact about a family, an account or a provider', () => {
    // A canonical Topic is a concept a Subject is taught. Curating it needs the name,
    // the Subject, the count and the instant, and nothing else (AD-20, AD-26).
    for (const forbidden of [
      /displayName/u,
      /\bemail\b/iu,
      /costMicros/iu,
      /\btier\b/iu,
      /\bmodel\b/iu,
      /allowance/iu,
      /rationale/iu,
      /embedding/iu,
      /matchKey/u,
      /studentProfile/iu,
    ]) {
      expect(PAGE).not.toMatch(forbidden);
      expect(LIST).not.toMatch(forbidden);
    }
  });

  it('writes no sentence of its own: every one is a member of `adminCopy`', () => {
    for (const source of [PAGE, LIST]) {
      expect(source.match(/>\s*[A-Z][a-z]+ [a-z]/gu) ?? []).toEqual([]);
      expect(source).not.toMatch(/parentCopy|studentCopy/u);
    }
  });

  it('is reachable from the nav, because a queue nobody can open goes nowhere', () => {
    expect(CHROME).toMatch(/href:\s*['"]\/admin\/topics['"]/u);
    expect(CHROME).toContain('adminCopy.nav.topics');
  });
});

describe('what the Topic curation copy is allowed to say', () => {
  const copy = adminCopy.topics;
  const sentences = [
    copy.title,
    copy.intro,
    copy.empty,
    copy.loading,
    copy.loadFailed,
    copy.retry,
    copy.nameColumn,
    copy.subjectColumn,
    copy.taggedColumn,
    copy.createdColumn,
    copy.actionsColumn,
    copy.confirm,
    copy.rename,
    copy.renameLabel,
    copy.saveName,
    copy.cancelRename,
    copy.merge,
    copy.startMerge,
    copy.cancelMerge,
    copy.mergeTargetLabel,
    copy.mergeTargetUnchosen,
    copy.loadingTargets,
    copy.noTargets,
    copy.targetProvisional,
    copy.targetConfirmed,
  ];

  it('names no cost, tier, model or allowance figure', () => {
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/\btier\b|\bcost\b|\$|£|allowance|\bmodel\b|\btoken\b/iu);
    }
  });

  it('stays factual: no exclamation, no apology, no urgency', () => {
    for (const sentence of sentences) {
      expect(sentence).not.toContain('!');
      expect(sentence).not.toMatch(/sorry|apolog|urgent|immediately|please/iu);
    }
  });

  it('writes no figure into a fixed sentence', () => {
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/\d/u);
    }
  });

  it('says what a merge does before an operator can fire one', () => {
    const warning = copy.mergeConfirmation('Fractions', 'Adding Fractions', 12);
    expect(warning).toContain('Fractions');
    expect(warning).toContain('Adding Fractions');
    expect(warning).toContain('12');
    // The three consequences, each stated.
    expect(warning).toMatch(/move/iu);
    expect(warning).toMatch(/removed/iu);
    expect(warning).toMatch(/mastery/iu);
    expect(warning).toMatch(/cannot be undone/iu);
  });

  it('states the moved count as an upper bound, because a duplicate tag is deleted', () => {
    // The count is how many questions carry the merged topic; one that already carries
    // the survivor has its duplicate removed rather than moved. An exact promise here
    // would contradict `announce.topicMerged` over the very same action.
    expect(copy.mergeConfirmation('A', 'B', 12)).toMatch(/up to 12 tagged questions move/iu);
  });

  it('reads correctly for no, one and many tagged questions', () => {
    expect(copy.mergeConfirmation('A', 'B', 0)).toContain('A carries no tagged questions');
    expect(copy.mergeConfirmation('A', 'B', 0)).not.toMatch(/\b0\b/u);
    expect(copy.mergeConfirmation('A', 'B', 1)).toContain('Up to 1 tagged question moves');
    expect(copy.mergeConfirmation('A', 'B', 1)).not.toMatch(/1 tagged questions/u);
    expect(copy.mergeConfirmation('A', 'B', 2)).toContain('Up to 2 tagged questions move');
    // Whichever reading, the whole sentence still says what a merge costs.
    for (const count of [0, 1, 2]) {
      expect(copy.mergeConfirmation('A', 'B', count)).toMatch(/cannot be undone/iu);
      expect(copy.mergeConfirmation('A', 'B', count)).toMatch(/mastery/iu);
    }
  });

  it('explains the queue’s contents and the three actions on it', () => {
    expect(copy.intro).toMatch(/automatically/iu);
    expect(copy.intro).toMatch(/confirm/iu);
    expect(copy.intro).toMatch(/rename/iu);
    expect(copy.intro).toMatch(/merge/iu);
    // And that a merge is scoped to one Subject, which is why the target list is too.
    expect(copy.intro).toMatch(/same subject/iu);
  });

  it('keeps every announcement’s figure a parameter', () => {
    expect(adminCopy.announce.topicConfirmed('Fractions')).toContain('Fractions');
    expect(adminCopy.announce.topicRenamed('A', 'B')).toContain('B');
    expect(adminCopy.announce.topicMerged('A', 'B', 3)).toContain('3');
  });

  it('announces the merged count for no, one and many questions', () => {
    expect(adminCopy.announce.topicMerged('A', 'B', 0)).toContain('No tagged questions moved');
    expect(adminCopy.announce.topicMerged('A', 'B', 0)).not.toMatch(/\b0\b/u);
    expect(adminCopy.announce.topicMerged('A', 'B', 1)).toContain('1 tagged question moved');
    expect(adminCopy.announce.topicMerged('A', 'B', 1)).not.toMatch(/1 tagged questions/u);
    expect(adminCopy.announce.topicMerged('A', 'B', 2)).toContain('2 tagged questions moved');
    // Every reading still names both topics, so the announcement stands on its own.
    for (const count of [0, 1, 2]) {
      expect(adminCopy.announce.topicMerged('A', 'B', count)).toMatch(/A merged into B/u);
    }
  });
});
