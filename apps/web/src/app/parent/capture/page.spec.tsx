import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { parentCopy } from '@/copy/parent';
import type { PageImageView } from '@/lib/parent-api';
import { parentTheme } from '@/theme/theme';
import { density } from '@/theme/tokens';
import { PageStrip, type PageStripProps } from './PageStrip';
import { ThinExtractionWarning, type ThinExtractionWarningProps } from './ThinExtractionWarning';

const DIR = import.meta.dirname;

/** The screen's own source, for the rules it states rather than renders. */
const PAGE_SOURCE = readFileSync(path.resolve(DIR, 'page.tsx'), 'utf8');

function page(ordinal: number): PageImageView {
  return {
    id: `page-${ordinal}`,
    ordinal,
    state: 'Ready',
    width: 40,
    height: 60,
    byteSize: 512,
    createdAt: '2026-01-01T00:00:00.000Z',
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
    expect(PAGE_SOURCE).toContain('const submittable = isDraft &&');
    expect(PAGE_SOURCE).toContain('{isDraft && (');
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
    expect(parentCopy.capture.added(3)).toBe('Page 3 was added.');
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
    expect(PAGE_SOURCE).toContain('submitBlockedReasons(classification, readyPageCount)');
    expect(PAGE_SOURCE).toContain('isClassified(classification)');
    expect(PAGE_SOURCE).toContain('parentCopy.capture.submitBlocked(blockedReasons)');
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
