import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { adminCopy } from '@/copy/admin';
import { parentCopy } from '@/copy/parent';
import { ACCOUNT_TIERS, dateOnly, type AccountConsumption } from '@/lib/consumption-format';
import { parentTheme } from '@/theme/theme';
import { AllowancesPanel, allowancesHeadingId } from './AllowancesPanel';

/** The component's own source, for the rules about what it may not contain. */
const CODE = readFileSync(path.resolve(import.meta.dirname, 'AllowancesPanel.tsx'), 'utf8');

/**
 * A payload whose every figure is arbitrary and belongs to no tier in the tiers
 * table — the point is that whatever the API sends is what renders. The zone is
 * one the test machine cannot share with the other, so a date rendered locally or
 * in UTC has to fail.
 */
function consumptionWith(overrides: Partial<AccountConsumption> = {}): AccountConsumption {
  return {
    periodStart: '2026-08-31T16:00:00.000Z',
    periodEnd: '2026-09-30T16:00:00.000Z',
    resetAt: '2026-09-30T16:00:00.000Z',
    timezone: 'Asia/Manila',
    tier: 'Free',
    studentProfileLimit: 3,
    allowances: {
      upload: { used: 7, limit: 13 },
      generation: { used: 19, limit: 23 },
      explanation: { used: 29, limit: 31 },
    },
    ...overrides,
  };
}

function render(consumption: AccountConsumption): string {
  return renderToStaticMarkup(
    <ThemeProvider theme={parentTheme}>
      <AllowancesPanel consumption={consumption} />
    </ThemeProvider>,
  ).replace(/<style[\s\S]*?<\/style>/gu, '');
}

describe('what the Allowances section states', () => {
  it('is a labelled section whose heading and intro come from the copy file', () => {
    const markup = render(consumptionWith());

    // The heading names the section and the section points at it, so the region is
    // announced rather than being an unnamed group of paragraphs.
    expect(markup).toContain(`aria-labelledby="${allowancesHeadingId}"`);
    expect(markup).toContain(`id="${allowancesHeadingId}"`);
    expect(markup).toContain(parentCopy.settings.allowancesHeading);
    expect(markup).toContain(parentCopy.settings.allowancesIntro);
    // The intro says whose allowances these are: the account's, shared by every
    // profile on it — not the child the parent was last looking at.
    expect(parentCopy.settings.allowancesIntro).toMatch(/account/iu);
  });

  it('states usage against the limit on all three even at cap, refusing nothing', () => {
    // The whole point of the surface: a parent reads their limits *without* being
    // at one, and reading at one is answered rather than refused or blanked.
    const markup = render(
      consumptionWith({
        allowances: {
          upload: { used: 13, limit: 13 },
          generation: { used: 23, limit: 23 },
          explanation: { used: 31, limit: 31 },
        },
      }),
    );

    expect(markup).toContain(
      parentCopy.settings.allowanceUsed(13, '13', parentCopy.settings.uploadUnit),
    );
    expect(markup).toContain(
      parentCopy.settings.allowanceUsed(23, '23', parentCopy.settings.generationUnit),
    );
    expect(markup).toContain(
      parentCopy.settings.allowanceUsed(31, '31', parentCopy.settings.explanationUnit),
    );
    // Nothing is withheld at cap: the tier, all three rows and the reset still
    // render, and no refusal or upgrade prompt appears in their place.
    expect(markup).toContain(parentCopy.settings.allowancesHeading);
    expect(markup.match(/data-testid="allowance-row"/gu)).toHaveLength(3);
    expect(markup).toContain('data-testid="allowances-reset"');
    expect(markup).not.toMatch(/upgrade|refus|cannot|unavailable/iu);
  });

  it('names all three allowances and states each one’s usage against its limit', () => {
    const consumption = consumptionWith();
    const markup = render(consumption);

    expect(markup).toContain(parentCopy.settings.uploadAllowance);
    expect(markup).toContain(parentCopy.settings.generationAllowance);
    expect(markup).toContain(parentCopy.settings.explanationAllowance);

    // Each row's own figures, each denominated in its own unit: "19 of 23 used"
    // says nothing about what was used.
    expect(markup).toContain(
      parentCopy.settings.allowanceUsed(7, '13', parentCopy.settings.uploadUnit),
    );
    expect(markup).toContain(
      parentCopy.settings.allowanceUsed(19, '23', parentCopy.settings.generationUnit),
    );
    expect(markup).toContain(
      parentCopy.settings.allowanceUsed(29, '31', parentCopy.settings.explanationUnit),
    );
  });

  it('denominates the Generation allowance in practice tests, and in nothing else', () => {
    const markup = render(consumptionWith());

    expect(parentCopy.settings.generationUnit).toBe('practice tests');
    expect(markup).toContain('practice tests');
    // The epic's hard copy rule: not a credit, not a request, not a "generation".
    expect(markup).not.toMatch(/generations/iu);
    expect(markup).not.toMatch(/requests/iu);
    expect(markup).not.toMatch(/credits?/iu);
  });

  it('says an unlimited allowance in words, and invents no number for it', () => {
    const markup = render(
      consumptionWith({
        studentProfileLimit: null,
        allowances: {
          upload: { used: 0, limit: null },
          generation: { used: 5, limit: null },
          explanation: { used: 41, limit: null },
        },
      }),
    );

    expect(markup).toContain(
      parentCopy.settings.allowanceUnlimited(5, parentCopy.settings.generationUnit),
    );
    // The Student Profile limit goes through `limitLabel`, so an absent ceiling is
    // the copy file's word for it.
    expect(markup).toContain(adminCopy.accounts.unlimited);
    // No "of N" anywhere, and no "0 left": there is no ceiling to state.
    expect(markup).not.toMatch(/\bof\s+\d/u);
    expect(markup).not.toMatch(/0 left/iu);
  });

  it('renders the reset date in the account’s zone, not the machine’s and not UTC', () => {
    // 2026-09-30T16:00Z is already 01 Oct in Manila and still 30 Sept in New York.
    const manila = render(consumptionWith({ timezone: 'Asia/Manila' }));
    const newYork = render(consumptionWith({ timezone: 'America/New_York' }));

    expect(manila).toContain(
      parentCopy.settings.allowanceResets(dateOnly('2026-09-30T16:00:00.000Z', 'Asia/Manila')),
    );
    expect(newYork).toContain(
      parentCopy.settings.allowanceResets(dateOnly('2026-09-30T16:00:00.000Z', 'America/New_York')),
    );
    expect(manila).not.toBe(newYork);
  });

  it('names the Account Tier, through the copy file’s label for it', () => {
    for (const tier of ACCOUNT_TIERS) {
      const markup = render(consumptionWith({ tier }));
      expect(markup).toContain(parentCopy.settings.tierLine(adminCopy.accounts.tiers[tier]));
    }
  });

  it('restates no figure, tier name or date of its own', () => {
    // Every number and every label on this surface is the API's, read through
    // `limitLabel`, `tierLabel` and `dateOnly`. A literal here would be a second
    // source of truth the Admin console could disagree with.
    const body = CODE.slice(CODE.indexOf('export function AllowancesPanel'));
    expect(body).not.toMatch(/\bFree\b|\bPlus\b|\bFamily\b|\bInternal\b/u);
    expect(body).toContain('limitLabel(');
    expect(body).toContain('tierLabel(');
    expect(body).toContain('dateOnly(');
    // No date arithmetic and no zone of its own: the API sends the instant and
    // the zone it is to be read in.
    expect(body).not.toContain('new Date(');
    expect(body).not.toContain('Intl.');
    // Usage figures use tabular numerals, as the Admin consumption panel does.
    expect(CODE).toContain("fontVariantNumeric: 'tabular-nums'");
  });
});
