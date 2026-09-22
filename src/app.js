/**
app.js
---
SelahSearch
Web service API which uses NLP to match worship lyrics with bible references


MVP Features
---------------------------------------------------------
public API routes:
Public routes for anyone to use freely
---------------------------------------------------------
/passage/:id GET [str song]: get the details of a bible passage, including its content and relevant themes
/song/:id GET [str song]: get the details of a worship song, including its lyrics and relevant themes

/passage/:id/matches GET [str passage]: get the songs relating to a bible passage
/song/:id/matches GET [str song]: get the passages relating to a worship song


---------------------------------------------------------
Database API routes:
Routes that will interact directly with the database, some closely relate with equivalent public API route
---------------------------------------------------------
/passages POST: add a bible passage. Returns error if already exists
/themes POST: add a theme. Returns error if already exists
/songs POST: add a worship song. Returns error if already exists

/passage/:id PUT: update the contents of a bible passage
/song/:id PUT: update the lyrics of a worship song

/passage/:id DELETE: delete a bible passage
/theme/:id DELETE: delete a theme
/song/:id DELETE: delete a worship song

/passage/:id GET: get the contents of a bible passage
/song/:id GET: get the lyrics of a worship song
/songs GET: get a list of all songs in the system
/themes GET: get a list of all themes in the system


*/
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Client } = require("@gradio/client");
const { extractPassage, getAllLyrics, getLyrics, THEME_SCORE_THRESHOLD } = require('./extraction');
const { MongoClient, ServerApiVersion } = require('mongodb');
const nlpCache = require('./utils/nlpCache');
const { spawn } = require('child_process');

const app = express();

const cors = require("cors");
const corsOptions = {
    origin: '*',
    credentials: true,			// access-control-allow-credentials: true
    optionSuccessStatus: 200,
};
app.use(cors(corsOptions));

// mongodb stuff: will not be used for now but exists to allow for database functionality in the future
const username = encodeURIComponent(process.env.MONGODB_USERNAME); // required to % encode this
const password = encodeURIComponent(process.env.MONGODB_PASSWORD); // required to % encode this
const cluster = 'devcluster';
const dbName = 'SelahSearch';
const uri = `mongodb+srv://${ username }:${ password }@${ cluster }.sypen0x.mongodb.net/${ dbName }?retryWrites=true&w=majority&appName=${ cluster }`;
const NLP_WORKER_TIMEOUT = 300000;
const NLP_CONNECTION_RETRY_DELAY = 5000;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

// async function connectToMongo() {
//     try {
//         // Connect the client to the server
//         await client.connect();
//         // Send a ping to confirm a successful connection
//         await client.db("admin").command({ ping: 1 });
//         console.log("✅ Successfully connected to MongoDB Atlas!");
//     } catch (err) {
//         console.error("❌ MongoDB Connection Error:");
//         console.error(err.message);
//         // If it's an auth error, specifically warn about credentials
//         if (err.message.includes("Authentication failed")) {
//             console.warn("TIP: Check your .env file for extra spaces or quotes in MONGODB_PASSWORD.");
//         }
//     }
// }

// TODO: connect database by uncommenting the below
// connectToMongo();


app.use(express.json());

async function forceHuggingFaceRestart() {
    // const repoId = process.env.HF_REPO_ID;
    const token = process.env.HF_TOKEN;
    const HF_SPACE_URL = process.env.HF_SPACE_URL;

    // if (!repoId) {
    //     console.warn("HF_REPO_ID not set. Skipping hard restart check.");
    //     return;
    // }

    // console.log(`[HF Monitor] Triggering hard restart request for ${ repoId }...`);
    console.log(`[HF Monitor] Triggering hard restart request for NLP worker...`);
    try {
        const response = await fetch(`${ HF_SPACE_URL }/restart`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${ token }`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            console.log("[HF Monitor] Space hard restart successfully triggered!");
        } else {
            const errData = await response.json().catch(() => ({}));
            console.error("[HF Monitor] HF API rejected restart request:", errData);
        }
    } catch (e) {
        console.error("[HF Monitor] Network error requesting hard restart:", e.message);
    }
}

function mergePassageRequests(passages) {
    // convert chapter/verse to a comparable absolute number (e.g., Ch 2, Vs 5 -> 2005)
    const getScore = (c, v, isEnd) => {
        let chap = parseInt(c) || (isEnd ? 999 : 1);
        let vers = (v === 'start' || !v) ? (isEnd ? 999 : 1) : (v === 'end' ? 999 : parseInt(v));
        return chap * 1000 + vers;
    };

    let grouped = {};

    // group by book and calculate scores
    for (const p of passages) {
        if (!p.book) throw new Error("Book parameter is required in all passage objects.");

        const bookName = p.book.toLowerCase().trim();
        if (!grouped[bookName]) grouped[bookName] = [];

        const startScore = getScore(p.startChapter, p.startVerse, false);
        // If endChapter isn't provided, assume it ends in the same chapter it started
        const endScore = getScore(p.endChapter || p.startChapter, p.endVerse, true);

        grouped[bookName].push({ ...p, startScore, endScore });
    }

    // sort and merge overlaps
    const mergedPassages = [];
    for (const book in grouped) {
        let reqs = grouped[book];
        reqs.sort((a, b) => a.startScore - b.startScore);

        let current = reqs[0];
        for (let i = 1; i < reqs.length; i++) {
            let next = reqs[i];

            // If the next passage starts before or right where the current one ends (Overlap!)
            if (next.startScore <= current.endScore) {
                // Extend the end bound if the next passage goes further
                if (next.endScore > current.endScore) {
                    current.endScore = next.endScore;
                    current.endChapter = next.endChapter || next.startChapter;
                    current.endVerse = next.endVerse;
                }
            } else {
                mergedPassages.push(current);
                current = next;
            }
        }
        mergedPassages.push(current);
    }
    return mergedPassages;
}



/**
 * Healthcheck endpoint for status
 */
app.get('/healthcheck', (_, res) => {
    return res.status(200).json({ "status": "alive" })
});

/**
 * Get catalog of all songs in a collection
 */
app.get('/songs/v1', (req, res) => {
    try {
        const collectionKey = req.query.collection || 'marsfield_cc';
        const songs = getAllLyrics(collectionKey);
        res.json({
            collection: collectionKey,
            total_songs: songs.length,
            songs: songs
        });
    } catch (error) {
        res.status(404).json({ error: error.message });
    }
});

/**
 * Get songs matching list of bible passages provided as input
 */
app.post('/songs/matches/v1', async (req, res) => {
    console.log("Received request for /songs/matches...");
    try {
        // Extract raw query params
        const collectionKey = req.query.collection || req.body.collection || 'marsfield_cc';

        console.log("Parsing query passages...");
        const requestedPassages = req.body.passages;

        if (!requestedPassages || !Array.isArray(requestedPassages) || requestedPassages.length === 0) {
            return res.status(400).json({ error: "A 'passages' array is required in the request body." });
        }

        // parse passages by handling duplicates and overlaps
        const mergedRequests = mergePassageRequests(requestedPassages);

        // extract passages and combine all text contents together
        let combinedText = "";
        let firstResolved = null;
        const resolvedPassages = [];
        for (const p of mergedRequests) {
            // Note: If extractPassage() throws, execution jumps straight to the main catch block
            const extracted = extractPassage(
                p.book,
                p.startChapter,
                p.startVerse,
                p.endChapter,
                p.endVerse
            );

            combinedText += extracted.text + "\n\n";

            // Save the first resolved metadata block for the JSON response structure
            if (!firstResolved) {
                firstResolved = extracted.resolved;
            }

            resolvedPassages.push({
                book: extracted.resolved.book,
                startChapter: extracted.resolved.startChapter,
                startVerse: extracted.resolved.startVerse,
                endChapter: extracted.resolved.endChapter,
                endVerse: extracted.resolved.endVerse,
                // passageSnippet returns first 100 characters, then all characters before next space before ...
                passageSnippet: (() => {
                    const txt = extracted.text;
                    if (txt.length <= 100) return txt;
                    const nextSpace = txt.indexOf(' ', 100);
                    return nextSpace === -1 ? txt : txt.substring(0, nextSpace) + "...";
                })()
            });
        }

        const passage = {
            text: combinedText.trim(),
            resolved: firstResolved
        };

        console.log("Attempting to retrieve from cache...");
        const cacheKey = nlpCache.generateKey(collectionKey, '/predict/passage', { passages: resolvedPassages });
        const cachedResult = nlpCache.get(cacheKey);
        if (cachedResult) {
            console.log(`[Cache Hit] Returning cached matches for collection: ${ collectionKey }`);
            return res.json(cachedResult);
        }

        console.log("Extracting lyrics of all songs...");
        const songs = getAllLyrics(collectionKey).map(s => ({
            name: s.name,
            artist: s.artist,
            year: s.year,
            lyrics: s.lyrics
        }));

        // Call to SelahSearch NLP Agent in Hugging Face Space
        const HF_TOKEN = process.env.HF_TOKEN;
        const HF_SPACE_URL = process.env.HF_SPACE_URL;

        console.log("Connecting to the NLP worker...");
        let retries = 2;
        while (retries > 0) {
            try {
                // connect to client
                const client = await Client.connect(HF_SPACE_URL, { token: HF_TOKEN });

                // connection successful
                console.log("Connection successful. Calling the model...");
                const response = await client.predict(`/predict`, {
                    passage_text: passage.text,
                    songs_json: JSON.stringify(songs)
                }, {
                    headers: {
                        'Authorization': `Bearer ${ HF_TOKEN }`
                    },
                    timeout: NLP_WORKER_TIMEOUT
                });

                // Gradio returns results inside an 'data' array
                const results = response.data[0];
                if (results && results.error) {
                    console.error("NLP Agent Logic Error:", results.error);
                    return res.status(422).json({
                        error: "The NLP agent processed the request but encountered a logic error.",
                        details: results.error
                    });
                }

                const responseData = {
                    collection: collectionKey,
                    passages: resolvedPassages,
                    total_matches: results.length,
                    matches: results
                };

                // Save to Cache before returning
                nlpCache.set(cacheKey, responseData);

                console.log("Returning response packet as json...\n");
                return res.json(responseData);

                // Connection succeeded! Drop out of loop.
            } catch (connectError) {
                retries--;
                console.warn(`[Connection Attempt] Space is waking up or unavailable. Retries left: ${ retries }. Message: ${ connectError.message }`);

                // If connection failed, attempt to fire a hard restart request 
                if (retries === 1) {
                    await forceHuggingFaceRestart();
                } else if (retries === 0) {
                    throw connectError; // Out of retries, send to main catch block
                }

                // Wait before trying to connect again
                await new Promise(resolve => setTimeout(resolve, NLP_CONNECTION_RETRY_DELAY));
            }
        }

    } catch (error) {
        console.error("Gateway Error:", error.response?.data || error.message);

        // Handle "Cold Start" on Hugging Face (if space is sleeping)
        if (error.response?.status === 503 || error.code === 'ECONNABORTED') {
            return res.status(503).json({
                error: "NLP Agent is currently waking up or overwhelmed. Please retry in a moment."
            });
        }

        // Handle extractPassage() passage does not exist or other syntax errors (e.g. start > end)
        const msg = error.message;
        let statusCode = (msg.includes("does not exist") || msg.includes("out of bounds") || msg.includes("required")) ? 404 : 400;
        res.status(statusCode).json({ error: msg });
    }
});

/**
 * Get songs relating to the text provided as input
 */
app.post('/text/matches/v1', async (req, res) => {
    console.log("Received request for /text/matches...");
    try {
        console.log("Parsing text in request body...");
        const collectionKey = req.query.collection || req.body.collection || 'marsfield_cc';
        const text = req.body.text;
        if (!text) {
            return res.status(400).json({ error: "A 'text' field is required in the request body." });
        }

        console.log("Attempting to retrieve from cache...");
        const cacheKey = nlpCache.generateKey(collectionKey, '/predict/text', { text });
        const cachedResult = nlpCache.get(cacheKey);
        if (cachedResult) {
            console.log(`[Cache Hit] Returning cached matches for text query in collection: ${ collectionKey }`);
            return res.json(cachedResult);
        }

        console.log("Extracting lyrics of all songs...");
        const songs = getAllLyrics(collectionKey).map(s => ({
            name: s.name,
            artist: s.artist,
            year: s.year,
            lyrics: s.lyrics
        }));

        // Call to SelahSearch NLP Agent in Hugging Face Space
        const HF_TOKEN = process.env.HF_TOKEN;
        const HF_SPACE_URL = process.env.HF_SPACE_URL;

        console.log("Connecting to the NLP worker...");
        let retries = 2;
        while (retries > 0) {
            try {
                // connect to client
                const client = await Client.connect(HF_SPACE_URL, { token: HF_TOKEN });

                // connection successful
                console.log("Connection successful. Calling the model...");
                const response = await client.predict(`/predict`, {
                    passage_text: text,
                    songs_json: JSON.stringify(songs)
                }, {
                    headers: {
                        'Authorization': `Bearer ${ HF_TOKEN }`
                    },
                    timeout: 60000  // 60s timeout
                });

                // Gradio returns results inside an 'data' array
                const results = response.data[0];
                if (results && results.error) {
                    console.error("NLP Agent Logic Error:", results.error);
                    return res.status(422).json({
                        error: "The NLP agent processed the request but encountered a logic error.",
                        details: results.error
                    });
                }

                const responseData = {
                    collection: collectionKey,
                    search_query: text,
                    total_matches: results.length,
                    matches: results
                };

                // Save to Cache before returning
                nlpCache.set(cacheKey, responseData);

                console.log("Returning response packet as json...\n");
                return res.json(responseData);  // Connection succeeded! Drop out of loop.
            } catch (connectError) {
                retries--;
                console.warn(`[Connection Attempt] Space is waking up or unavailable. Retries left: ${ retries }. Message: ${ connectError.message }`);

                // If connection failed, attempt to fire a hard restart request 
                if (retries === 1) {
                    await forceHuggingFaceRestart();
                } else if (retries === 0) {
                    throw connectError; // Out of retries, send to main catch block
                }

                // Wait before trying to connect again
                await new Promise(resolve => setTimeout(resolve, NLP_CONNECTION_RETRY_DELAY));
            }
        }

    } catch (error) {
        console.error("Gateway Error:", error.response?.data || error.message);

        // Handle "Cold Start" on Hugging Face (if space is sleeping)
        if (error.response?.status === 503 || error.code === 'ECONNABORTED') {
            return res.status(503).json({
                error: "NLP Agent is currently waking up or overwhelmed. Please retry in a moment."
            });
        }

        const msg = error.message;
        let statusCode = (msg.includes("does not exist") || msg.includes("out of bounds")) ? 404 : 400;
        res.status(statusCode).json({ error: msg });
    }
});

/**
 * Get themes matching all songs ~~in the collection provided as input~~
 */
app.get('/songs/themes/v1', async (req, res) => {
    console.log("Received request for /songs/themes...");
    try {
        const collectionKey = req.query.collection || 'marsfield_cc';

        console.log(`Extracting lyrics for collection "${ collectionKey }"...`);
        const songs = getAllLyrics(collectionKey).map(s => ({
            name: s.name,
            artist: s.artist,
            year: s.year,
            lyrics: s.lyrics
        }));

        // 1. Generate unique cache key using valid songs count
        const cacheKey = nlpCache.generateKey(collectionKey, '/extract_themes', { songsCount: songs.length });

        // 2. Check cache first
        const cachedResult = nlpCache.get(cacheKey);
        if (cachedResult) {
            console.log(`[Cache Hit] Returning cached NLP themes for collection: ${ collectionKey }`);
            return res.json(cachedResult);
        }

        console.log(`[Cache Miss] Calling HF NLP worker...`);

        // Call to SelahSearch NLP Agent in Hugging Face Space
        const HF_TOKEN = process.env.HF_TOKEN;
        const HF_SPACE_URL = process.env.HF_SPACE_URL;

        console.log("Connecting to the NLP worker...");
        let retries = 2;
        while (retries > 0) {
            try {
                // connect to client
                const client = await Client.connect(HF_SPACE_URL, { token: HF_TOKEN });

                // connection successful
                console.log("Connection successful. Calling the model...");
                console.log(`Attempting to extract themes for ${ songs.length } songs. Please wait...\n`);
                let matches = [];
                for (const song of songs) {
                    console.log(`Processing themes for ${ song.name }`);
                    const response = await client.predict(`/extract_themes`, {
                        input_text: song.lyrics,
                    }, {
                        headers: {
                            'Authorization': `Bearer ${ HF_TOKEN }`
                        },
                        timeout: NLP_WORKER_TIMEOUT
                    });

                    // Gradio returns results inside an 'data' array
                    const results = response.data[0];
                    if (results && results.error) {
                        console.error("NLP Agent Logic Error:", results.error);
                        return res.status(422).json({
                            error: "The NLP agent processed the request but encountered a logic error.",
                            details: results.error
                        });
                    }

                    // cull irrelevant themes and return
                    const filteredThemes = results.filter(t => t.score > THEME_SCORE_THRESHOLD);
                    const themeNames = filteredThemes.map(t => t.theme).join(', ');

                    matches.push({
                        song: song.name,
                        artist: song.artist,
                        year: song.year,
                        total_matches: filteredThemes.length,
                        themes: themeNames,
                        theme_scores: filteredThemes
                    });
                }

                nlpCache.set(cacheKey, matches);
                console.log("\nReturning response packet as json...\n");
                return res.json(matches); // Connection succeeded! Drop out of loop.
            } catch (connectError) {
                retries--;
                console.warn(`[Connection Attempt] Space is waking up or unavailable. Retries left: ${ retries }. Message: ${ connectError.message }`);

                // If connection failed, attempt to fire a hard restart request 
                if (retries === 1) {
                    await forceHuggingFaceRestart();
                } else if (retries === 0) {
                    throw connectError; // Out of retries, send to main catch block
                }

                // Wait before trying to connect again
                await new Promise(resolve => setTimeout(resolve, NLP_CONNECTION_RETRY_DELAY));
            }
        }

    } catch (error) {
        console.error("Gateway Error:", error.response?.data || error.message);

        // Handle "Cold Start" on Hugging Face (if space is sleeping)
        if (error.response?.status === 503 || error.code === 'ECONNABORTED') {
            return res.status(503).json({
                error: "NLP Agent is currently waking up or overwhelmed. Please retry in a moment."
            });
        }

        const msg = error.message;
        let statusCode = (msg.includes("does not exist") || msg.includes("out of bounds")) ? 404 : 400;
        res.status(statusCode).json({ error: msg });
    }
});

/**
 * Get themes matching the song whose title is entered as input
 */

/**
 * Get themes matching the bible passage whose reference is provided as input
 */
app.post('/passages/themes/v1', async (req, res) => {
    console.log("Received request for /passages/themes...");
    try {
        // Extract raw query params
        console.log("Parsing query passages...");
        const requestedPassages = req.body.passages;

        if (!requestedPassages || !Array.isArray(requestedPassages) || requestedPassages.length === 0) {
            return res.status(400).json({ error: "A 'passages' array is required in the request body." });
        }

        // parse passages by handling duplicates and overlaps
        const mergedRequests = mergePassageRequests(requestedPassages);

        // extract passages and combine all text contents together
        let combinedText = "";
        let firstResolved = null;
        const resolvedPassages = [];
        for (const p of mergedRequests) {
            // Note: If extractPassage() throws, execution jumps straight to the main catch block
            const extracted = extractPassage(
                p.book,
                p.startChapter,
                p.startVerse,
                p.endChapter,
                p.endVerse
            );

            combinedText += extracted.text + "\n\n";

            // Save the first resolved metadata block for the JSON response structure
            if (!firstResolved) {
                firstResolved = extracted.resolved;
            }

            resolvedPassages.push({
                book: extracted.resolved.book,
                startChapter: extracted.resolved.startChapter,
                startVerse: extracted.resolved.startVerse,
                endChapter: extracted.resolved.endChapter,
                endVerse: extracted.resolved.endVerse,
                // passageSnippet returns first 100 characters, then all characters before next space before ...
                passageSnippet: (() => {
                    const txt = extracted.text;
                    if (txt.length <= 100) return txt;
                    const nextSpace = txt.indexOf(' ', 100);
                    return nextSpace === -1 ? txt : txt.substring(0, nextSpace) + "...";
                })()
            });
        }

        const passage = {
            text: combinedText.trim(),
            resolved: firstResolved
        };

        // Call to SelahSearch NLP Agent in Hugging Face Space
        const HF_TOKEN = process.env.HF_TOKEN;
        const HF_SPACE_URL = process.env.HF_SPACE_URL;

        console.log("Connecting to the NLP worker...");
        let retries = 2;
        while (retries > 0) {
            try {
                // connect to client
                const client = await Client.connect(HF_SPACE_URL, { token: HF_TOKEN });

                // connection successful
                console.log("Connection successful. Calling the model...");
                const response = await client.predict(`/extract_themes`, {
                    input_text: passage.text,
                }, {
                    headers: {
                        'Authorization': `Bearer ${ HF_TOKEN }`
                    },
                    timeout: NLP_WORKER_TIMEOUT
                });

                // Gradio returns results inside an 'data' array
                const results = response.data[0];
                if (results && results.error) {
                    console.error("NLP Agent Logic Error:", results.error);
                    return res.status(422).json({
                        error: "The NLP agent processed the request but encountered a logic error.",
                        details: results.error
                    });
                }

                console.log("Returning response packet as json...\n");
                res.json({
                    passages: resolvedPassages,
                    total_matches: results.length,
                    themes: results
                });

                break; // Connection succeeded! Drop out of loop.
            } catch (connectError) {
                retries--;
                console.warn(`[Connection Attempt] Space is waking up or unavailable. Retries left: ${ retries }. Message: ${ connectError.message }`);

                // If connection failed, attempt to fire a hard restart request 
                if (retries === 1) {
                    await forceHuggingFaceRestart();
                } else if (retries === 0) {
                    throw connectError; // Out of retries, send to main catch block
                }

                // Wait before trying to connect again
                await new Promise(resolve => setTimeout(resolve, NLP_CONNECTION_RETRY_DELAY));
            }
        }

    } catch (error) {
        console.error("Gateway Error:", error.response?.data || error.message);

        // Handle "Cold Start" on Hugging Face (if space is sleeping)
        if (error.response?.status === 503 || error.code === 'ECONNABORTED') {
            return res.status(503).json({
                error: "NLP Agent is currently waking up or overwhelmed. Please retry in a moment."
            });
        }

        // Handle extractPassage() passage does not exist or other syntax errors (e.g. start > end)
        const msg = error.message;
        let statusCode = (msg.includes("does not exist") || msg.includes("out of bounds") || msg.includes("required")) ? 404 : 400;
        res.status(statusCode).json({ error: msg });
    }
});

/**
 * Get themes matching the text provided as input
 */
app.post('/text/themes/v1', async (req, res) => {
    console.log("Received request for /text/themes...");
    try {
        console.log("Parsing text in request body...");
        const text = req.body.text;
        if (!text) {
            return res.status(400).json({ error: "A 'text' field is required in the request body." });
        }

        // Call to SelahSearch NLP Agent in Hugging Face Space
        const HF_TOKEN = process.env.HF_TOKEN;
        const HF_SPACE_URL = process.env.HF_SPACE_URL;

        console.log("Connecting to the NLP worker...");
        let retries = 2;
        while (retries > 0) {
            try {
                // connect to client
                const client = await Client.connect(HF_SPACE_URL, { token: HF_TOKEN });

                // connection successful
                console.log("Connection successful. Calling the model...");
                const response = await client.predict(`/extract_themes`, {
                    input_text: text,
                }, {
                    headers: {
                        'Authorization': `Bearer ${ HF_TOKEN }`
                    },
                    timeout: NLP_WORKER_TIMEOUT
                });

                // Gradio returns results inside an 'data' array
                const results = response.data[0];
                if (results && results.error) {
                    console.error("NLP Agent Logic Error:", results.error);
                    return res.status(422).json({
                        error: "The NLP agent processed the request but encountered a logic error.",
                        details: results.error
                    });
                }

                console.log("Returning response packet as json...\n");
                res.json({
                    text: text,
                    total_matches: results.length,
                    themes: results
                });

                break; // Connection succeeded! Drop out of loop.
            } catch (connectError) {
                retries--;
                console.warn(`[Connection Attempt] Space is waking up or unavailable. Retries left: ${ retries }. Message: ${ connectError.message }`);

                // If connection failed, attempt to fire a hard restart request 
                if (retries === 1) {
                    await forceHuggingFaceRestart();
                } else if (retries === 0) {
                    throw connectError; // Out of retries, send to main catch block
                }

                // Wait before trying to connect again
                await new Promise(resolve => setTimeout(resolve, NLP_CONNECTION_RETRY_DELAY));
            }
        }

    } catch (error) {
        console.error("Gateway Error:", error.response?.data || error.message);

        // Handle "Cold Start" on Hugging Face (if space is sleeping)
        if (error.response?.status === 503 || error.code === 'ECONNABORTED') {
            return res.status(503).json({
                error: "NLP Agent is currently waking up or overwhelmed. Please retry in a moment."
            });
        }

        // Handle extractPassage() passage does not exist or other syntax errors (e.g. start > end)
        const msg = error.message;
        let statusCode = (msg.includes("does not exist") || msg.includes("out of bounds") || msg.includes("required")) ? 404 : 400;
        res.status(statusCode).json({ error: msg });
    }
});

/**
 * Get entire bible passage contents matching the list of references provided as input
 */
app.post('/passages/contents/v1', async (req, res) => {
    console.log("Received request for /passages/contents...");
    try {
        // Extract raw query params
        console.log("Parsing query passages...");
        const requestedPassages = req.body.passages;

        if (!requestedPassages || !Array.isArray(requestedPassages) || requestedPassages.length === 0) {
            return res.status(400).json({ error: "A 'passages' array is required in the request body." });
        }

        // parse passages by handling duplicates and overlaps
        const mergedRequests = mergePassageRequests(requestedPassages);

        // extract passages and combine all text contents together
        let combinedText = "";
        let firstResolved = null;
        const resolvedPassages = [];
        for (const p of mergedRequests) {
            // Note: If extractPassage() throws, execution jumps straight to the main catch block
            const extracted = extractPassage(
                p.book,
                p.startChapter,
                p.startVerse,
                p.endChapter,
                p.endVerse
            );

            combinedText += extracted.text + "\n\n";

            // Save the first resolved metadata block for the JSON response structure
            if (!firstResolved) {
                firstResolved = extracted.resolved;
            }

            resolvedPassages.push({
                book: extracted.resolved.book,
                startChapter: extracted.resolved.startChapter,
                startVerse: extracted.resolved.startVerse,
                endChapter: extracted.resolved.endChapter,
                endVerse: extracted.resolved.endVerse,
                // return all contents
                contents: extracted.text
            });
        }

        // const returnPassages = {
        //     text: combinedText.trim(),
        //     resolved: resolvedPassages
        // };

        // console.log("Returning response packet as json...\n");
        // res.json({
        //     passages: returnPassages,
        // });

        console.log("Returning response packet as json...\n");
        res.json({
            passages: resolvedPassages,
        });

    } catch (error) {
        console.error("Gateway Error:", error.response?.data || error.message);

        // Handle extractPassage() passage does not exist or other syntax errors (e.g. start > end)
        const msg = error.message;
        let statusCode = (msg.includes("does not exist") || msg.includes("out of bounds") || msg.includes("required")) ? 404 : 400;
        res.status(statusCode).json({ error: msg });
    }
});

/**
 * Get top 50 bible passages that match the song name provided as input
 */

/**
 * Get top 50 bible passages that match the text provided as input
 */

/**
 * Get top 50 bible passages that match the theme provided as input
 */

/**
 * Get all songs and lyrics that match at least one of: name, artist and year, provided as input
 */
app.post('/song/lyrics/v1', async (req, res) => {
    console.log("Received request for /song/lyrics...");
    try {
        // Extract raw query params
        console.log("Parsing parameters...");
        const name = req.body.name;
        const artist = req.body.artist;
        const year = req.body.year;

        if (!(name || artist || year)) {
            return res.status(400).json({ error: "Either 'name', 'artist' or 'year' parameter is required." });
        }

        console.log(`Extracting lyrics of songs matching given parameters...`);
        const metadataArgs = { name, artist, year };
        const response = getLyrics(metadataArgs);

        console.log("Returning response packet as json...\n");
        res.json(!response ? { response: null } : response);

    } catch (error) {
        console.error("Gateway Error:", error.response?.data || error.message);

        // Handle extractPassage() passage does not exist or other syntax errors (e.g. start > end)
        const msg = error.message;
        let statusCode = (msg.includes("does not exist") || msg.includes("out of bounds") || msg.includes("required")) ? 404 : 400;
        res.status(statusCode).json({ error: msg });
    }
});

/**
 * Get all songs that match the song name provided as input
 */

/**
 * Get all songs whose part of their lyrics or name match the text provided as input
 */

/**
 * Get all songs whose part of their lyrics or name match the theme provided as input
 */

/**
 * Get general AI explainability to reason the output of a particular response to songs/matches
 */

/**
 * Get general AI explainability to reason the output of a particular response to text/matches
 */



// app.get('/songs/matches/v1', async (req, res) => {
//     console.log("Received request for /songs/matches...");
//     try {
//         // Extract raw query params
//         const { book, startChapter, startVerse, endChapter, endVerse } = req.query;

//         if (!book) {
//             return res.status(400).json({ error: "Book parameter is required." });
//         }

//         // Pass raw values to extraction logic
//         const passage = extractPassage(
//             book,
//             startChapter, // String: e.g. "1" or undefined
//             startVerse,   // String: e.g. "1", "start", or undefined
//             endChapter,   // String: e.g. "1" or undefined
//             endVerse      // String: e.g. "2", "end" or undefined
//         );

//         const songs = getAllLyrics().map(s => ({ name: s.songName, lyrics: s.lyrics }));

//         // NLP Model Process
//         const pyProcess = spawn('python3', ['src/model.py']);
//         let pythonData = "";
//         let pythonError = "";
//         console.log("Running the transformer model...");

//         pyProcess.stdin.write(JSON.stringify({ passage: passage.text, songs: songs }));
//         pyProcess.stdin.end();

//         pyProcess.stdout.on('data', (data) => pythonData += data.toString());
//         pyProcess.stderr.on('data', (data) => pythonError += data.toString());

//         pyProcess.on('close', (code) => {
//             if (code !== 0) {
//                 return res.status(500).json({ error: "NLP Worker failed", details: pythonError });
//             }
//             try {
//                 console.log("Sending response packet...\n");
//                 const results = JSON.parse(pythonData);

//                 res.json({
//                     search_query: {
//                         book: passage.resolved.book,
//                         startChapter: passage.resolved.startChapter,
//                         startVerse: passage.resolved.startVerse,
//                         endChapter: passage.resolved.endChapter,
//                         endVerse: passage.resolved.endVerse,
//                         passageSnippet: passage.text.substring(0, 100) + (passage.text.length > 100 ? "..." : "")
//                     },
//                     total_matches: results.length,
//                     matches: results
//                 });
//             } catch (e) {
//                 res.status(500).json({ error: "Failed to parse NLP results" });
//             }
//         });

//     } catch (error) {
//         const msg = error.message;
//         let statusCode = (msg.includes("does not exist") || msg.includes("out of bounds")) ? 404 : 400;
//         res.status(statusCode).json({ error: msg });
//     }
// });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\nSelahSearch API listening on port ${ PORT }...\n`);
});