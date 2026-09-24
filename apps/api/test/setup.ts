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

// The extraction worker is off in the integration tier, so a spec drives
// `runOnce()` exactly once and asserts on what that pass did. Left on, a poll
// timer would claim the job first and every assertion about a `Queued` row
// would be a race.
process.env.EXTRACTION_WORKER_ENABLED ??= 'false';

// The generation worker is off for exactly the same reason: a spec drives
// `runOnce()` and asserts on what that pass did, and a poll timer racing it
// would make every assertion about a `Queued` job a coin toss.
process.env.GENERATION_WORKER_ENABLED ??= 'false';

// The injected-fault tests drive the retry loop deliberately, and the real
// backoff is time spent asserting nothing. One attempt is the default here
// because most specs want the fault to surface at once; the specs that are
// about the retry loop itself state their own figures.
process.env.AI_MAX_ATTEMPTS ??= '1';
process.env.AI_RETRY_BASE_MS ??= '1';
