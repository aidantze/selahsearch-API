const fs = require('fs');
const path = require('path');

const BIBLE_PATH = path.join(__dirname, 'bible.txt');
const STORE_DIR = path.join(__dirname, 'store');

const THEME_SCORE_THRESHOLD = 0.2;

function formatBookName(bookInput) {
    let book = bookInput.trim().toLowerCase();
    const aliases = { "song of songs": "song of solomon", "psalm": "psalms" };
    if (aliases[book]) book = aliases[book];
    book = book.replace(/(^\w|\s\w)/g, m => m.toUpperCase());
    return book.replace(/\sOf\s/g, " of ");
}

function retrieveBible() {
    try {
        const data = fs.readFileSync(BIBLE_PATH, 'utf8');
        const lines = data.split('\n').slice(3);
        const bible = new Map();
        const books = new Set();
        lines.forEach(line => {
            if (!line.includes('\t')) return;
            const [ref, content] = line.trim().split('\t');
            bible.set(ref, content);
            const bookName = ref.replace(/[0-9:!@#$%^&*()_+={}\[\]|\\:;"'<>,.?/-]+$/, '').trim();
            books.add(bookName);
        });
        return { bible, books: Array.from(books) };
    } catch (err) {
        return { bible: new Map(), books: [] };
    }
}

function getMaxChapters(bible, book) {
    let maxCh = 0;
    for (let key of bible.keys()) {
        if (key.startsWith(book + " ")) {
            const parts = key.split(" ");
            const chVs = parts[parts.length - 1].split(":");
            maxCh = Math.max(maxCh, parseInt(chVs[0]));
        }
    }
    return maxCh;
}

function getMaxVerses(bible, book, chapter) {
    let count = 0;
    const prefix = `${ book } ${ chapter }:`;
    for (let key of bible.keys()) {
        if (key.startsWith(prefix)) count++;
    }
    return count;
}

function extractPassage(bookInput, startCh, startVs, endCh, endVs) {
    const { bible, books } = retrieveBible();
    if (books.length === 0) throw new Error(`unable to retrieve bible contents: bible does not exist`);
    const book = formatBookName(bookInput);

    if (!books.includes(book)) throw new Error(`book does not exist in the bible`);

    // If any other param exists but startChapter is missing
    if (!startCh && (startVs || endCh || endVs)) {
        throw new Error("startChapter is required when specifying verses or end chapters.");
    }

    let sCh, sVs, eCh, eVs;

    // Resolve chapters
    if (!startCh) {
        // Entire Book Mode
        sCh = 1;
        eCh = getMaxChapters(bible, book);
    } else {
        sCh = parseInt(startCh);
        eCh = endCh ? parseInt(endCh) : sCh;
    }

    // Resolve verses
    const isFullChapterMode = (!startVs && !endVs);

    if (isFullChapterMode) {
        sVs = 1;
        eVs = getMaxVerses(bible, book, eCh);
    } else {
        // Start Verse Logic
        sVs = (startVs === 'start' || !startVs) ? 1 : parseInt(startVs);

        // End Verse Logic
        if (endVs === 'end') {
            eVs = getMaxVerses(bible, book, eCh);
        } else if (!endVs) {
            // If endChapter is different from startChapter, default to end of that chapter
            // Otherwise, default to single verse (startVerse)
            eVs = (eCh !== sCh) ? getMaxVerses(bible, book, eCh) : sVs;
        } else {
            eVs = parseInt(endVs);
        }
    }

    // Validation
    if (eCh < sCh) throw new Error("endChapter must be greater or equal to startChapter");
    if (eCh === sCh && eVs < sVs) throw new Error("endVerse must be greater or equal to startVerse");

    // Coordinate Bounds Check
    const startRef = `${ book } ${ sCh }:${ sVs }`;
    const endRef = `${ book } ${ eCh }:${ eVs }`;
    if (!bible.has(startRef) || !bible.has(endRef)) throw new Error("The chapter and/or verses do not exist in the bible");

    // Extraction
    console.log(`Extracting contents of ${ book } ${ sCh }:${ sVs }-${ eCh }:${ eVs }...`);

    let content = "";
    for (let c = sCh; c <= eCh; c++) {
        const start = (c === sCh) ? sVs : 1;
        const end = (c === eCh) ? eVs : getMaxVerses(bible, book, c);
        for (let v = start; v <= end; v++) {
            content += (bible.get(`${ book } ${ c }:${ v }`) || "") + " ";
        }
    }

    return {
        text: content.trim(),
        resolved: {
            book,
            startChapter: sCh,
            startVerse: sVs,
            endChapter: eCh,
            endVerse: eVs
        }
    };
}

function toTitleCase(str) {
    if (!str) return "";
    return str.toLowerCase().replace(/\b\w/g, match => match.toUpperCase());
}

/**
 * Loads collection metadata from src/store/<collection_key>/metadata.json
 */
function loadCollectionMetadata(collectionKey) {
    const metadataPath = path.join(STORE_DIR, collectionKey, 'metadata.json');
    if (!fs.existsSync(metadataPath)) {
        throw new Error(`Collection metadata not found for key: "${ collectionKey }"`);
    }
    return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
}

/**
 * Reads all songs and lyrics for a given collection key.
 * @param {string} collectionKey - Folder name under src/store (default: 'marsfield_cc')
 */
function getAllLyrics(collectionKey = 'marsfield_cc') {
    const metadata = loadCollectionMetadata(collectionKey);
    const lyricsDir = path.join(STORE_DIR, collectionKey, 'lyrics');

    return metadata.songs.map(song => {
        const lyricFilePath = path.join(lyricsDir, song.filename);
        let lyrics = "";

        if (fs.existsSync(lyricFilePath)) {
            lyrics = fs.readFileSync(lyricFilePath, 'utf8').trim();
        }

        return {
            id: song.id,
            slug: song.slug,
            name: toTitleCase(song.name),
            artist: toTitleCase(song.artist),
            year: song.year ? song.year.toString() : "",
            lyrics: lyrics
        };
    });
}

/**
 * Filters and retrieves lyrics for a specific song within a collection.
 * @param {Object} metadataArgs - Search criteria ({ name, artist, year })
 * @param {string} collectionKey - Folder name under src/store (default: 'marsfield_cc')
 */
function getLyrics(metadataArgs, collectionKey = 'marsfield_cc') {
    if (!metadataArgs || !(metadataArgs.name || metadataArgs.artist || metadataArgs.year)) {
        return null;
    }

    const allSongs = getAllLyrics(collectionKey);

    const lookForName = Boolean(metadataArgs.name);
    const lookForArtist = Boolean(metadataArgs.artist);
    const lookForYear = Boolean(metadataArgs.year);

    const targetName = metadataArgs.name ? metadataArgs.name.trim().toLowerCase() : null;
    const targetArtist = metadataArgs.artist ? metadataArgs.artist.trim().toLowerCase() : null;
    const targetYear = metadataArgs.year ? metadataArgs.year.toString().trim() : null;

    const matches = allSongs.filter(song => {
        const currentName = song.name.toLowerCase();
        const currentArtist = song.artist.toLowerCase();
        const currentYear = song.year.toLowerCase();

        const isNameMatch = lookForName
            ? (currentName === targetName || currentName.includes(targetName) || targetName.includes(currentName))
            : true;

        const isArtistMatch = lookForArtist
            ? (currentArtist === targetArtist || currentArtist.includes(targetArtist) || targetArtist.includes(currentArtist))
            : true;

        const isYearMatch = lookForYear
            ? (currentYear === targetYear)
            : true;

        return isNameMatch && isArtistMatch && isYearMatch;
    });

    return matches.length > 0 ? matches : null;
}

module.exports = {
    extractPassage,
    getAllLyrics,
    getLyrics,
    formatBookName,
    THEME_SCORE_THRESHOLD
};

// const fs = require('fs');
// const path = require('path');

// const BIBLE_PATH = 'src/bible.txt';
// const LYRICS_DIR = 'src/lyrics/';

// const THEME_SCORE_THRESHOLD = 0.2

// function formatBookName(bookInput) {
//     let book = bookInput.trim().toLowerCase();
//     const aliases = { "song of songs": "song of solomon", "psalm": "psalms" };
//     if (aliases[book]) book = aliases[book];
//     book = book.replace(/(^\w|\s\w)/g, m => m.toUpperCase());
//     return book.replace(/\sOf\s/g, " of ");
// }

// function retrieveBible() {
//     try {
//         const data = fs.readFileSync(BIBLE_PATH, 'utf8');
//         const lines = data.split('\n').slice(3);
//         const bible = new Map();
//         const books = new Set();
//         lines.forEach(line => {
//             if (!line.includes('\t')) return;
//             const [ref, content] = line.trim().split('\t');
//             bible.set(ref, content);
//             const bookName = ref.replace(/[0-9:!@#$%^&*()_+={}\[\]|\\:;"'<>,.?/-]+$/, '').trim();
//             books.add(bookName);
//         });
//         return { bible, books: Array.from(books) };
//     } catch (err) {
//         return { bible: new Map(), books: [] };
//     }
// }

// function getMaxChapters(bible, book) {
//     let maxCh = 0;
//     for (let key of bible.keys()) {
//         if (key.startsWith(book + " ")) {
//             const parts = key.split(" ");
//             const chVs = parts[parts.length - 1].split(":");
//             maxCh = Math.max(maxCh, parseInt(chVs[0]));
//         }
//     }
//     return maxCh;
// }

// function getMaxVerses(bible, book, chapter) {
//     let count = 0;
//     const prefix = `${ book } ${ chapter }:`;
//     for (let key of bible.keys()) {
//         if (key.startsWith(prefix)) count++;
//     }
//     return count;
// }

// function extractPassage(bookInput, startCh, startVs, endCh, endVs) {
//     const { bible, books } = retrieveBible();
//     if (books.length === 0) throw new Error(`unable to retrieve bible contents: bible does not exist`);
//     const book = formatBookName(bookInput);

//     if (!books.includes(book)) throw new Error(`book does not exist in the bible`);

//     // If any other param exists but startChapter is missing
//     if (!startCh && (startVs || endCh || endVs)) {
//         throw new Error("startChapter is required when specifying verses or end chapters.");
//     }

//     let sCh, sVs, eCh, eVs;

//     // Resolve chapters
//     if (!startCh) {
//         // Entire Book Mode
//         sCh = 1;
//         eCh = getMaxChapters(bible, book);
//     } else {
//         sCh = parseInt(startCh);
//         eCh = endCh ? parseInt(endCh) : sCh;
//     }

//     // Resolve verses
//     const isFullChapterMode = (!startVs && !endVs);

//     if (isFullChapterMode) {
//         sVs = 1;
//         eVs = getMaxVerses(bible, book, eCh);
//     } else {
//         // Start Verse Logic
//         sVs = (startVs === 'start' || !startVs) ? 1 : parseInt(startVs);

//         // End Verse Logic
//         if (endVs === 'end') {
//             eVs = getMaxVerses(bible, book, eCh);
//         } else if (!endVs) {
//             // If endChapter is different from startChapter, default to end of that chapter
//             // Otherwise, default to single verse (startVerse)
//             eVs = (eCh !== sCh) ? getMaxVerses(bible, book, eCh) : sVs;
//         } else {
//             eVs = parseInt(endVs);
//         }
//     }

//     // Validation
//     if (eCh < sCh) throw new Error("endChapter must be greater or equal to startChapter");
//     if (eCh === sCh && eVs < sVs) throw new Error("endVerse must be greater or equal to startVerse");

//     // Coordinate Bounds Check
//     const startRef = `${ book } ${ sCh }:${ sVs }`;
//     const endRef = `${ book } ${ eCh }:${ eVs }`;
//     if (!bible.has(startRef) || !bible.has(endRef)) throw new Error("The chapter and/or verses do not exist in the bible");

//     // Extraction
//     console.log(`Extracting contents of ${ book } ${ sCh }:${ sVs }-${ eCh }:${ eVs }...`);

//     let content = "";
//     for (let c = sCh; c <= eCh; c++) {
//         const start = (c === sCh) ? sVs : 1;
//         const end = (c === eCh) ? eVs : getMaxVerses(bible, book, c);
//         for (let v = start; v <= end; v++) {
//             content += (bible.get(`${ book } ${ c }:${ v }`) || "") + " ";
//         }
//     }

//     return {
//         text: content.trim(),
//         resolved: {
//             book,
//             startChapter: sCh,
//             startVerse: sVs,
//             endChapter: eCh,
//             endVerse: eVs
//         }
//     };
// }

// function parseSongFile(filename) {
//     const fullPath = path.join(LYRICS_DIR, filename);
//     const fileContent = fs.readFileSync(fullPath, 'utf8').trim();

//     // Split file by the frontmatter delimiter
//     const parts = fileContent.split('\n---\n');

//     let metadataPart = '';
//     let lyricsPart = '';

//     if (parts.length >= 2) {
//         metadataPart = parts[0];
//         // Join the rest back in case the lyrics themselves contain '---'
//         lyricsPart = parts.slice(1).join('\n---\n').trim();
//     } else {
//         // Fallback if a file lacks the '---' line break cleanly
//         lyricsPart = fileContent;
//     }

//     // Parse metadata lines (e.g., "name: A Thousand Hallelujahs")
//     let songName = filename.replace('.txt', '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
//     let artist = "";
//     let year = "";

//     const lines = metadataPart.split('\n');
//     for (const line of lines) {
//         const cleanLine = line.trim();
//         if (cleanLine.startsWith('name:')) {
//             songName = cleanLine.replace('name:', '').trim();
//         } else if (cleanLine.startsWith('artist:')) {
//             artist = cleanLine.replace('artist:', '').trim();
//         } else if (cleanLine.startsWith('year:')) {
//             year = cleanLine.replace('year:', '').trim();
//         }
//     }

//     return {
//         filename,
//         songName,
//         artist,
//         year,
//         lyrics: lyricsPart
//     };
// }

// function toTitleCase(str) {
//     return str.toLowerCase().replace(/\b\w/g, match => match.toUpperCase());
// }

// function getLyrics(metadataArgs) {
//     if (!metadataArgs || !(metadataArgs.name || metadataArgs.artist || metadataArgs.year)) {
//         return null;
//     }

//     const files = fs.readdirSync(LYRICS_DIR).filter(f => f.endsWith('.txt'));

//     const lookForName = metadataArgs.name ? true : false;
//     const lookForArtist = metadataArgs.artist ? true : false;
//     const lookForYear = metadataArgs.year ? true : false;

//     const targetName = metadataArgs.name ? metadataArgs.name.trim().toLowerCase() : null;
//     const targetArtist = metadataArgs.artist ? metadataArgs.artist.trim().toLowerCase() : null;
//     const targetYear = metadataArgs.year ? metadataArgs.year.toString().trim() : null;

//     let matches = [];
//     for (const file of files) {
//         const songData = parseSongFile(file);

//         const currentName = songData.songName.toLowerCase();
//         const currentArtist = songData.artist.toLowerCase();
//         const currentYear = songData.year.toString().toLowerCase();

//         // Strict validation using title & artist combo to support identical titles
//         const isNameMatch = lookForName ? (currentName === targetName || currentName.includes(targetName) || targetName.includes(currentName)) : true;
//         const isArtistMatch = lookForArtist ? currentArtist === targetArtist || currentArtist.includes(targetArtist) || targetArtist.includes(currentArtist) : true;
//         const isYearMatch = lookForYear ? (currentYear === targetYear) : true;

//         if (isNameMatch && isArtistMatch && isYearMatch) {
//             matches.push({
//                 name: toTitleCase(currentName), // TODO: return name and artist in capital case
//                 artist: toTitleCase(currentArtist),
//                 year: currentYear,
//                 lyrics: songData.lyrics
//             });
//         }
//     }

//     if (matches.length === 0) return null;
//     return matches; // Return null explicitly if no unique asset is located
// }

// function getAllLyrics() {
//     const files = fs.readdirSync(LYRICS_DIR).filter(f => f.endsWith('.txt')).sort();

//     const res = files.map(file => {
//         const songData = parseSongFile(file);
//         return {
//             name: toTitleCase(songData.songName),
//             artist: toTitleCase(songData.artist),
//             year: songData.year,
//             lyrics: songData.lyrics
//         }
//     });
//     return res;
// }

// // function getLyrics(name) {
// //     // Current: Reads from /lyrics folder. Future: fetch from MongoDB.
// //     const files = fs.readdirSync(LYRICS_DIR).filter(f => f.endsWith('.txt')).sort();
// //     const songname = file.replace('.txt', '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
// //     const matchname = name.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
// //     if (songname == matchname || songname.contains(matchname) || matchname.contains(songname)) {
// //         return {
// //             filename: file,
// //             songName: file.replace('.txt', '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
// //             artist: "", // TODO: fill this in
// //             year: "", // TODO: fill this in
// //             lyrics: fs.readFileSync(fullPath, 'utf8').trim()
// //         }
// //     }
// // }

// // // TODO: refactor this to include the artist name at top of each file and filter that out...
// // function getAllLyrics() {
// //     // Current: Reads from /lyrics folder. Future: fetch from MongoDB.
// //     const files = fs.readdirSync(LYRICS_DIR).filter(f => f.endsWith('.txt')).sort();
// //     return files.map(file => {
// //         const fullPath = path.join(LYRICS_DIR, file);
// //         return {
// //             filename: file,
// //             songName: file.replace('.txt', '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
// //             artist: "", // TODO: fill this in
// //             year: "", // TODO: fill this in
// //             lyrics: fs.readFileSync(fullPath, 'utf8').trim()
// //         };
// //     });
// // }

// module.exports = { extractPassage, getAllLyrics, getLyrics, formatBookName, THEME_SCORE_THRESHOLD };