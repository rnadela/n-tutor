import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from './database';

/**
 * Where the API's `log` mail transport also appends its messages during an E2E
 * run. Nothing in the product reads this file — it exists so the browser suite
 * can follow a real reset link, which is the only way to prove the round trip.
 */
export const MAIL_LOG_FILE = path.join(repoRoot, 'e2e', 'test-results', 'mail.jsonl');

export interface SentMail {
  from: string;
  to: string;
  subject: string;
  text: string;
}

export function readSentMail(): SentMail[] {
  if (!existsSync(MAIL_LOG_FILE)) return [];
  const messages: SentMail[] = [];
  for (const line of readFileSync(MAIL_LOG_FILE, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      messages.push(JSON.parse(line) as SentMail);
    } catch {
      // A line read mid-append is torn, not corrupt: the poller sees it whole
      // on its next pass.
      continue;
    }
  }
  return messages;
}

export function clearSentMail(): void {
  rmSync(MAIL_LOG_FILE, { force: true });
}

/** The last message sent to `email`, or `undefined` when none was. */
export function lastMailTo(email: string): SentMail | undefined {
  return readSentMail()
    .filter((message) => message.to === email)
    .at(-1);
}

/** The reset link out of a message, as the parent would follow it. */
export function resetLinkFrom(message: SentMail): string {
  const match = /(https?:\/\/\S+)/.exec(message.text);
  if (!match) throw new Error(`No reset link in message: ${message.text}`);
  return match[1];
}
