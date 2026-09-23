import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AddressProvider, Addressed, resolveAddress, useAddress } from './Address';

/** The result string every surface shares — one sentence, two addresses. */
function score(address: ReturnType<typeof resolveAddress>): string {
  return `${address.Name} ${address.verb('scored', 'scored')} 11 of 15.`;
}

describe('address resolution', () => {
  it('speaks to the child in the second person in Student Mode', () => {
    expect(score(resolveAddress('student', 'Ada'))).toBe('You scored 11 of 15.');
  });

  it('speaks about the child by name in Parent View', () => {
    expect(score(resolveAddress('parent', 'Ada'))).toBe('Ada scored 11 of 15.');
  });

  it('agrees the verb with the address it resolved', () => {
    expect(resolveAddress('student', 'Ada').verb('have', 'has')).toBe('have');
    expect(resolveAddress('parent', 'Ada').verb('have', 'has')).toBe('has');
  });

  it('keeps the subject available even where the address is second person', () => {
    // The string says "you"; the surface still knows whose work it is.
    const address = resolveAddress('student', 'Ada');
    expect(address.subject).toBe('Ada');
    expect(address.name).toBe('you');
  });

  it('resolves through the provider at render time, not at authoring time', () => {
    const markup = renderToStaticMarkup(
      <AddressProvider surface="parent" subject="Ada">
        <Addressed>{score}</Addressed>
      </AddressProvider>,
    );
    expect(markup).toContain('Ada scored 11 of 15.');
    expect(markup).not.toContain('You scored');
  });

  it('renders the same component as second person under the student surface', () => {
    const markup = renderToStaticMarkup(
      <AddressProvider surface="student" subject="Ada">
        <Addressed>{score}</Addressed>
      </AddressProvider>,
    );
    expect(markup).toContain('You scored 11 of 15.');
    expect(markup).not.toContain('Ada scored');
  });

  it('speaks about the child by name in the Admin console too', () => {
    // Generated content crosses the Parent PIN: the flagged-Explanation queue
    // renders result strings in Admin, and the child is not the reader there.
    expect(score(resolveAddress('admin', 'Ada'))).toBe('Ada scored 11 of 15.');
    expect(resolveAddress('admin', 'Ada').verb('have', 'has')).toBe('has');
  });

  it('refuses an empty subject rather than rendering a headless sentence', () => {
    // " scored 11 of 15." is the same silent wrong-copy failure the
    // missing-provider throw exists to prevent.
    expect(() => resolveAddress('parent', '')).toThrow(/subject/u);
    expect(() => resolveAddress('parent', '   ')).toThrow(/subject/u);
    expect(() => resolveAddress('student', '')).toThrow(/subject/u);
  });

  it('throws outside a provider rather than defaulting to a surface', () => {
    // A silent second-person default would ship a child's copy into Parent
    // View — the exact bug UX-DR31 exists to prevent.
    function Orphan() {
      useAddress();
      return null;
    }
    expect(() => renderToStaticMarkup(createElement(Orphan))).toThrow(/AddressProvider/u);
  });
});
