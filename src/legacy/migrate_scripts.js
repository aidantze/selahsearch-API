const fs = require('fs');
const path = require('path');

const STORE_DIR = path.join(__dirname, '..', 'src', 'store');

/**
 * Parses legacy song content containing frontmatter headers.
 * Extracts title, artist, year, and returns clean lyrics stripped of boundaries
 */
function parseLegacySongFile(fileContent, defaultFilename) {
    const lines = fileContent.split(/\r?\n/);
    const metadata = {
        name: "",
        artist: "Unknown Artist",
        year: ""
    };

    let lyricLines = [];
    let inFrontmatter = false;
    let hasFrontmatter = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Detect and skip frontmatter boundary lines (--- or ===)
        if (line === '---' || line === '===' || line.startsWith('---') || line.startsWith('===')) {
            if (!inFrontmatter && i === 0) {
                inFrontmatter = true;
                hasFrontmatter = true;
                continue; // Skip opening boundary
            } else if (inFrontmatter) {
                inFrontmatter = false;
                continue; // Skip closing boundary
            } else {
                // Skip stray boundary markers anywhere in the header section
                continue;
            }
        }

        // Extract metadata key-value pairs while inside frontmatter
        if (inFrontmatter || (!hasFrontmatter && line.includes(':') && lyricLines.length === 0)) {
            const colonIdx = line.indexOf(':');
            if (colonIdx !== -1) {
                const key = line.substring(0, colonIdx).trim().toLowerCase();
                const value = line.substring(colonIdx + 1).trim();

                if (key === 'title' || key === 'name' || key === 'song') {
                    metadata.name = value;
                } else if (key === 'artist' || key === 'author' || key === 'by') {
                    metadata.artist = value;
                } else if (key === 'year' || key === 'date') {
                    const yearMatch = value.match(/\b(19|20)\d{2}\b/);
                    metadata.year = yearMatch ? yearMatch[0] : value;
                }
                continue; // Skip metadata key-value lines from lyrics
            }
        }

        // Collect body lyrics
        lyricLines.push(lines[i]);
    }

    // Fallback if title was not explicitly set in frontmatter
    if (!metadata.name) {
        const baseName = path.basename(defaultFilename, path.extname(defaultFilename));
        metadata.name = baseName.replace(/[-_]/g, ' ');
    }

    // Clean up any empty space left at the top of the lyrics after header removal
    const cleanLyrics = lyricLines.join('\n').replace(/^[\r\n]+/, '').trim();

    return {
        metadata,
        lyrics: cleanLyrics
    };
}

/**
 * Runs the store migration across all collection directories under src/store/
 */
function migrateStore() {
    if (!fs.existsSync(STORE_DIR)) {
        console.error(`Store directory missing at: ${ STORE_DIR }`);
        return;
    }

    const collections = fs.readdirSync(STORE_DIR, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

    console.log(`Found collections: ${ collections.join(', ') }`);

    collections.forEach(collectionKey => {
        const collectionPath = path.join(STORE_DIR, collectionKey);
        const lyricsDir = path.join(collectionPath, 'lyrics');
        const metadataPath = path.join(collectionPath, 'metadata.json');

        // Check if raw/legacy files exist directly in collection root or lyrics folder
        const targetDir = fs.existsSync(lyricsDir) ? lyricsDir : collectionPath;
        const files = fs.readdirSync(targetDir).filter(f => f.endsWith('.txt'));

        if (files.length === 0) {
            console.warn(`No .txt files found to migrate in ${ collectionKey }`);
            return;
        }

        // Create lyrics subfolder if missing
        if (!fs.existsSync(lyricsDir)) {
            fs.mkdirSync(lyricsDir, { recursive: true });
        }

        const songsMetadata = [];

        files.forEach((filename, index) => {
            const filePath = path.join(targetDir, filename);
            const rawContent = fs.readFileSync(filePath, 'utf8');

            const { metadata, lyrics } = parseLegacySongFile(rawContent, filename);

            const songId = (index + 1).toString();
            const slug = filename.replace(/\.txt$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

            // 1. Add song record to metadata list with artist and year
            songsMetadata.push({
                id: songId,
                slug: slug,
                name: metadata.name,
                artist: metadata.artist,
                year: metadata.year,
                filename: filename
            });

            // 2. Overwrite file with clean lyrics only (stripping frontmatter)
            const cleanLyricPath = path.join(lyricsDir, filename);
            fs.writeFileSync(cleanLyricPath, lyrics, 'utf8');
        });

        // 3. Save refreshed metadata.json
        const fullMetadata = {
            collectionKey: collectionKey,
            totalSongs: songsMetadata.length,
            songs: songsMetadata
        };

        fs.writeFileSync(metadataPath, JSON.stringify(fullMetadata, null, 2), 'utf8');
        console.log(` successfully migrated ${ songsMetadata.length } songs for "${ collectionKey }"`);
    });
}

migrateStore();

// const fs = require('fs');
// const path = require('path');

// // Target directory paths inside the repository
// const STORE_DIR = path.join(__dirname, '../src/store');

// // Initial Collections Registry Fallback Data
// const INITIAL_COLLECTIONS = [
//     // {
//     //     id: 1,
//     //     key: 'marsfield_cc',
//     //     name: 'Marsfield Community Church',
//     //     description: 'Active worship song library',
//     //     isActive: true,
//     //     createdAt: new Date().toISOString()
//     // },
//     {
//         id: 2,
//         key: 'marsfield_cc_new',
//         name: 'Marsfield Community Church (New Additions)',
//         description: 'Staging queue for upcoming worship songs',
//         isActive: true,
//         createdAt: new Date().toISOString()
//     }
// ];

// /**
//  * Parses Frontmatter metadata out of legacy song text files.
//  */
// function parseFrontmatter(fileContent, filename) {
//     const parts = fileContent.split('\n---\n');
//     let metadataPart = '';
//     let lyricsPart = '';

//     if (parts.length >= 2) {
//         metadataPart = parts[0];
//         lyricsPart = parts.slice(1).join('\n---\n').trim();
//     } else {
//         lyricsPart = fileContent.trim();
//     }

//     // Default title derived from filename fallback
//     let name = filename.replace('.txt', '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
//     let artist = 'Unknown';
//     let year = null;

//     const lines = metadataPart.split('\n');
//     for (const line of lines) {
//         const cleanLine = line.trim();
//         if (cleanLine.startsWith('name:')) {
//             name = cleanLine.replace('name:', '').trim();
//         } else if (cleanLine.startsWith('artist:')) {
//             artist = cleanLine.replace('artist:', '').trim();
//         } else if (cleanLine.startsWith('year:')) {
//             const parsedYear = parseInt(cleanLine.replace('year:', '').trim(), 10);
//             if (!isNaN(parsedYear)) year = parsedYear;
//         }
//     }

//     return { name, artist, year, lyrics: lyricsPart };
// }

// /**
//  * Main Migration Logic
//  */
// function runMigration() {
//     console.log('🚀 Starting Store Data Migration...');

//     if (!fs.existsSync(STORE_DIR)) {
//         console.error(`❌ Error: Base store directory not found at "${ STORE_DIR }"`);
//         process.exit(1);
//     }

//     // 1. Load or Generate src/store/collections.json
//     const collectionsFilePath = path.join(STORE_DIR, 'collections.json');
//     let collectionsPayload;

//     if (fs.existsSync(collectionsFilePath)) {
//         console.log(`ℹ️ Found existing collections.json. Loading content...`);
//         try {
//             collectionsPayload = JSON.parse(fs.readFileSync(collectionsFilePath, 'utf8'));
//         } catch (err) {
//             console.warn(`⚠️ Failed to parse existing collections.json. Re-creating standard registry.`);
//         }
//     }

//     if (!collectionsPayload) {
//         collectionsPayload = {
//             $schema: "https://json-schema.org/draft/2020-12/schema",
//             version: "1.0",
//             collections: INITIAL_COLLECTIONS
//         };
//     }

//     fs.writeFileSync(collectionsFilePath, JSON.stringify(collectionsPayload, null, 2), 'utf8');
//     console.log(`✅ Ensured master registry: ${ collectionsFilePath }`);

//     // 2. Process each collection folder inside /src/store
//     const collectionFolders = collectionsPayload.collections;

//     for (const collection of collectionFolders) {
//         const collectionKey = collection.key;
//         const collectionDir = path.join(STORE_DIR, collectionKey);
//         const lyricsDir = path.join(collectionDir, 'lyrics');

//         if (!fs.existsSync(lyricsDir)) {
//             console.warn(`⚠️ Warning: Lyrics directory "${ lyricsDir }" does not exist. Skipping...`);
//             continue;
//         }

//         // Read all .txt files directly inside src/store/<collection_id>/lyrics
//         const files = fs.readdirSync(lyricsDir).filter(f => f.endsWith('.txt')).sort();
//         console.log(`\n📂 Processing Collection [ID: ${ collection.id }] "${ collectionKey }" (${ files.length } song files in /lyrics)`);

//         const songsList = [];
//         let songIdCounter = collection.id * 1000 + 1; // Creates IDs like 1001, 1002 for collection 1

//         for (const file of files) {
//             const songFilePath = path.join(lyricsDir, file);
//             const fileContent = fs.readFileSync(songFilePath, 'utf8');

//             // Parse metadata and separate pure lyrics
//             const { name, artist, year, lyrics } = parseFrontmatter(fileContent, file);

//             // Clean slug for reference
//             const slug = file.replace('.txt', '').toLowerCase().replace(/[^a-z0-9_]/g, '');

//             // Overwrite existing .txt file in /lyrics with pure lyrics text (header stripped)
//             fs.writeFileSync(songFilePath, lyrics, 'utf8');

//             // Add song metadata entry to array
//             songsList.push({
//                 id: songIdCounter++,
//                 slug: slug,
//                 filename: file,
//                 name: name,
//                 artist: artist,
//                 year: year,
//                 tags: [],
//                 updatedAt: new Date().toISOString()
//             });

//             console.log(`  └─ Cleaned & Cataloged: "${ name }" (${ file })`);
//         }

//         // Write src/store/<collection_id>/metadata.json
//         const metadataFilePath = path.join(collectionDir, 'metadata.json');
//         const metadataPayload = {
//             collectionId: collection.id,
//             collectionKey: collectionKey,
//             customThemes: [],
//             settings: {
//                 language: "en",
//                 allowCustomVerses: true
//             },
//             songs: songsList
//         };

//         fs.writeFileSync(metadataFilePath, JSON.stringify(metadataPayload, null, 2), 'utf8');
//         console.log(`  ✅ Written metadata file: ${ collectionKey }/metadata.json (${ songsList.length } total songs)`);
//     }

//     console.log('\n✨ Migration Complete! Text files contain only raw lyrics, and metadata.json files are generated.');
// }

// runMigration();