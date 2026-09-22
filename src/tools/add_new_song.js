#!/usr/bin/env node

/*
Workflow tool to Add a new Song into the system for a collection.

For humans: run via the following command
node src/tools/add_new_song.js

It will guide you through a step by step process for adding a new song:
1. collection name (e.g. marsfield_cc)
2. song name (e.g. King of Kings)
3. artist name(s) (e.g. Hillsong Worship)
4. year released (e.g. 2019)
5. lyrics
6. confirmation step (y to confirm, anything else to deny)
After this it will add the song, and repeat the steps above.
Enter Ctrl+C to terminate the program.

Note: step 6 opens nano, a command-line terminal editor for pasting the lyrics.
Try to paste the lyrics in with spaces between verses and only 1 instance of the chorus/bridge if repeated
Enter Ctrl+X, then Y the Enter to save and quit this editor.


For AI automation agents: 
node src/tools/add_new_song.js << 'EOF'
marsfield_cc
Amazing Grace
John Newton
1779
Amazing grace how sweet the sound
That saved a wretch like me!
EOF
*/


const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');
const os = require('os');

const REPO_ROOT = process.cwd();
const STORE_DIR = path.join(REPO_ROOT, 'src', 'store');

function createSlug(text) {
    return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s_]/g, '')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_');
}

function formatName(text) {
    return text
        .trim()
        .split(/\s+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(query, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

function captureLyricsViaEditor() {
    const tempFilePath = path.join(os.tmpdir(), `selah_lyrics_${ Date.now() }.txt`);
    fs.writeFileSync(tempFilePath, '', 'utf8');

    const editor = process.env.EDITOR || (process.platform === 'win32' ? 'notepad' : 'nano');
    console.log(`\nOpening ${ editor } for lyrics entry... (Save and close editor when finished)`);

    spawnSync(editor, [tempFilePath], { stdio: 'inherit' });

    let lyrics = '';
    if (fs.existsSync(tempFilePath)) {
        lyrics = fs.readFileSync(tempFilePath, 'utf8').trim();
        try { fs.unlinkSync(tempFilePath); } catch (e) { }
    }

    return lyrics;
}

/**
 * Saves or updates a song entry in the store.
 */
function saveSong({ collectionId, rawSongName, artist, yearInput, lyrics, forceOverwrite = false }) {
    const collectionDir = path.join(STORE_DIR, collectionId);
    const lyricsDir = path.join(collectionDir, 'lyrics');
    const metadataPath = path.join(collectionDir, 'metadata.json');

    if (!fs.existsSync(collectionDir)) {
        throw new Error(`Collection directory "${ collectionDir }" does not exist under src/store/.`);
    }

    const formattedName = formatName(rawSongName);
    const songSlug = createSlug(rawSongName);
    const yearMatch = (yearInput || '').toString().match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? yearMatch[0] : (yearInput || '');
    const filename = `${ songSlug }.txt`;
    const lyricFilePath = path.join(lyricsDir, filename);

    let metadata = { collectionKey: collectionId, totalSongs: 0, songs: [] };
    if (fs.existsSync(metadataPath)) {
        try {
            metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        } catch (err) {
            console.error(`⚠️ Failed to parse metadata.json in ${ collectionId }. Resetting structure.`);
        }
    }

    const existingIndex = metadata.songs.findIndex(
        s => s.slug === songSlug || s.filename === filename
    );

    if (existingIndex !== -1 && !forceOverwrite) {
        return { status: 'EXISTS', filename, formattedName, songSlug };
    }

    if (!fs.existsSync(lyricsDir)) {
        fs.mkdirSync(lyricsDir, { recursive: true });
    }
    fs.writeFileSync(lyricFilePath, lyrics, 'utf8');

    const songRecord = {
        id: existingIndex !== -1 ? metadata.songs[existingIndex].id : (metadata.songs.length + 1).toString(),
        slug: songSlug,
        name: formattedName,
        artist: formatName(artist) || 'Unknown Artist',
        year: year || '',
        filename: filename
    };

    if (existingIndex !== -1) {
        metadata.songs[existingIndex] = songRecord;
    } else {
        metadata.songs.push(songRecord);
    }

    metadata.totalSongs = metadata.songs.length;
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

    return { status: 'SUCCESS', songRecord };
}

/**
 * Handles automated non-interactive piped input (heredoc / CI pipelines).
 */
async function runNonInteractiveMode() {
    const input = fs.readFileSync(0, 'utf8').trim();
    if (!input) {
        console.error('❌ Error: Non-interactive mode received empty stdin.');
        process.exit(1);
    }

    const lines = input.split(/\r?\n/);
    if (lines.length < 5) {
        console.error('❌ Error: Non-interactive input requires 5 lines: Collection, Name, Artist, Year, and Lyrics.');
        process.exit(1);
    }

    const collectionId = lines[0].trim();
    const rawSongName = lines[1].trim();
    const artist = lines[2].trim();
    const yearInput = lines[3].trim();
    const lyrics = lines.slice(4).join('\n').trim();

    try {
        const result = saveSong({
            collectionId,
            rawSongName,
            artist,
            yearInput,
            lyrics,
            forceOverwrite: true // Non-interactive mode overwrites by default
        });

        if (result.status === 'SUCCESS') {
            console.log(`✅ [Automated] Saved "${ result.songRecord.name }" (slug: ${ result.songRecord.slug }) to ${ collectionId }.`);
        }
    } catch (err) {
        console.error(`❌ Automated Ingestion Error: ${ err.message }`);
        process.exit(1);
    }
}

/**
 * Handles interactive human workflow in the terminal.
 */
async function runInteractiveLoop() {
    console.log('\n===================================================================');
    console.log('                 SelahSearch Internal Song Ingestion                ');
    console.log('===================================================================');
    console.log('Tip: Press [Ctrl+C] during any text prompt to exit.\n');

    while (true) {
        try {
            const collectionId = await askQuestion('1. Collection ID (folder name under src/store): ');
            if (!collectionId) {
                console.log('❌ Collection ID cannot be empty.\n\n\n');
                continue;
            }

            const collectionDir = path.join(STORE_DIR, collectionId);
            if (!fs.existsSync(collectionDir)) {
                console.log(`❌ Collection directory "${ collectionDir }" does not exist under src/store/.\n\n\n`);
                continue;
            }

            const rawSongName = await askQuestion('2. Song Name: ');
            if (!rawSongName) {
                console.log('❌ Song name cannot be empty.\n\n\n');
                continue;
            }

            const formattedName = formatName(rawSongName);
            const songSlug = createSlug(rawSongName);

            const artist = await askQuestion('3. Artist(s): ');
            const yearInput = await askQuestion('4. Release Year: ');

            const lyrics = captureLyricsViaEditor();
            if (!lyrics) {
                console.log('\n❌ Lyrics file was empty or aborted. Song will NOT be saved.\n\n\n');
                continue;
            }

            console.log('\n-------------------------------------------------------------------');
            console.log('                    REVIEW SONG ENTRY DETAILS                      ');
            console.log('-------------------------------------------------------------------');
            console.log(` Collection  : ${ collectionId }`);
            console.log(` Name        : ${ formattedName }`);
            console.log(` Slug        : ${ songSlug }`);
            console.log(` Artist      : ${ formatName(artist) || 'Unknown Artist' }`);
            console.log(` Year        : ${ yearInput || 'N/A' }`);
            console.log(` Lyrics Size : ${ lyrics.length } characters (${ lyrics.split('\n').length } lines)`);
            console.log('-------------------------------------------------------------------');

            const saveConfirm = await askQuestion('Save this song to the store? (y/yes to confirm): ');
            const isConfirmed = saveConfirm.toLowerCase() === 'y' || saveConfirm.toLowerCase() === 'yes';

            if (!isConfirmed) {
                console.log('🛑 Action rejected. Song entry discarded without saving.\n\n');
                continue;
            }

            const filename = `${ songSlug }.txt`;
            const lyricsDir = path.join(collectionDir, 'lyrics');
            const lyricFilePath = path.join(lyricsDir, filename);
            let forceOverwrite = false;

            if (fs.existsSync(lyricFilePath)) {
                const overwriteConfirm = await askQuestion(`⚠️ Song "${ filename }" already exists! Overwrite existing file? (y/yes): `);
                if (overwriteConfirm.toLowerCase() !== 'y' && overwriteConfirm.toLowerCase() !== 'yes') {
                    console.log('🛑 Overwrite cancelled. No changes saved.\n\n');
                    continue;
                }
                forceOverwrite = true;
            }

            const result = saveSong({
                collectionId,
                rawSongName,
                artist,
                yearInput,
                lyrics,
                forceOverwrite
            });

            if (result.status === 'SUCCESS') {
                console.log(`\n✅ Successfully saved "${ result.songRecord.name }" to ${ collectionId }!`);
            }

        } catch (error) {
            console.error('\n❌ An error occurred:', error.message);
        }

        console.log('\n\n');
    }
}

// Detection Switch: Run non-interactive if piped input exists or explicit flag is passed
if (!process.stdin.isTTY || process.argv.includes('--non-interactive')) {
    runNonInteractiveMode();
} else {
    runInteractiveLoop();
}