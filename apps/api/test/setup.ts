import { testDatabaseUrl } from './test-env.js';

// Every PrismaService built inside a test connects to the test database.
process.env.DATABASE_URL = testDatabaseUrl();

// Rate limits are exercised by their own spec; everywhere else they must not
// interfere with a test issuing many requests in a second.
process.env.API_RATE_LIMIT ??= '10000';
process.env.AUTH_RATE_LIMIT ??= '10000';
process.env.PARENT_AUTH_RATE_LIMIT ??= '10000';
