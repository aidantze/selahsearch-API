// utils/nlpCache.js
const crypto = require('crypto');

class NLPCache {
    constructor(ttlMinutes = 120, cleanupIntervalMinutes = 30) {
        this.cache = new Map();
        this.ttl = ttlMinutes * 60 * 1000; // Default TTL: 2 hours

        // Periodically prune expired items to prevent silent memory leaks
        setInterval(() => this.prune(), cleanupIntervalMinutes * 60 * 1000).unref();
    }

    /**
     * Generates a deterministic SHA-256 key based on collection, endpoint, and input payload
     */
    generateKey(collectionKey, endpoint, payload) {
        const rawString = `${ collectionKey }:${ endpoint }:${ JSON.stringify(payload) }`;
        const hash = crypto.createHash('sha256').update(rawString).digest('hex');
        return `cache_${ hash }`;
    }

    get(key) {
        const cached = this.cache.get(key);
        if (!cached) return null;

        if (Date.now() - cached.timestamp > this.ttl) {
            this.cache.delete(key);
            return null;
        }

        return cached.data;
    }

    set(key, data) {
        this.cache.set(key, {
            timestamp: Date.now(),
            data: data
        });
    }

    prune() {
        const now = Date.now();
        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp > this.ttl) {
                this.cache.delete(key);
            }
        }
    }

    clear() {
        this.cache.clear();
    }
}

module.exports = new NLPCache(120); // 2 hour cache duration