import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { parentCopy } from '@/copy/parent';
import { ACCOUNT_TIERS } from '@/lib/admin-api';
import { ParentApiError, type PageImageView } from '@/lib/parent-api';
import { endsParentView } from '@/lib/parent-view';
import { parentTheme } from '@/theme/theme';
import { colorTokens, density } from '@/theme/tokens';
import { CameraGuidance, type CameraStatus } from './AddPages';
import { CameraViewfinder, type CameraViewfinderProps } from './CameraViewfinder';
import { PageStrip, type PageStripProps } from './PageStrip';
import { ThinExtractionWarning, type ThinExtractionWarningProps } from './ThinExtractionWarning';
import { writeRefusal } from './page';

const DIR = import.meta.dirname;

/** The screen's own source, for the rules it states rather than renders. */
const PAGE_SOURCE = readFileSync(path.resolve(DIR, 'page.tsx'), 'utf8');
/** The strip's own source: it carries the per-page legibility badge. */
const STRIP_SOURCE = readFileSync(path.resolve(DIR, 'PageStrip.tsx'), 'utf8');

function page(ordinal: number, legibility: PageImageView['legibility'] = null): PageImageView {
  return {
    id: `page-${ordinal}`,
    ordinal,
    state: 'Ready',
    width: 40,
    height: 60,
    byteSize: 512,
    legibility,
    createdAt: '2026-01-01T00:00:00.000Z',
    bytesDeletedAt: null,
  };
}

/**
 * The same row after the ninety-day retention sweep took its photograph.
 *
 * Exactly what the sweep writes and nothing more: it sets `state`,
 * `bytesDeletedAt` and (invisibly to this layer) the storage path, and leaves
 * the dimensions, the byte size and the legibility verdict where they were. A
 * fixture that nulled them would be testing the strip against a row shape
 * production never produces.
 */
function deletedPage(ordinal: number, bytesDeletedAt: string | null): PageImageView {
  return {
    ...page(ordinal, 'High'),
    state: 'Deleted',
    bytesDeletedAt,
  };
}

const THREE = [page(1), page(2), page(3)];

function render(overrides: Partial<PageStripProps> = {}): string {
  const props: PageStripProps = {
    pages: THREE,
    editable: true,
    busy: false,
    onMove: () => undefined,
    onRetake: () => undefined,
    onDelete: () => undefined,
    ...overrides,
  };
  return renderToStaticMarkup(
    createElement(ThemeProvider, { theme: parentTheme }, createElement(PageStrip, props)),
  );
}

/**
 * The markup between a row's opening `<li` and the next one — everything that
 * belongs to exactly one page, so an assertion about "page 2's controls" cannot
 * be satisfied by page 1's.
 */
function rowFor(markup: string, ordinal: number): string {
  const rows = markup.split('<li').slice(1);
  const row = rows.find((candidate) => candidate.includes(`data-ordinal="${ordinal}"`));
  if (row === undefined) throw new Error(`No row for page ${ordinal}.`);
  return row;
}

describe('the strip is an ordered list', () => {
  it('renders an <ol> whose list semantics survive `list-style: none`', () => {
    const markup = render();
    expect(markup).toContain('<ol');
    // WebKit drops list semantics from a list styled with no markers, which is
    // exactly what this list is. The role is re-applied so the criterion holds.
    expect(markup).toContain('role="list"');
    expect(markup).toContain('role="listitem"');
  });

  it('names the list by the heading above it rather than repeating its words', () => {
    const markup = render();
    expect(markup).toContain('aria-labelledby="capture-order-heading"');
    // The same words as an `aria-label` would be announced twice.
    expect(markup).not.toContain(`aria-label="${parentCopy.capture.orderLabel}"`);
    // And the screen renders the heading that id points at.
    expect(PAGE_SOURCE).toContain('id={ORDER_HEADING_ID}');
  });

  it('gives every page a row carrying its ordinal, in stored order', () => {
    const markup = render();
    expect(markup.match(/<li/g)).toHaveLength(THREE.length);
    for (const item of THREE) {
      expect(rowFor(markup, item.ordinal)).toContain(parentCopy.capture.pageLabel(item.ordinal));
    }
    // In order: page 1's row opens before page 2's, which opens before page 3's.
    expect(markup.indexOf('data-ordinal="1"')).toBeLessThan(markup.indexOf('data-ordinal="2"'));
    expect(markup.indexOf('data-ordinal="2"')).toBeLessThan(markup.indexOf('data-ordinal="3"'));
  });
});

describe('every action is a real control naming the page it acts on', () => {
  it('gives each row four controls, each accessibly named by its ordinal', () => {
    const markup = render();
    for (const item of THREE) {
      const row = rowFor(markup, item.ordinal);
      expect(row).toContain(`aria-label="${parentCopy.capture.moveUpFor(item.ordinal)}"`);
      expect(row).toContain(`aria-label="${parentCopy.capture.moveDownFor(item.ordinal)}"`);
      expect(row).toContain(`aria-label="${parentCopy.capture.retakeFor(item.ordinal)}"`);
      expect(row).toContain(`aria-label="${parentCopy.capture.deleteFor(item.ordinal)}"`);
    }
  });

  it('draws them as focusable elements, never as decorated divs', () => {
    const row = rowFor(render(), 2);
    // Three real buttons and one real file input — the mockup's `div.iconbtn`
    // is deliberately not what this builds.
    expect(row.match(/<button/g)).toHaveLength(3);
    expect(row).toContain('type="file"');
    expect(row).not.toContain('<div role="button"');
  });

  it('labels the retake input so it is reachable by its visible word too', () => {
    const row = rowFor(render(), 2);
    expect(row).toContain('for="capture-retake-page-2"');
    expect(row).toContain('id="capture-retake-page-2"');
    expect(row).toContain(parentCopy.capture.retake);
  });

  it('states no user-facing string of its own', () => {
    const source = readFileSync(path.resolve(DIR, 'PageStrip.tsx'), 'utf8');
    const code = source
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
    // Every visible word and every accessible name comes from the copy module.
    expect(code).not.toMatch(/(aria-label|children)=["']/);
    expect(code.match(/parentCopy\.capture\./g)?.length ?? 0).toBeGreaterThan(6);
  });
});

describe('the controls at the ends are disabled as rendered', () => {
  it('disables move-up on the first row and move-down on the last', () => {
    const markup = render();
    const first = rowFor(markup, 1);
    const last = rowFor(markup, 3);
    const middle = rowFor(markup, 2);

    expect(disabledNames(first)).toContain(parentCopy.capture.moveUpFor(1));
    expect(disabledNames(first)).not.toContain(parentCopy.capture.moveDownFor(1));
    expect(disabledNames(last)).toContain(parentCopy.capture.moveDownFor(3));
    expect(disabledNames(last)).not.toContain(parentCopy.capture.moveUpFor(3));
    expect(disabledNames(middle)).toEqual([]);
  });

  it('disables both on a strip of one', () => {
    const row = rowFor(render({ pages: [page(1)] }), 1);
    expect(disabledNames(row)).toEqual([
      parentCopy.capture.moveUpFor(1),
      parentCopy.capture.moveDownFor(1),
    ]);
  });

  it('locks every control while a write is in flight', () => {
    const row = rowFor(render({ busy: true }), 2);
    expect(disabledNames(row)).toEqual([
      parentCopy.capture.moveUpFor(2),
      parentCopy.capture.moveDownFor(2),
      parentCopy.capture.retakeFor(2),
      parentCopy.capture.deleteFor(2),
    ]);
  });
});

describe('a submitted Source Test is terminal', () => {
  it('keeps the pages visible and offers no control on any of them', () => {
    const markup = render({ editable: false });
    expect(markup.match(/<li/g)).toHaveLength(THREE.length);
    expect(markup).toContain(parentCopy.capture.pageLabel(2));
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('type="file"');
  });

  it('is what the screen gates its add and submit controls on too', () => {
    // Rendering the whole screen would need a router and an elevation
    // provider, which this suite has neither of; these are the gates.
    expect(PAGE_SOURCE).toContain('const isDraft = sourceTest !== null');
    expect(PAGE_SOURCE).toContain('const addable = isDraft &&');
    expect(PAGE_SOURCE).toContain('const checkable = isDraft &&');
    expect(PAGE_SOURCE).toContain('const checked = isDraft && isChecked(gate)');
    expect(PAGE_SOURCE).toContain('{isDraft && (');
  });
});

describe('a page whose photograph has been deleted', () => {
  // Only a submitted Source Test can hold one — the clock starts at the commit
  // — and a submitted Source Test is already not editable. Both are rendered
  // anyway: the removal state has to be a designed state under either flag,
  // never a control that would collect a 409.
  const WITH_DELETED = [
    page(1, 'High'),
    deletedPage(2, '2026-04-02T00:00:00.000Z'),
    page(3, 'Low'),
  ];

  it('keeps its place in the order and says the photograph is gone', () => {
    const row = rowFor(render({ pages: WITH_DELETED, editable: false }), 2);
    expect(row).toContain(parentCopy.capture.pageLabel(2));
    expect(row).toContain(parentCopy.capture.photoDeletedOn('02 Apr 2026'));
  });

  it('is a branch of its own, reached only by the removed row', () => {
    // The caption is the thing that distinguishes this state, so the assertion
    // is that it is here and nowhere else — a `<img>` assertion would pass for
    // every state, because the strip renders no image element at all.
    const markup = render({ pages: WITH_DELETED, editable: true });
    expect(rowFor(markup, 2)).toContain('data-testid="page-deleted-2"');
    expect(rowFor(markup, 1)).not.toContain('page-deleted');
    expect(rowFor(markup, 3)).not.toContain('page-deleted');
  });

  it('shows no retry and no edit control, even where the strip is editable', () => {
    const markup = render({ pages: WITH_DELETED, editable: true });
    const row = rowFor(markup, 2);
    expect(row).not.toContain(parentCopy.capture.retake);
    expect(row).not.toContain('type="file"');
    expect(row).not.toContain('<button');
    expect(row).not.toContain(parentCopy.capture.delete);
    // The neighbours still have theirs, so the absence above is this row's.
    expect(rowFor(markup, 1)).toContain('<button');
  });

  it('wears no error styling: nothing went wrong', () => {
    // Page 3 is blurry, so its badge carries the error-coloured class MUI
    // emitted for `error.main`. Taking that class off the rendered markup
    // rather than naming a colour is what makes this an assertion about *this*
    // row's styling and not about the palette's values.
    const markup = render({ pages: WITH_DELETED, editable: false });
    const badge =
      /data-testid="legibility-badge-3"[^>]*class="([^"]+)"|class="([^"]+)"[^>]*data-testid="legibility-badge-3"/u.exec(
        markup,
      );
    // Only the emotion-generated class, which is where the colour actually
    // lives; `MuiTypography-root` and friends are on every span in the strip.
    const errorClasses = (badge?.[1] ?? badge?.[2] ?? '')
      .split(/\s+/)
      .filter((className) => className.startsWith('css-'));
    expect(errorClasses.length).toBeGreaterThan(0);

    const row = rowFor(markup, 2);
    for (const className of errorClasses) expect(row).not.toContain(className);
  });

  it('shows no legibility verdict over a photograph that no longer exists', () => {
    // The row carries a `High` verdict from when the check ran. Rendering it
    // would be a judgement on bytes nobody can look at any more.
    const row = rowFor(render({ pages: WITH_DELETED, editable: false }), 2);
    expect(row).not.toContain('data-testid="legibility-badge-2"');
    expect(row).not.toContain(parentCopy.capture.legibility.readable);
  });

  it('falls back to the plain sentence when the row carries no date', () => {
    const row = rowFor(render({ pages: [deletedPage(1, null)], editable: false }), 1);
    expect(row).toContain(parentCopy.capture.photoDeleted);
  });

  it('falls back to the plain sentence on a date that will not parse', () => {
    // "Photo deleted on Invalid Date" is the one thing worse than saying less.
    // A timestamp the API mangled is the API's problem, not the parent's, and
    // the plain sentence is true either way.
    const row = rowFor(render({ pages: [deletedPage(1, 'not-a-date')], editable: false }), 1);
    expect(row).toContain(parentCopy.capture.photoDeleted);
    expect(row).not.toContain('Invalid Date');
  });

  it('renders the date the same way on every machine', () => {
    // Fixed en-GB in UTC, not the viewer's locale: a retention date that
    // renders differently per machine is a date no test can pin, and this
    // suite would be the thing that broke on a laptop set to another zone.
    expect(STRIP_SOURCE).toContain("timeZone: 'UTC'");
    expect(STRIP_SOURCE).toContain("'en-GB'");
  });
});

describe('the parent tap-target floor', () => {
  it('is applied to every strip control from the density token', () => {
    const markup = render();
    // MUI emits the figure into the stylesheet it renders with the markup, so
    // the floor is assertable rather than merely intended.
    expect(markup).toContain(`min-height:${density.tapTarget}px`);
    expect(markup).toContain(`min-width:${density.tapTarget}px`);
    expect(density.tapTarget).toBe(44);
  });

  it('writes neither figure as a literal in the component', () => {
    const source = readFileSync(path.resolve(DIR, 'PageStrip.tsx'), 'utf8');
    const code = source
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
    expect(code).toContain('density.tapTarget');
    expect(code).toContain('focusRing.width');
    expect(code).not.toMatch(/minHeight:\s*44/);
  });

  it('gives every control a visible focus ring', () => {
    expect(render()).toContain('outline:');
  });
});

/** The accessible names of the disabled controls in one row, in order. */
function disabledNames(row: string): string[] {
  const names: string[] = [];
  // Split on element starts so `disabled` is attributed to the element it is
  // actually on, rather than to whichever `aria-label` happens to be nearest.
  for (const element of row.split('<').slice(1)) {
    const head = element.slice(0, element.indexOf('>'));
    if (!/(^|\s)disabled(=|\s|$)/.test(head)) continue;
    const name = /aria-label="([^"]*)"/.exec(head);
    if (name) names.push(name[1]!);
  }
  return names;
}

describe('the announcements the screen makes', () => {
  it('names the page each one is about, by ordinal', () => {
    expect(parentCopy.capture.deleted(2, 3)).toBe(
      'Page 2 was deleted. The pages after it are renumbered.',
    );
    expect(parentCopy.capture.deleted(1, 1)).toBe('Page 1 was deleted.');
    expect(parentCopy.capture.retaken(1)).toBe('Page 1 was replaced.');
    expect(parentCopy.capture.moved(1, 3)).toBe('Page 1 is now page 3.');
    expect(parentCopy.capture.submitted).toBe('The pages were submitted.');
  });

  it('states the count line from both figures the API supplies', () => {
    expect(parentCopy.capture.countLine(3, 10)).toBe(
      'Pages are used in this order. 3 of 10 page images.',
    );
    expect(parentCopy.capture.countLine(0, 10)).toContain('0 of 10');
  });

  it('phrases the move and the retake from the server’s answer, not a guess', () => {
    // Both read the page's landing ordinal out of the returned view; a client
    // prediction would still read as success had the server applied otherwise.
    expect(PAGE_SOURCE).toContain('after.pages.findIndex((page) => page.id === pageId) + 1');
    expect(PAGE_SOURCE).toContain('after.pages.find((page) => page.id === pageId)?.ordinal');
  });

  it('says what an add is doing while it is doing it', () => {
    expect(PAGE_SOURCE).toContain("pending === 'add'");
    expect(PAGE_SOURCE).toContain('parentCopy.capture.adding');
  });
});

describe('the classification the screen adds above the strip', () => {
  it('states both blocked reasons, in reading order, from the rule', () => {
    const capture = parentCopy.capture;
    expect(capture.submitBlocked(['pages'])).toBe('Add at least one page before submitting.');
    expect(capture.submitBlocked(['classification'])).toBe(
      'Choose a subject and a grade level before submitting.',
    );
    expect(capture.submitBlocked(['pages', 'classification'])).toBe(
      'Add at least one page before submitting. Choose a subject and a grade level before submitting.',
    );
    // Nothing unmet states nothing — the sentence is only rendered when the
    // control is refused, and it should not manufacture one.
    expect(capture.submitBlocked([])).toBe('');
  });

  it('is fed by the rule module rather than by a second copy of the gates', () => {
    expect(PAGE_SOURCE).toContain('submitBlockedReasons(gate, readyPageCount)');
    expect(PAGE_SOURCE).toContain('isClassified(classification)');
    // The check reason is filtered out of *this* sentence: the control it
    // would name is the very control being refused. It is still stated by the
    // copy function, and by the server, for a caller that never saw the
    // screen.
    expect(PAGE_SOURCE).toContain('parentCopy.capture.submitBlocked(');
    expect(PAGE_SOURCE).toContain("blockedReasons.filter((reason) => reason !== 'legibility')");
  });

  it('re-reads the Subjects whenever the stored Grade Level moves', () => {
    // A filtered cache would be a second reader of the availability rule; the
    // list is the server's answer for the Grade Level actually stored.
    expect(PAGE_SOURCE).toContain('parentApi.sourceTestSubjects(token, gradeLevelId)');
    expect(PAGE_SOURCE).toContain('loadSubjects(draftGradeLevelId)');
    // And with the same staleness guard every other read here carries.
    expect(PAGE_SOURCE).toContain('applyIfCurrent(subjectsCurrent.current, issued');
  });

  it('writes both selects through the shared write path, so the strip locks', () => {
    expect(PAGE_SOURCE).toContain("'classify',");
    expect(PAGE_SOURCE).toContain('parentApi.classifySourceTest(token!, sourceTest!.id, patch)');
    expect(PAGE_SOURCE).toContain(
      'onChange={(event) => classify({ gradeLevelId: event.target.value })}',
    );
    expect(PAGE_SOURCE).toContain(
      'onChange={(event) => classify({ subjectId: event.target.value })}',
    );
  });

  it('announces a grade-level change that cleared the subject as exactly that', () => {
    const copy = parentCopy.capture.classification;
    expect(copy.gradeLevelSet('Grade 5')).toBe('The grade level is Grade 5.');
    expect(copy.subjectSet('Maths')).toBe('The subject is Maths.');
    expect(copy.gradeLevelSetSubjectCleared('Grade 5')).toContain('the subject was cleared');
    expect(copy.gradeLevelSetSubjectCleared('Grade 5')).toContain('Grade 5');
  });

  it('derives the announcement from the pure classificationAnnouncement rule, not restated inline', () => {
    // The rule itself — which branch fires for which patch and answer — is
    // asserted behaviorally in classification.spec.ts. This only checks that
    // the screen defers to it rather than re-deciding the branch here.
    expect(PAGE_SOURCE).toContain(
      'const announcement = classificationAnnouncement(classification, patch, after)',
    );
    expect(PAGE_SOURCE).toContain("case 'subjectSet':");
    expect(PAGE_SOURCE).toContain("case 'gradeLevelSet':");
    expect(PAGE_SOURCE).toContain("case 'gradeLevelSetSubjectCleared':");
  });

  it('says plainly that the grade level here is not the child’s profile', () => {
    expect(parentCopy.capture.classification.intro).toContain('does not change the child');
  });

  it('states every one of its own words from the copy module', () => {
    const code = PAGE_SOURCE.split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
    for (const marker of [
      'classification.heading',
      'classification.intro',
      'classification.gradeLevelLabel',
      'classification.subjectLabel',
      'classification.chooseGradeLevelFirst',
      'classification.noSubjects',
      'classification.loadingSubjects',
      'classification.noGradeLevels',
      'classification.saving',
    ]) {
      expect(code).toContain(`parentCopy.capture.${marker}`);
    }
  });

  it('names its section by the heading it renders, not by repeating the words', () => {
    expect(PAGE_SOURCE).toContain('aria-labelledby={CLASSIFICATION_HEADING_ID}');
    expect(PAGE_SOURCE).toContain('id={CLASSIFICATION_HEADING_ID}');
  });
});

describe('what the classification selects show against what they offer', () => {
  it('renders both selects from the offered list plus whatever the draft holds', () => {
    // An administrator disabling a chosen Subject drops it out of the offered
    // list while the draft keeps it and stays submittable; a select fed by the
    // offered list alone would then render blank for a classified upload.
    expect(PAGE_SOURCE).toContain(
      'optionsWithStored(\n    gradeLevels,\n    classification.gradeLevelId,\n    sourceTest?.gradeLevelName ?? null,\n  )',
    );
    expect(PAGE_SOURCE).toContain(
      'optionsWithStored(\n    subjects,\n    classification.subjectId,\n    sourceTest?.subjectName ?? null,\n  )',
    );
    // Including the empty states, which are about what is renderable and not
    // about what the server last offered.
    expect(PAGE_SOURCE).toContain('gradeLevelOptions.length === 0');
    expect(PAGE_SOURCE).toContain('subjectOptions.length === 0');
    expect(PAGE_SOURCE).toContain('{gradeLevelOptions.map(');
    expect(PAGE_SOURCE).toContain('{subjectOptions.map(');
    // And the gate is untouched: still the two ids, never the offered lists.
    expect(PAGE_SOURCE).toContain('isClassified(classification)');
  });

  it('states a failed grade-level read as a failure, not as an empty catalogue', () => {
    expect(parentCopy.capture.classification.gradeLevelsFailed).not.toBe(
      parentCopy.capture.classification.noGradeLevels,
    );
    expect(PAGE_SOURCE).toContain('parentCopy.capture.classification.gradeLevelsFailed');
  });

  it('guards the grade-level read against an out-of-order response, like the other reads', () => {
    // Retry can re-issue this while an earlier attempt is still in flight;
    // without the same guard the Subject and profile reads carry, a slow
    // first attempt could overwrite what a faster retry already rendered.
    expect(PAGE_SOURCE).toContain('applyIfCurrent(gradeLevelsCurrent.current, issued');
  });

  it('re-issues every read on Retry, the Subject and Extraction ones included', () => {
    expect(PAGE_SOURCE).toContain('loadSubjects(draftGradeLevelId);');
    // The Extraction poll stops on its own failure, so Retry has to re-issue
    // it as well or the Alert's button retries nothing that broke.
    expect(PAGE_SOURCE).toContain('setExtractionAttempt((attempt) => attempt + 1);');
    expect(PAGE_SOURCE).toContain(
      '}, [loadProfiles, openDraft, loadGradeLevels, loadSubjects, draftGradeLevelId]);',
    );
  });
});

/** The warning, rendered inline so the dialog's own markup is assertable. */
function warning(overrides: Partial<ThinExtractionWarningProps> = {}): string {
  const props: ThinExtractionWarningProps = {
    open: true,
    usableQuestionCount: 3,
    pageCount: 3,
    busy: false,
    onContinue: () => undefined,
    onRetake: () => undefined,
    onDismiss: () => undefined,
    disablePortal: true,
    keepMounted: true,
    ...overrides,
  };
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: parentTheme },
      createElement(ThinExtractionWarning, props),
    ),
  );
}

describe('the thin-extraction warning states all three of the requirement’s facts', () => {
  it('names the usable-question count and the page count together', () => {
    const markup = warning({ usableQuestionCount: 3, pageCount: 3 });
    expect(markup).toContain(parentCopy.capture.generate.counts(3, 3));
    expect(markup).toContain('3 usable questions');
    expect(markup).toContain('3 pages');
  });

  it('reads correctly when either figure is one', () => {
    expect(parentCopy.capture.generate.counts(1, 1)).toBe(
      '1 usable question was found across 1 page.',
    );
    expect(parentCopy.capture.generate.counts(0, 2)).toBe(
      '0 usable questions were found across 2 pages.',
    );
  });

  it('says that retaking costs no Generation Allowance', () => {
    const markup = warning();
    expect(markup).toContain(parentCopy.capture.generate.noGenerationCharge);
    expect(parentCopy.capture.generate.noGenerationCharge).toContain('Generation Allowance');
  });

  it('offers both ways out as real, named, focusable controls', () => {
    const markup = warning();
    expect(markup.match(/<button/g)?.length).toBe(2);
    expect(markup).toContain(parentCopy.capture.generate.continueAnyway);
    expect(markup).toContain(parentCopy.capture.generate.retakePages);
    // At the parent tap-target floor, from the token rather than a literal.
    expect(markup).toContain(`min-height:${density.tapTarget}px`);
  });

  it('never refuses the proceed — the warning informs, it does not block', () => {
    // Even mid-write, when retake has to wait for the draft it is opening,
    // continuing stays available.
    const markup = warning({ busy: true });
    const continueControl = markup
      .split('<button')
      .find((part) => part.includes(parentCopy.capture.generate.continueAnyway));
    expect(continueControl).toBeDefined();
    expect(continueControl!.slice(0, continueControl!.indexOf('>'))).not.toContain('disabled');
    const source = readFileSync(path.resolve(DIR, 'ThinExtractionWarning.tsx'), 'utf8');
    // The retake control is the only one a busy state may lock.
    expect(source.match(/disabled=\{busy\}/g)).toHaveLength(1);
  });

  it('treats a dismissal as a cancel, never as a quiet continue', () => {
    const source = readFileSync(path.resolve(DIR, 'ThinExtractionWarning.tsx'), 'utf8');
    // Escape and the scrim reach `onClose`, and it is its own prop: wired to
    // `onContinue` an accidental tap would advance the flow and announce that
    // the upload is ready.
    expect(source).toContain('onClose={onDismiss}');
    expect(source).not.toContain('onClose={onContinue}');
    // And the screen's dismissal only closes the warning — it neither reaches
    // the step nor announces anything.
    const dismiss = PAGE_SOURCE.slice(PAGE_SOURCE.indexOf('function dismissWarning()'));
    const body = dismiss.slice(0, dismiss.indexOf('\n  }'));
    expect(body).toContain('setWarningOpen(false);');
    expect(body).not.toContain('announce(');
    expect(body).not.toContain('setGenerateReached');
    expect(PAGE_SOURCE).toContain('onDismiss={dismissWarning}');
  });

  it('is a dialog labelled by its own title', () => {
    const markup = warning();
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain(parentCopy.capture.generate.warningTitle);
    const labelled = /aria-labelledby="([^"]+)"/.exec(markup);
    expect(labelled).not.toBeNull();
    expect(markup).toContain(`id="${labelled![1]}"`);
  });

  it('decides nothing: no verdict, no threshold and no request inside it', () => {
    const source = readFileSync(path.resolve(DIR, 'ThinExtractionWarning.tsx'), 'utf8');
    const code = source
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
    expect(code).not.toContain('parentApi');
    expect(code).not.toContain('useState');
    // It is handed two numbers, not a verdict: neither the server's `thin` nor
    // the gate that reads it appears in the code.
    expect(code).not.toContain('.thin');
    expect(code).not.toContain('warningNeeded');
    // Both figures are handed in; neither is computed here.
    expect(code).toContain('copy.counts(usableQuestionCount, pageCount)');
  });

  it('states every one of its own words from the copy module', () => {
    const source = readFileSync(path.resolve(DIR, 'ThinExtractionWarning.tsx'), 'utf8');
    const code = source
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
    expect(code).not.toMatch(/(aria-label|children)=["']/);
    expect(code).toContain('parentCopy.capture.generate');
  });
});

describe('the generate step and the gate on the way into it', () => {
  it('exists only past submit, where an Extraction job exists at all', () => {
    expect(PAGE_SOURCE).toContain('{!isDraft && (');
    expect(PAGE_SOURCE).toContain(
      "sourceTest !== null && sourceTest.status === 'Submitted' ? sourceTest.id : null",
    );
  });

  it('gates the warning on the pure rule, never on `thin` read here', () => {
    // `thin === null` must read as neither thin nor healthy, and that
    // distinction lives in `warningNeeded` where a test can state it.
    expect(PAGE_SOURCE).toContain('if (warningNeeded(extraction) && warningCounts !== null) {');
    expect(PAGE_SOURCE).not.toMatch(/extraction[?.]*\.thin/);
  });

  it('hands the warning two real counts rather than defaulting a missing one to zero', () => {
    // A `?? 0` would let the dialog state "0 usable questions were found across
    // 0 pages" about counts that are simply not in yet, so the absence stops it
    // being mounted at all.
    expect(PAGE_SOURCE).toContain('{warningCounts !== null && (');
    expect(PAGE_SOURCE).toContain('usableQuestionCount={warningCounts.usable}');
    expect(PAGE_SOURCE).toContain('pageCount={warningCounts.pages}');
    expect(PAGE_SOURCE).not.toContain('?? 0}');
    expect(PAGE_SOURCE).toContain(
      'extraction !== null && extraction.usableQuestionCount !== null && extraction.pageCount !== null',
    );
  });

  it('never disables the proceed control for the verdict', () => {
    const proceed = PAGE_SOURCE.slice(PAGE_SOURCE.indexOf('onClick={proceedToGenerate}'));
    const control = proceed.slice(0, proceed.indexOf('</PrimaryButton>'));
    expect(control).toContain('data-testid="extraction-proceed"');
    expect(control).not.toContain('disabled');
    // And nothing above it in the same element disables it either.
    const opened = PAGE_SOURCE.lastIndexOf(
      '<PrimaryButton',
      PAGE_SOURCE.indexOf('proceedToGenerate'),
    );
    expect(
      PAGE_SOURCE.slice(opened, PAGE_SOURCE.indexOf('onClick={proceedToGenerate}')),
    ).not.toContain('disabled');
  });

  it('polls until the job settles and clears the timer when it stops', () => {
    expect(PAGE_SOURCE).toContain('if (!stopped && !isSettled(view.status)) timer = setTimeout(');
    expect(PAGE_SOURCE).toContain('if (timer !== null) clearTimeout(timer);');
    // And bumps the counter on the way out, so a response already in flight is
    // inapplicable after unmount — which clearing the timer alone cannot do.
    expect(PAGE_SOURCE).toContain('applyIfCurrent(extractionCurrent.current, issued');
  });

  it('ends Parent View on the poll exactly as every other call does', () => {
    const poll = PAGE_SOURCE.slice(PAGE_SOURCE.indexOf('parentApi.extraction('));
    expect(poll.slice(0, poll.indexOf('read();'))).toContain('if (endsParentView(cause)) {');
  });

  it('shows the job’s own reason for a failure, announced as a failure', () => {
    expect(PAGE_SOURCE).toContain(
      '{extraction.failureReason ?? parentCopy.capture.generate.readFailed}',
    );
    // Rendered the way every other failure on this screen is: a bare paragraph
    // would never tell a screen reader the reading had failed at all.
    const branch = PAGE_SOURCE.slice(PAGE_SOURCE.indexOf("extraction.status === 'Failed' ? ("));
    const rendered = branch.slice(0, branch.indexOf('</Alert>'));
    expect(rendered).toContain('severity="error"');
    expect(rendered).toContain('role="alert"');
    expect(rendered).toContain('data-testid="extraction-failed"');
  });

  it('opens a fresh draft on retake, and says so rather than implying the pages return', () => {
    const retake = PAGE_SOURCE.slice(PAGE_SOURCE.indexOf('function retakePages()'));
    const body = retake.slice(0, retake.indexOf('\n  }'));
    // Announced from the draft the server answered with, never up front: a
    // failed open would otherwise claim a new upload started beside an error
    // saying it did not.
    expect(body).toContain('openDraft(() => announce(parentCopy.capture.generate.retakeStarted));');
    expect(body).not.toMatch(/openDraft\(\);\s*\n\s*announce\(/);
    expect(parentCopy.capture.generate.retakeStarted).toContain('new upload');
    expect(parentCopy.capture.generate.retakeStarted).not.toContain('Generation Allowance');
  });

  it('leaves for the generate route rather than revealing a section in place', () => {
    // The flow has to survive leaving the screen, and only a URL-addressable
    // route does: a section revealed here could restore nothing on a return.
    expect(PAGE_SOURCE).toContain('announce(parentCopy.capture.generate.leaving)');
    expect(PAGE_SOURCE).toContain('router.push(`/parent/generate/${sourceTest!.id}`)');
    expect(PAGE_SOURCE).not.toContain('generateReached');
  });

  it('states every one of its own words from the copy module', () => {
    const code = PAGE_SOURCE.split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
    for (const marker of ['generate.heading', 'generate.reading', 'generate.proceed']) {
      expect(code).toContain(`parentCopy.capture.${marker}`);
    }
  });

  it('holds no threshold of its own, anywhere in the screen or its rules', () => {
    const rules = readFileSync(
      path.resolve(DIR, '..', '..', '..', 'lib', 'extraction-status.ts'),
      'utf8',
    );
    for (const source of [PAGE_SOURCE, rules]) {
      expect(source).not.toMatch(/usableQuestionCount\s*[<>]/);
      expect(source).not.toMatch(/pageCount\s*\*/);
    }
  });
});

/**
 * Story 3.1's surfaces: the inverted viewfinder, the guidance each camera
 * status renders, and the library control that never goes away.
 *
 * `apps/web` runs without a DOM, so what can be rendered here is the two
 * hook-free components; the rules that only the stateful component and the
 * screen can hold are asserted against their source, the way every other rule
 * on this screen that needs a router is.
 */
const ADD_PAGES_SOURCE = readFileSync(path.resolve(DIR, 'AddPages.tsx'), 'utf8');
const VIEWFINDER_SOURCE = readFileSync(path.resolve(DIR, 'CameraViewfinder.tsx'), 'utf8');

/** The web app's whole source tree, for the rules that are about absence. */
const WEB_SRC = path.resolve(DIR, '../../..');

/** Every TypeScript source file under a directory, recursively. */
function sourceFilesUnder(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.resolve(root, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function renderViewfinder(overrides: Partial<CameraViewfinderProps> = {}): string {
  const props: CameraViewfinderProps = {
    pageCount: 2,
    maxPages: 10,
    busy: false,
    onCapture: () => undefined,
    onClose: () => undefined,
    ...overrides,
  };
  return renderToStaticMarkup(
    createElement(ThemeProvider, { theme: parentTheme }, createElement(CameraViewfinder, props)),
  );
}

function renderGuidance(status: CameraStatus): string {
  return renderToStaticMarkup(
    createElement(ThemeProvider, { theme: parentTheme }, createElement(CameraGuidance, { status })),
  );
}

/**
 * The markup without the theme's global stylesheet.
 *
 * `ThemeProvider` emits every palette token as a CSS custom property on
 * `:root`, the light parent primary among them — so "this surface does not reach
 * for the parent primary" is a statement about the surface's own rules and not
 * about the variables the theme declares for the rest of the app.
 */
function withoutGlobalStyles(markup: string): string {
  return markup.replace(/<style data-emotion="css-global[^]*?<\/style>/g, '');
}

/**
 * One `<button>` element's own markup, so an assertion about the shutter cannot
 * be satisfied by Done's attributes — or by the stylesheet rendered beside them.
 */
function buttonFor(markup: string, testId: string): string {
  const segment = markup
    .split('<button')
    .slice(1)
    .find((candidate) => candidate.includes(`data-testid="${testId}"`));
  if (segment === undefined) throw new Error(`No button for ${testId}.`);
  return segment.slice(0, segment.indexOf('</button>'));
}

/**
 * The CSS emotion actually generated for one control, and for nothing else.
 *
 * The declarations are not on the element — emotion emits a `<style>` block and
 * puts only its class on the tag — so "the shutter meets the tap-target floor"
 * cannot be read off the element's own markup, and matching the whole document
 * for the floor would be satisfied by the theme's global stylesheet instead. This
 * resolves the control's generated class and returns every rule written for it,
 * base and pseudo-class alike.
 */
function stylesFor(markup: string, testId: string): string {
  const generated = /\bcss-([A-Za-z0-9_-]+)\b/.exec(buttonFor(markup, testId));
  if (generated === null) throw new Error(`No generated class on ${testId}.`);
  const rules = [
    ...markup.matchAll(new RegExp(`\\.css-${generated[1]!}\\b[^{]*\\{([^}]*)\\}`, 'g')),
  ];
  if (rules.length === 0) throw new Error(`No rules emitted for ${testId}.`);
  return rules.map((rule) => rule[1]!).join(';');
}

describe('the viewfinder is the one inverted surface', () => {
  it('paints its ground, border, accent and text from the on-inverted tokens', () => {
    // Through the same filter the negative test uses. `ThemeProvider` emits every
    // palette token — all four of these among them — into its global stylesheet,
    // so read off the raw markup this assertion would pass even if
    // `CameraViewfinder` reached for none of them.
    const markup = withoutGlobalStyles(renderViewfinder());
    for (const value of [
      colorTokens.backgroundInverted.light,
      colorTokens.dividerOnInverted.light,
      colorTokens.primaryOnInverted.light,
      colorTokens.textOnInverted.light,
    ]) {
      expect(markup).toContain(value);
    }
  });

  it('never reaches for the light parent primary, which fails on this ground', () => {
    const markup = withoutGlobalStyles(renderViewfinder());
    // ~2.5:1 on #10202E. The duplication in `tokens.ts` is what keeps a change
    // to the parent palette out of the camera (UX-DR4).
    expect(markup).not.toContain(colorTokens.primaryParent.light);
    expect(markup).not.toContain(colorTokens.divider.light);
  });

  it('holds the four token values nowhere but the token module and this chrome', () => {
    const names = [
      'backgroundInverted',
      'primaryOnInverted',
      'dividerOnInverted',
      'textOnInverted',
    ] as const;
    // The chrome reads every one of them by name.
    for (const name of names) {
      expect(VIEWFINDER_SOURCE).toContain(`colorTokens.${name}.light`);
    }

    // The closed exception, checked against the whole of `apps/web/src` rather
    // than against the two files that happen to sit beside this one: the rule is
    // that *nothing* else reads them, and a guard that only knew about `page.tsx`
    // and `AddPages.tsx` would not notice a third file taking the accent.
    const allowed = new Set([
      path.resolve(WEB_SRC, 'theme/tokens.ts'),
      path.resolve(DIR, 'CameraViewfinder.tsx'),
      // This spec states the rule, so it necessarily names the tokens.
      path.resolve(DIR, 'page.spec.tsx'),
    ]);
    const offenders: string[] = [];
    for (const file of sourceFilesUnder(WEB_SRC)) {
      if (allowed.has(file)) continue;
      const text = readFileSync(file, 'utf8');
      for (const name of names) {
        // Both the token's name and the literal it resolves to: aliasing the
        // value rather than the token would evade a name-only check.
        if (text.includes(name) || text.includes(colorTokens[name].light)) {
          offenders.push(`${path.relative(WEB_SRC, file)} (${name})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the light and dark value of every inverted token identical', () => {
    for (const name of [
      'backgroundInverted',
      'primaryOnInverted',
      'dividerOnInverted',
      'textOnInverted',
    ] as const) {
      expect(colorTokens[name].light).toBe(colorTokens[name].dark);
    }
  });

  it('writes no colour of its own as a literal', () => {
    const code = VIEWFINDER_SOURCE.split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
    expect(code).not.toMatch(/#[0-9A-Fa-f]{6}/);
  });
});

describe('what the viewfinder says and offers', () => {
  it('gives the live camera view an accessible name', () => {
    const markup = renderViewfinder();
    expect(markup).toContain('<video');
    expect(markup).toContain(`aria-label="${parentCopy.capture.camera.viewfinderLabel}"`);
  });

  it('names the page the next shot will become, from the count it is handed', () => {
    // Two pages held: the parent is framing page three.
    expect(renderViewfinder({ pageCount: 2 })).toContain(parentCopy.capture.camera.framing(3));
    expect(renderViewfinder({ pageCount: 0 })).toContain(parentCopy.capture.camera.framing(1));
  });

  it('states the count and the ceiling from the figures the API supplied', () => {
    const markup = renderViewfinder({ pageCount: 4, maxPages: 10 });
    expect(markup).toContain(parentCopy.capture.camera.captured(4, 10));
    // Neither figure is the component's own.
    const code = VIEWFINDER_SOURCE.split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
    expect(code).not.toMatch(/maxPages\s*=\s*\d/);
  });

  it('names the surface by the heading it renders rather than repeating it', () => {
    const markup = renderViewfinder();
    expect(markup).toContain('aria-labelledby="capture-viewfinder-heading"');
    expect(markup).toContain('id="capture-viewfinder-heading"');
  });

  it('meets the tap-target floor on the shutter and on Done, from the token', () => {
    const markup = renderViewfinder();
    expect(markup).toContain(parentCopy.capture.camera.shutter);
    expect(markup).toContain(parentCopy.capture.camera.done);
    // Scoped to each control's own generated rules rather than matched anywhere
    // in the document: the theme's global stylesheet carries the same floor for
    // the app's own controls, so an unscoped match would pass with a viewfinder
    // whose buttons set no size at all.
    for (const testId of ['viewfinder-shutter', 'viewfinder-done']) {
      const rules = stylesFor(markup, testId);
      expect(rules).toContain(`min-height:${density.tapTarget}px`);
      expect(rules).toContain(`min-width:${density.tapTarget}px`);
    }
    const code = VIEWFINDER_SOURCE.split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
    expect(code).toContain('controlSx');
    expect(code).not.toMatch(/minHeight:\s*\d/);
  });

  it('locks the shutter while an add is in flight, but never the way out', () => {
    const markup = renderViewfinder({ busy: true });
    expect(buttonFor(markup, 'viewfinder-shutter')).toContain('disabled');
    // Done stays usable: a locked viewfinder with no exit is a trap.
    expect(buttonFor(markup, 'viewfinder-done')).not.toContain('disabled');
  });

  it('refuses the shutter once the upload is full', () => {
    const markup = renderViewfinder({ pageCount: 10, maxPages: 10 });
    expect(buttonFor(markup, 'viewfinder-shutter')).toContain('disabled');
    // And offers it again the moment there is a slot.
    expect(
      buttonFor(renderViewfinder({ pageCount: 9, maxPages: 10 }), 'viewfinder-shutter'),
    ).not.toContain('disabled');
  });

  it('states every one of its words from the copy module', () => {
    const code = VIEWFINDER_SOURCE.split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
    for (const marker of [
      'camera.heading',
      'camera.viewfinderLabel',
      'camera.framing',
      'camera.captured',
      'camera.shutter',
      'camera.done',
    ]) {
      expect(code).toContain(marker);
    }
  });
});

describe('the camera being unusable is never a dead end', () => {
  it('says nothing at all before the camera has been asked, or once it works', () => {
    // Nothing but the theme's own stylesheet: no sentence, and no element
    // carrying one.
    for (const status of ['unknown', 'ready'] as const) {
      const markup = renderGuidance(status);
      expect(markup).not.toContain('data-testid');
      expect(markup).not.toContain(parentCopy.capture.camera.cameraFallback);
    }
  });

  it('names site settings when the permission was refused', () => {
    const markup = renderGuidance('denied');
    expect(markup).toContain('camera-denied');
    expect(markup).toContain('site settings');
    // And says the library is still there.
    expect(markup).toContain(parentCopy.capture.camera.cameraFallback);
  });

  it('says the camera cannot be used when there is no camera to use', () => {
    const markup = renderGuidance('unavailable');
    expect(markup).toContain('camera-unavailable');
    expect(markup).toContain(parentCopy.capture.camera.cameraUnavailable);
    expect(markup).toContain(parentCopy.capture.camera.cameraFallback);
  });

  it('maps a refusal to `denied` and every other rejection to `unavailable`', () => {
    expect(ADD_PAGES_SOURCE).toContain("cause.name === 'NotAllowedError'");
    expect(ADD_PAGES_SOURCE).toContain("? 'denied'");
    expect(ADD_PAGES_SOURCE).toContain(": 'unavailable'");
    // A missing API is answered before it is called, not by catching a throw.
    expect(ADD_PAGES_SOURCE).toContain("typeof devices.getUserMedia !== 'function'");
  });

  it('treats a blocked origin as denied too, since its remedy is the same', () => {
    // `SecurityError` is what a blocked or insecure origin raises instead of
    // `NotAllowedError`. Both are answered with the site-settings guidance,
    // because in both cases that is where the parent has to go.
    expect(ADD_PAGES_SOURCE).toContain("cause.name === 'SecurityError'");
    const mapping = ADD_PAGES_SOURCE.slice(ADD_PAGES_SOURCE.indexOf('    } catch (cause) {'));
    const denied = mapping.slice(0, mapping.indexOf(": 'unavailable'"));
    expect(denied).toContain("'NotAllowedError'");
    expect(denied).toContain("'SecurityError'");
    // And the documented contract says so, rather than naming only one of them.
    const doc = ADD_PAGES_SOURCE.slice(0, ADD_PAGES_SOURCE.indexOf('export type CameraStatus'));
    expect(doc).toContain('SecurityError');
  });

  it('guards against a second open firing before the first getUserMedia call resolves', () => {
    // `streamRef.current !== null` alone only blocks a second open once the
    // first has already resolved into a stored stream — two clicks before the
    // permission prompt settles would both pass that check and both call
    // `getUserMedia`. `openingRef` closes that window.
    const guard = ADD_PAGES_SOURCE.slice(
      ADD_PAGES_SOURCE.indexOf('const openCamera = useCallback'),
      ADD_PAGES_SOURCE.indexOf('const closeCamera = useCallback'),
    );
    expect(guard).toContain('if (streamRef.current !== null || openingRef.current) return;');
    expect(guard).toContain('openingRef.current = true;');
    expect(guard).toContain('openingRef.current = false;');
  });

  it('closes the viewfinder and asks for guidance when a track ends underneath it', () => {
    // Permission revoked from the address bar, webcam unplugged, another app
    // taking the device. Without this the viewfinder freezes on its last frame
    // and the shutter keeps posting it.
    expect(ADD_PAGES_SOURCE).toContain("track.addEventListener('ended', handleTrackEnded)");
    const handler = ADD_PAGES_SOURCE.slice(
      ADD_PAGES_SOURCE.indexOf('const handleTrackEnded = useCallback'),
    );
    const body = handler.slice(0, handler.indexOf('\n  }, ['));
    expect(body).toContain('stopStream();');
    expect(body).toContain('setOpen(false);');
    expect(body).toContain("setStatus('unavailable');");
  });

  it('gates the library control on the cap alone and never on the camera', () => {
    // The whole of the fallback rule: `addable` mentions no camera status, so
    // no status can disable the input.
    expect(ADD_PAGES_SOURCE).toContain('const addable = editable && !full;');
    expect(ADD_PAGES_SOURCE).toContain('disabled={busy || !addable}');
    expect(ADD_PAGES_SOURCE).not.toMatch(/disabled=\{[^}]*status/);
  });
});

describe('the library control', () => {
  it('takes several photos in one action and names every format ingest accepts', () => {
    expect(ADD_PAGES_SOURCE).toContain('multiple');
    expect(ADD_PAGES_SOURCE).toContain('accept={ACCEPTED_IMAGE_TYPES}');
    // Never the wildcard the placeholder used, which admitted formats the
    // server then refused.
    expect(ADD_PAGES_SOURCE).not.toContain('accept="image/*"');
    expect(PAGE_SOURCE).not.toContain('accept="image/*"');
  });

  it('trims against the remaining slots and hands the trim on to be announced', () => {
    expect(ADD_PAGES_SOURCE).toContain('splitSelection(chosen, pageCount, maxPages)');
    // Nothing is posted for a trimmed file: the accepted array is all that goes,
    // and the count that did not fit rides along to be said in one sentence with
    // the count that did.
    expect(ADD_PAGES_SOURCE).toContain('onAdd(accepted, rejectedCount)');
  });

  it('says the trim itself only when nothing at all could be posted', () => {
    // The one case with no server answer coming, so no combined sentence can be
    // phrased later and this is the only chance to say anything.
    const choose = ADD_PAGES_SOURCE.slice(ADD_PAGES_SOURCE.indexOf('function chooseFromLibrary'));
    const body = choose.slice(0, choose.indexOf('\n  }'));
    expect(body).toContain('if (accepted.length === 0) {');
    expect(body).toContain('parentCopy.capture.rejectedCount(rejectedCount)');
    // Exactly one announcement in the whole function: a second into the same
    // region would replace the first.
    expect(body.match(/onAnnounce\(/g)).toHaveLength(1);
  });

  it('names the control for what it offers rather than for one platform', () => {
    // There is no camera roll on Android or on a desktop, and this is the same
    // control on all three.
    expect(parentCopy.capture.camera.libraryLabel).not.toMatch(/camera roll/i);
    expect(parentCopy.capture.camera.libraryLabel).toMatch(/photos/i);
  });

  it('takes its accessible name from the visible label and not from both', () => {
    // `htmlFor` already names the input. An `aria-label` carrying the same words
    // would override the label with a copy of itself and be announced twice.
    expect(ADD_PAGES_SOURCE).toContain('htmlFor="capture-add-page"');
    const input = ADD_PAGES_SOURCE.slice(ADD_PAGES_SOURCE.indexOf('id="capture-add-page"'));
    expect(input.slice(0, input.indexOf('/>'))).not.toContain('aria-label');
  });

  it('announces both halves of an outcome in one sentence', () => {
    // One polite region: two messages mean the parent only ever hears the
    // second, so a trim announced on its own would be lost behind the success.
    const both = parentCopy.capture.addOutcome(1, 2);
    expect(both).toBe('One page was added. 2 photos were not added — this upload is full.');
    // And nothing is tacked on when nothing was turned away.
    expect(parentCopy.capture.addOutcome(3, 0)).toBe('3 pages were added.');
  });

  it('never announces a count of zero pages as though it were a number', () => {
    // The delta is the difference between two server reads, so a first file that
    // failed arrives here as zero — and "0 pages were added" reads as a bug.
    expect(parentCopy.capture.addedCount(0)).toBe('No pages were added.');
    expect(parentCopy.capture.addedCount(-1)).toBe('No pages were added.');
    expect(parentCopy.capture.addOutcome(0, 2)).toBe(
      'No pages were added. 2 photos were not added — this upload is full.',
    );
  });
});

describe('the camera is asked for a frame worth extracting from', () => {
  it('states an ideal resolution rather than taking the browser default', () => {
    // A browser default is commonly 640×480 — a quarter of the detail the picker
    // beside this control would have produced for the same page, and these pages
    // are read by a vision model.
    expect(ADD_PAGES_SOURCE).toContain('width: { ideal: CAPTURE_IDEAL_WIDTH }');
    expect(ADD_PAGES_SOURCE).toContain('height: { ideal: CAPTURE_IDEAL_HEIGHT }');
    // `ideal`, never `min`: a device that cannot reach it must still open.
    const constraints = ADD_PAGES_SOURCE.slice(ADD_PAGES_SOURCE.indexOf('devices.getUserMedia({'));
    expect(constraints.slice(0, constraints.indexOf('});'))).not.toContain('min:');
  });

  it('writes both figures as named constants rather than inline literals', () => {
    const code = ADD_PAGES_SOURCE.split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
    expect(code).toMatch(/const CAPTURE_IDEAL_WIDTH = \d+;/);
    expect(code).toMatch(/const CAPTURE_IDEAL_HEIGHT = \d+;/);
    // The constraint object names them; it does not restate the numbers.
    const constraints = code.slice(code.indexOf('devices.getUserMedia({'));
    expect(constraints.slice(0, constraints.indexOf('});'))).not.toMatch(/ideal: \d/);
  });
});

describe('the stream this screen obtains', () => {
  it('is stopped track by track, on close and on unmount alike', () => {
    expect(ADD_PAGES_SOURCE).toContain('for (const track of stream.getTracks()) track.stop();');
    // The same cleanup, registered as the effect's teardown — which is what
    // Parent View ending runs when it unmounts this tree.
    const unmount = ADD_PAGES_SOURCE.slice(ADD_PAGES_SOURCE.indexOf('mountedRef.current = true;'));
    const teardown = unmount.slice(0, unmount.indexOf('}, [stopStream]);'));
    expect(teardown).toContain('mountedRef.current = false;');
    expect(teardown).toContain('stopStream();');
    // And it is the only holder of a stream, so there is nowhere else a track
    // can survive.
    expect(PAGE_SOURCE).not.toContain('getUserMedia');
    expect(PAGE_SOURCE).not.toContain('MediaStream');
  });

  it('stops a stream that arrives after nothing wants it any more', () => {
    // `getUserMedia` resolves behind a permission prompt, so it can land seconds
    // after the parent pressed Done or left the screen — by which time cleanup
    // has run and `stopStream` can no longer reach a stream that was never
    // stored. It is stopped on the spot instead.
    const open = ADD_PAGES_SOURCE.slice(ADD_PAGES_SOURCE.indexOf('const openCamera = useCallback'));
    const guard = open.slice(0, open.indexOf('streamRef.current = stream;'));
    expect(guard).toContain('if (!mountedRef.current || openRequestRef.current !== request) {');
    expect(guard).toContain('for (const track of stream.getTracks()) track.stop();');
    expect(guard).toContain('return;');
    // Closing supersedes an open still in flight, which is what makes the
    // counter check above true for a stream nobody is waiting for.
    const close = ADD_PAGES_SOURCE.slice(ADD_PAGES_SOURCE.indexOf('const closeCamera'));
    expect(close.slice(0, close.indexOf('\n  }, ['))).toContain('openRequestRef.current += 1;');
  });

  it('refuses to open a second camera over a stream it already holds', () => {
    // Overwriting `streamRef` would orphan the first stream's tracks: the camera
    // would stay on with nothing left that could stop it.
    const open = ADD_PAGES_SOURCE.slice(ADD_PAGES_SOURCE.indexOf('const openCamera = useCallback'));
    const head = open.slice(0, open.indexOf('const devices'));
    expect(head).toContain('if (streamRef.current !== null || openingRef.current) return;');
  });
});

describe('the shutter takes one frame per press', () => {
  it('ignores a second press while a frame is still becoming a file', () => {
    // `canvas.toBlob` is asynchronous, so the screen's `busy` is still false and
    // the control still enabled when a second press arrives. Two `onAdd` calls
    // would reach one `write`, which drops the second without a word.
    const capture = ADD_PAGES_SOURCE.slice(ADD_PAGES_SOURCE.indexOf('const capture = useCallback'));
    const body = capture.slice(0, capture.indexOf('\n  }, ['));
    expect(body).toContain('if (capturingRef.current) return;');
    expect(body).toContain('capturingRef.current = true;');
    // Cleared before the blob is inspected, so the null-blob path unlocks too
    // rather than jamming the shutter for the rest of the session.
    const callback = body.slice(body.indexOf('canvas.toBlob('));
    expect(callback.indexOf('capturingRef.current = false;')).toBeLessThan(
      callback.indexOf('if (blob === null) return;'),
    );
  });
});

describe('capture is continuous', () => {
  it('leaves the viewfinder open after a page is taken', () => {
    // The whole point of the surface: ten pages are ten shutter presses, not
    // ten trips through opening the camera again.
    const capture = ADD_PAGES_SOURCE.slice(ADD_PAGES_SOURCE.indexOf('const capture = useCallback'));
    const body = capture.slice(0, capture.indexOf('\n  }, ['));
    expect(body).toContain('onAdd(');
    expect(body).not.toContain('setOpen(');
    expect(body).not.toContain('stopStream(');
  });

  it('closes on the one control that exists to close it, and nowhere else', () => {
    // `closeCamera` is Done's handler and the only thing that puts the surface
    // away, so "still open" is a property of every other path by construction.
    expect(ADD_PAGES_SOURCE).toContain('const closeCamera = useCallback(() => {');
    expect(ADD_PAGES_SOURCE).toContain('onClose={closeCamera}');
    expect(VIEWFINDER_SOURCE).toContain('onClose');
  });
});

describe('what the screen does with the pages it is handed', () => {
  it('renders the capture surface rather than a placeholder input of its own', () => {
    expect(PAGE_SOURCE).toContain('<AddPages');
    expect(PAGE_SOURCE).toContain('onAdd={addPages}');
    expect(PAGE_SOURCE).not.toContain('type="file"');
  });

  it('posts a whole selection inside one write, in order', () => {
    // `write` drops a call while one is pending, so a per-file loop over it
    // would silently lose every page after the first.
    expect(PAGE_SOURCE).toContain("'add',");
    expect(PAGE_SOURCE).toContain('for (const file of files) {');
    expect(PAGE_SOURCE).toContain('after = await parentApi.addSourceTestPage(');
    // One `write('add'` in the whole screen.
    expect(PAGE_SOURCE.match(/write\(\s*'add'/g)).toHaveLength(1);
  });

  it('announces the count the server ended up holding, not the count attempted', () => {
    expect(PAGE_SOURCE).toContain(
      'parentCopy.capture.addOutcome(after.pages.length - before, rejectedCount)',
    );
  });

  it('keeps the strip honest when a file part-way through the run is refused', () => {
    // `write`'s own catch never calls `setSourceTest`, so throwing out of the run
    // would leave the strip showing the list from before the add while the server
    // held the pages that did land. The run returns the last answer instead, and
    // sets the error itself — after `write` has cleared it — so the parent gets
    // the refusal *and* the count that landed.
    const add = PAGE_SOURCE.slice(PAGE_SOURCE.indexOf('function addPages('));
    const run = add.slice(0, add.indexOf('parentCopy.capture.addOutcome'));
    expect(run).toContain('} catch (cause) {');
    expect(run).toContain('return after;');
    expect(run).toContain('setError(');
    // Parent View ending is not a page failure and must still reach `write`,
    // which is the only thing that knows how to leave.
    expect(run).toContain('if (endsParentView(cause)) throw cause;');
  });

  it('phrases both announcements in pages rather than in photos or files', () => {
    expect(parentCopy.capture.addedCount(1)).toBe('One page was added.');
    expect(parentCopy.capture.addedCount(3)).toBe('3 pages were added.');
    expect(parentCopy.capture.rejectedCount(1)).toContain('One photo was not added');
    expect(parentCopy.capture.rejectedCount(2)).toContain('2 photos were not added');
  });

  it('keeps the cap the API’s, in the surface as well as the screen', () => {
    expect(PAGE_SOURCE).toContain('maxPages={maxPages}');
    expect(PAGE_SOURCE).toContain('parentCopy.capture.limitReached(maxPages)');
    const code = ADD_PAGES_SOURCE.split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
    expect(code).not.toMatch(/maxPages\s*=\s*\d/);
  });
});

describe('the legibility result', () => {
  it('states every verdict as glyph and text, never as colour alone', () => {
    // The accessibility rule the epic states: the glyph is hidden from
    // assistive technology and the word beside it is what is read, so a
    // parent who cannot tell the two colours apart still gets the verdict.
    expect(STRIP_SOURCE).toContain('<Box component="span" aria-hidden="true">');
    expect(STRIP_SOURCE).toContain('parentCopy.capture.legibility.verdictFor(');
    expect(parentCopy.capture.legibility.readable).toBe('Readable');
    expect(parentCopy.capture.legibility.blurry).toBe('Blurry');
    expect(parentCopy.capture.legibility.verdictFor(2, parentCopy.capture.legibility.blurry)).toBe(
      'Page 2: Blurry',
    );
  });

  it('names the pages it flagged rather than counting them', () => {
    expect(parentCopy.capture.legibility.flagged([2])).toBe('Page 2 may be too blurry to read.');
    expect(parentCopy.capture.legibility.flagged([1, 3])).toBe(
      'Pages 1 and 3 may be too blurry to read.',
    );
    expect(parentCopy.capture.legibility.flagged([1, 2, 4])).toBe(
      'Pages 1, 2 and 4 may be too blurry to read.',
    );
  });

  it('says so when nothing was flagged, rather than leaving silence to mean it', () => {
    expect(parentCopy.capture.legibility.allReadable).toBe('Every page reads clearly.');
  });

  it('offers a retake scoped to the flagged page alone', () => {
    expect(parentCopy.capture.legibility.retakeFor(2)).toBe('Retake page 2');
    // It drives the strip's own per-page retake input by `htmlFor` rather
    // than adding a second way to replace a page's bytes.
    expect(PAGE_SOURCE).toContain('htmlFor={`capture-retake-${page.id}`}');
    expect(STRIP_SOURCE).toContain('id={`capture-retake-${page.id}`}');
    // And it exists only for a page the check flagged.
    expect(PAGE_SOURCE).toContain('pages.filter((page) => !isPageReadable(page))');
  });

  it('says plainly that continuing over a flagged page is allowed', () => {
    expect(parentCopy.capture.legibility.advisory).toBe(
      'This is a warning, not a block. Continuing is allowed.',
    );
  });

  it('states the cost beforehand, in words, above the control that spends it', () => {
    expect(parentCopy.capture.legibility.cost).toBe(
      'Continuing commits this upload and uses one upload allowance.',
    );
    expect(parentCopy.capture.legibility.noCost).toBe(
      'Nothing is used if you leave without continuing.',
    );
    // Both sentences are rendered before the commit control in source order,
    // which is the order they are read in.
    const panel = PAGE_SOURCE.slice(PAGE_SOURCE.indexOf('data-testid="legibility-result"'));
    expect(panel.indexOf('legibility-cost')).toBeLessThan(panel.indexOf('legibility-continue'));
    expect(panel.indexOf('legibility-no-cost')).toBeLessThan(panel.indexOf('legibility-continue'));
  });

  it('states no figure and shows no usage counter — Story 9.6 owns that surface', () => {
    const block = JSON.stringify(parentCopy.capture.legibility);
    expect(block).not.toMatch(/\b\d+\s*(uploads?|allowances?|left|remaining)\b/i);
    expect(block.toLowerCase()).not.toContain('remaining');
  });

  it('never disables the commit control for a flagged page', () => {
    // The check is advisory and the server commits over a `Low` verdict, so a
    // client-side refusal here would be a gate the product does not have.
    const panel = PAGE_SOURCE.slice(PAGE_SOURCE.indexOf('data-testid="legibility-continue"') - 400);
    const control = panel.slice(0, panel.indexOf('data-testid="legibility-continue"'));
    expect(control).toContain('disabled={busy}');
    expect(control).not.toContain('flagged');
  });

  it('names the count the commit control is about to commit', () => {
    expect(parentCopy.capture.legibility.continueWith(1)).toBe('Continue with 1 page');
    expect(parentCopy.capture.legibility.continueWith(3)).toBe('Continue with all 3 pages');
  });

  it('runs the check on the shared write path, so the strip locks', () => {
    expect(PAGE_SOURCE).toContain("'check',");
    expect(PAGE_SOURCE).toContain('parentApi.checkSourceTestLegibility(token!, sourceTest!.id)');
    expect(PAGE_SOURCE).toContain(
      'parentCopy.capture.legibility.checked(unreadablePages(after.pages).length)',
    );
  });

  it('announces the outcome from the answer the server returned', () => {
    expect(parentCopy.capture.legibility.checked(0)).toBe(
      'The pages were checked. Every page reads clearly.',
    );
    expect(parentCopy.capture.legibility.checked(1)).toBe(
      'The pages were checked. One page may be too blurry to read.',
    );
    expect(parentCopy.capture.legibility.checked(2)).toBe(
      'The pages were checked. 2 pages may be too blurry to read.',
    );
  });

  it('says what is happening while the foreground call is in flight', () => {
    expect(parentCopy.capture.legibility.checking).toBe('Checking how clearly the pages read…');
    expect(PAGE_SOURCE).toContain("pending === 'check'");
  });

  it('describes committing, not checking, while the commit is in flight', () => {
    // `capture.submitting` now reads "Checking…" and belongs to the control
    // before this one. A commit button wearing it would describe the wrong
    // step at the one moment an Upload Allowance is actually spent.
    expect(parentCopy.capture.submitting).toBe('Checking…');
    expect(parentCopy.capture.legibility.committing).toBe('Committing the upload…');
    expect(PAGE_SOURCE).toContain('parentCopy.capture.legibility.committing');
    const panel = PAGE_SOURCE.slice(PAGE_SOURCE.indexOf('data-testid="legibility-result"'));
    const commit = panel.slice(0, panel.indexOf('data-testid="legibility-continue"'));
    expect(commit).not.toContain('parentCopy.capture.submitting');
  });

  it('states the third submit reason without a code or an apology', () => {
    expect(parentCopy.capture.submitBlocked(['legibility'])).toBe(
      'Check the pages before submitting.',
    );
    expect(parentCopy.capture.submitBlocked(['pages', 'classification', 'legibility'])).toBe(
      'Add at least one page before submitting. Choose a subject and a grade level before submitting. Check the pages before submitting.',
    );
  });
});

describe('what a refused commit puts on the screen', () => {
  /**
   * The server's sentence, kept deliberately opaque.
   *
   * What is under test is that the API's own words win, not what those words
   * say — and the words themselves name an Account Tier, an Upload Allowance
   * figure and a reset date, none of which this app may restate. A fixture
   * spelling them out would both break that rule and compare the expectation
   * against itself.
   */
  const SERVER_SAID = 'A sentence only the API authored.';
  const atCap = new ParentApiError('generic', 409, null, false, false, SERVER_SAID);

  it('shows the API’s own sentence rather than the screen’s generic one', () => {
    expect(writeRefusal(atCap)).toBe(SERVER_SAID);
    expect(writeRefusal(atCap)).not.toBe(parentCopy.capture.failed);
  });

  it('falls back to the error’s own message when the API authored no sentence', () => {
    expect(writeRefusal(new ParentApiError('boom', 503))).toBe('boom');
  });

  it('falls back to the screen’s sentence for a throw that is not an Error', () => {
    expect(writeRefusal('boom')).toBe(parentCopy.capture.failed);
  });

  it('leaves the parent in Parent View: a refused commit is not an expired session', () => {
    expect(endsParentView(atCap)).toBe(false);
  });

  it('is the rule the shared write path actually uses', () => {
    // The catch that every control's mutation funnels through, the commit
    // among them. An expression re-inlined there would pass every test above
    // while the screen quietly went back to dropping the sentence.
    const write = PAGE_SOURCE.slice(PAGE_SOURCE.indexOf('async function write('));
    expect(write.slice(0, write.indexOf('finally'))).toContain('setError(writeRefusal(cause));');
  });

  it('states no tier, no upload figure and no reset date of its own', () => {
    // All three originate in the API. This app must not carry a second copy of
    // any of them.
    const ours = JSON.stringify(parentCopy.capture);
    // The enum itself rather than a second transcription of it, so a fifth
    // tier is covered the day it is added.
    for (const tier of ACCOUNT_TIERS) {
      expect(ours).not.toContain(tier);
    }
    expect(ours).not.toContain('Account Tier');
    expect(ours).not.toContain('resets');
  });
});
