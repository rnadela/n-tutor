import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { testDatabaseUrl } from './test-env.js';

// Every PrismaService built inside a test connects to the test database.
process.env.DATABASE_URL = testDatabaseUrl();

// Rate limits are exercised by their own spec; everywhere else they must not
// interfere with a test issuing many requests in a second.
process.env.API_RATE_LIMIT ??= '10000';
process.env.AUTH_RATE_LIMIT ??= '10000';
process.env.PARENT_AUTH_RATE_LIMIT ??= '10000';

// Page bytes are written to a directory of this run's own, outside the
// repository, so an integration test never writes into the working tree and two
// runs never read each other's files. Nothing removes it: a failed assertion
// about what was stored is worth being able to look at, and the OS reclaims the
// temp directory anyway.
process.env.UPLOAD_ROOT ??= mkdtempSync(path.join(tmpdir(), 'nts-uploads-'));
