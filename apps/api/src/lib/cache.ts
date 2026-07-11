import NodeCache from 'node-cache';

/**
 * In-process cache (Technical Spec §1: avoids a paid Redis tier). Used for
 * rate limiting, brute-force backoff counters, and later hot-read caching.
 * Values evaporate on restart, which is acceptable at this scale.
 */
export const cache = new NodeCache({ stdTTL: 0, checkperiod: 120, useClones: false });
