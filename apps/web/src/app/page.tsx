import { redirect } from 'next/navigation';

/** The product's front door is the parent surface; `/admin` is its own entry. */
export default function HomePage(): never {
  redirect('/auth/sign-in');
}
