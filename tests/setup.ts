/**
 * The server logger now writes a line per request, so the suite would drown in
 * output. Tests that care about logging install their own sink (see
 * `tests/log.test.ts`); everything else stays quiet unless LOG_LEVEL asks
 * otherwise.
 */
process.env.LOG_LEVEL ??= 'silent';

// Fixture souls are a few lines long; the depth check against Iris is covered in lint.test.ts.
process.env.SOUL_DEPTH_CHECK = 'off';
