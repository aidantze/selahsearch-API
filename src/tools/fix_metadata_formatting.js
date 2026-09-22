#!/usr/bin/env node

// Script used to fix formatting in metadata files

const fs = require('fs');
const path = require('path');

const REPO_ROOT = process.cwd();
const STORE_DIR = path.join(REPO_ROOT, 'src', 'store');

/**
 * Capitalizes the first letter of every word.
 * Example: "yet not i but through christ in me" -> "Yet Not I But Through Christ In Me"
 */
function formatName(text) {
    if (!text) return '';
    return text
        .toString()
        .trim()
        .split(/\s+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

/**
 * Converts text/slug to all lowercase with single underscores replacing hyphens and spaces.
 * Example: "yet-not-i-but-through-christ-in-me" -> "yet_not_i_but_through_christ_in_me"
 */
function formatSlug(text) {
    if (!text) return '';
    return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/[-\s]+/g, '_')       // Replace hyphens and spaces with underscores
        .replace(/[^a-z0-9_]/g, '')     // Remove remaining invalid characters
        .replace(/_+/g, '_');          // Collapse duplicate underscores
}

/**
 * Formats a metadata file at the given path.
 */
function fixMetadataFile(filePath) {
    if (!fs.existsSync(filePath)) {
        console.error(`❌ File not found: ${ filePath }`);
        return;
    }

    try {
        const rawData = fs.readFileSync(filePath, 'utf8');
        const metadata = JSON.parse(rawData);

        if (!Array.isArray(metadata.songs)) {
            console.warn(`⚠️ No "songs" array found in ${ filePath }`);
            return;
        }

        let updatedCount = 0;

        metadata.songs = metadata.songs.map((song) => {
            const oldName = song.name;
            const oldSlug = song.slug;
            const oldFilename = song.filename;

            const newName = formatName(oldName);
            const newSlug = formatSlug(oldSlug || oldName);
            const newFilename = `${ newSlug }.txt`;

            if (oldName !== newName || oldSlug !== newSlug || oldFilename !== newFilename) {
                updatedCount++;
            }

            return {
                ...song,
                name: newName,
                slug: newSlug,
                filename: newFilename
            };
        });

        // Write back cleaned metadata formatted with 2 spaces indentation
        fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2), 'utf8');
        console.log(`✅ Updated ${ updatedCount } song entries in: ${ path.relative(REPO_ROOT, filePath) }`);

    } catch (err) {
        console.error(`❌ Error processing ${ filePath }: ${ err.message }`);
    }
}

/**
 * Main execution.
 * Options:
 *   Pass a collection name (e.g., node fix_metadata_formatting.js marsfield_cc)
 *   Or run without arguments to process all metadata.json files in src/store
 */
function main() {
    const targetCollection = process.argv[2];

    if (targetCollection) {
        const metadataPath = path.join(STORE_DIR, targetCollection, 'metadata.json');
        fixMetadataFile(metadataPath);
    } else {
        console.log('Scanning all collections under src/store/...\n');
        const collections = fs.readdirSync(STORE_DIR);

        for (const dir of collections) {
            const metadataPath = path.join(STORE_DIR, dir, 'metadata.json');
            if (fs.existsSync(metadataPath)) {
                fixMetadataFile(metadataPath);
            }
        }
    }
}

main();