import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { adminCopy } from '@/copy/admin';
import type { ProvisionalTopic } from '@/lib/admin-api';
import { parentTheme } from '@/theme/theme';
import { TopicCurationList } from './TopicCurationList';

/**
 * The curation queue's **card layout**, rendered.
 *
 * `admin/topics/page.spec.tsx` asserts this component's source text, and no
 * Playwright suite visits `/admin/topics` at all — so without this file the card
 * branch introduced by Story 1.9 is executed by nothing, and could ship with the
 * wrong fields, a duplicated row-scoped `id` or no cards at all while the whole
 * suite stayed green.
 *
 * `apps/web` runs vitest with `environment: 'node'` and ships no DOM testing
 * library, so this is `renderToStaticMarkup` under the mounted theme, exactly as
 * `MasteryTable.spec.tsx` does it. What a *closed* panel renders is therefore what
 * is observable here; the two state-gated branches — the rename form and the open
 * merge panel — are pinned over the source below, where the one thing that can go
 * wrong about them (an `id` template losing its layout suffix) is visible.
 */
const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'TopicCurationList.tsx'), 'utf8');
/** Comments stripped, so a rule is never satisfied by a sentence about it. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

function topic(over: Partial<ProvisionalTopic> & { topicId: string }): ProvisionalTopic {
  return {
    name: over.topicId,
    subjectId: 's-1',
    subjectName: 'Maths',
    createdAt: '2026-08-29T09:30:00.000Z',
    taggedQuestionCount: 4,
    ...over,
  };
}

const TOPICS: ProvisionalTopic[] = [
  topic({ topicId: 'fractions', name: 'equivalent fractions', taggedQuestionCount: 12 }),
  topic({ topicId: 'decimals', name: 'decimal place value', taggedQuestionCount: 3 }),
];

function render(topics: ProvisionalTopic[]): string {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: parentTheme },
      createElement(TopicCurationList, {
        topics,
        onConfirm: async () => true,
        onRename: async () => true,
        onMerge: async () => true,
        loadTargets: async () => [],
      }),
    ),
  );
}

/** How many times a testid appears in the markup. */
function count(markup: string, testid: string): number {
  return markup.split(`data-testid="${testid}"`).length - 1;
}

/** Every `id` attribute the render emitted, in order. */
function ids(markup: string): string[] {
  return [...markup.matchAll(/\sid="([^"]+)"/gu)].map((match) => match[1]!);
}

describe('what the curation queue renders below the desktop breakpoint', () => {
  it('draws one card per queued topic, in the API’s order', () => {
    const markup = render(TOPICS);
    expect(count(markup, 'topic-card')).toBe(TOPICS.length);
    expect(count(markup, 'topic-row')).toBe(TOPICS.length);
    expect(markup).toContain('data-testid="topic-cards"');
    expect(markup.indexOf('equivalent fractions')).toBeLessThan(
      markup.indexOf('decimal place value'),
    );
  });

  it('names every card by its topic and carries the row’s own facts on it', () => {
    const markup = render([TOPICS[0]!]);
    expect(markup).toContain('aria-label="equivalent fractions"');
    // Each remaining column, under the column's own header as its label.
    for (const label of [
      adminCopy.topics.subjectColumn,
      adminCopy.topics.taggedColumn,
      adminCopy.topics.createdColumn,
    ]) {
      expect(markup, label).toContain(label);
    }
    expect(markup).toContain('Maths');
    // The tagged count, as the count — and countable apart from the table's cell.
    expect(count(markup, 'topic-tagged-count')).toBe(1);
    expect(count(markup, 'topic-tagged-count-card')).toBe(1);
  });

  it('is a real ul of real li cards, named by the section it mirrors', () => {
    const markup = render(TOPICS);
    expect(markup).toContain('<ul');
    expect(markup).toContain('role="list"');
    expect(markup).toContain('role="listitem"');
    expect(markup).toContain(`aria-label="${adminCopy.topics.title}"`);
  });

  it('emits no row-scoped id at all until a row is being acted on', () => {
    // Both layouts hold both rows, so the *only* ids this component can emit are
    // the two state-gated ones — and a closed queue emits neither. That is what
    // makes the suffix rule assertable at all: there is one template per id, and
    // the case below pins it. A duplicate-id check over this render would be a
    // check over an empty list, which is no check.
    const all = ids(render(TOPICS));
    expect(all).toEqual([]);
    expect(all.length).toBe(new Set(all).size);
  });

  it('opens no merge panel until an operator opens one', () => {
    const markup = render(TOPICS);
    expect(count(markup, 'topic-merge-panel')).toBe(0);
    expect(count(markup, 'topic-merge-panel-card')).toBe(0);
    expect(markup).not.toContain(adminCopy.topics.mergeTargetLabel);
  });

  it('renders the empty queue as the empty message and no list at all', () => {
    const markup = render([]);
    expect(markup).toContain(adminCopy.topics.empty);
    expect(count(markup, 'topic-card')).toBe(0);
    expect(count(markup, 'topic-row')).toBe(0);
    expect(markup).not.toContain('<li');
  });
});

describe('the two state-gated branches, over the source', () => {
  it('renders the rename form and the merge panel into both layouts from one definition', () => {
    // One definition each, taking the layout as an argument — so the table's copy
    // and the card's cannot drift into two forms over one row.
    expect(CODE).toContain("renameForm(topic, '')");
    expect(CODE).toContain("renameForm(topic, '-card')");
    expect(CODE).toContain("mergePanel(topic, '')");
    expect(CODE).toContain("mergePanel(topic, '-card')");
  });

  it('gates the merge panel on the merging row, so it opens in one card and no other', () => {
    expect(CODE).toContain("mergingId === topic.topicId && mergePanel(topic, '')");
    expect(CODE).toContain("mergingId === topic.topicId && mergePanel(topic, '-card')");
  });

  it('suffixes every row-scoped id by layout, from a single template', () => {
    // Exactly one template per id, carrying `${idSuffix}`: drop it and the card's
    // visible input loses the label bound to it while every desktop query — which
    // reads the table's unsuffixed id — stays green.
    for (const template of [
      'id={`topic-rename-${topic.topicId}${idSuffix}`}',
      'id={`topic-merge-target-${topic.topicId}${idSuffix}`}',
    ]) {
      expect(CODE.split(template).length - 1, template).toBe(1);
    }
    // And no id written without the suffix anywhere.
    expect(CODE).not.toMatch(/id=\{`topic-(rename|merge-target)-\$\{topic\.topicId\}`\}/u);
  });

  it('keeps the testid of a panel that is in the markup twice apart by layout', () => {
    for (const template of [
      'data-testid={`topic-merge-panel${idSuffix}`}',
      'data-testid={`topic-merge-confirmation${idSuffix}`}',
    ]) {
      expect(CODE, template).toContain(template);
    }
  });
});
