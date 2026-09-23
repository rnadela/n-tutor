'use client';

import { createContext, useContext, useMemo } from 'react';

/**
 * Which room the string is being read in.
 *
 * `admin` is here because generated content crosses the Parent PIN: the
 * flagged-Explanation queue renders the same result strings in the Admin
 * console. Without it an Admin screen would have to mislabel itself `parent`
 * to render one at all. It resolves third person by name, exactly as `parent`
 * does — the child is never the reader on either surface.
 */
export type AddressSurface = 'student' | 'parent' | 'admin';

export interface AddressValue {
  surface: AddressSurface;
  /** The student being described — the subject of every result string. */
  subject: string;
  /**
   * How the subject is named in a sentence: `you` in Student Mode, the child's
   * own name in Parent View. Every result/analytics string takes this rather
   * than carrying a fixed literal (UX-DR31).
   */
  name: string;
  /** The same, capitalised for sentence-initial use. */
  Name: string;
  /**
   * The verb agreement that goes with `name`. Both forms are supplied by the
   * caller rather than derived: English agreement is irregular, and a past
   * tense ("scored") is the same on both surfaces while a present tense
   * ("have" / "has") is not.
   */
  verb: (secondPerson: string, thirdPerson: string) => string;
}

const AddressContext = createContext<AddressValue | null>(null);

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Resolves the subject's address for a surface.
 *
 * Exported as a pure function so the rule is testable as behaviour rather than
 * through a render, in a test environment with no DOM.
 */
export function resolveAddress(surface: AddressSurface, rawSubject: string): AddressValue {
  // An empty subject renders " scored 11 of 15." in Parent View — the same
  // silent wrong-copy failure the missing-provider throw exists to prevent.
  const subject = rawSubject.trim();
  if (subject === '') {
    throw new Error('resolveAddress needs the subject being described, and was given none.');
  }
  const second = surface === 'student';
  const name = second ? 'you' : subject;
  return {
    surface,
    subject,
    name,
    Name: second ? capitalise(name) : subject,
    verb: (secondPerson: string, thirdPerson: string) => (second ? secondPerson : thirdPerson),
  };
}

export function AddressProvider({
  surface,
  subject,
  children,
}: {
  surface: AddressSurface;
  subject: string;
  children: React.ReactNode;
}) {
  const value = useMemo(() => resolveAddress(surface, subject), [surface, subject]);
  return <AddressContext.Provider value={value}>{children}</AddressContext.Provider>;
}

/**
 * The surface-aware address in scope.
 *
 * Throws rather than defaulting: a result string rendered with no surface in
 * scope is the exact bug UX-DR31 exists to prevent, and a silent second-person
 * default would ship a child's copy into Parent View.
 */
export function useAddress(): AddressValue {
  const value = useContext(AddressContext);
  if (value === null) {
    throw new Error('useAddress must be used inside an AddressProvider.');
  }
  return value;
}

/**
 * Renders a result/analytics string against the address in scope. The caller
 * supplies the sentence as a function of the address, never as a literal.
 */
export function Addressed({ children }: { children: (address: AddressValue) => React.ReactNode }) {
  return <>{children(useAddress())}</>;
}
