require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const LYRICS_DIR = './lyrics';
const DB_NAME = 'selah_db';
const COLLECTION_NAME = 'songs';

const username = encodeURIComponent(process.env.MONGODB_USERNAME);
const password = encodeURIComponent(process.env.MONGODB_PASSWORD);
const cluster = 'devcluster';
const uri = `mongodb+srv://${ username }:${ password }@${ cluster }.sypen0x.mongodb.net/?retryWrites=true&w=majority`;

/**
 * Placeholder for the NLP theme detection logic we'll build later.
 */
function getSongThemes(lyrics) {
    // Currently returns a placeholder array. TODO: implement this
    return ["General", "Worship"];
}

/**
 * Converts filename "amazing_grace.txt" to "Amazing Grace"
 */
function formatTitle(filename) {
    return filename
        .replace('.txt', '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase());
}

async function seedDatabase() {
    const client = new MongoClient(uri);

    try {
        console.log("Connecting to MongoDB Atlas...");
        await client.connect();
        const collection = client.db(DB_NAME).collection(COLLECTION_NAME);

        // 1. Read the lyrics directory
        const files = fs.readdirSync(LYRICS_DIR).filter(f => f.endsWith('.txt'));

        if (files.length === 0) {
            console.log("No .txt files found in the lyrics folder.");
            return;
        }

        // 2. Prepare the data
        const songDocuments = files.map((filename, index) => {
            const filePath = path.join(LYRICS_DIR, filename);
            const lyrics = fs.readFileSync(filePath, 'utf8').trim();

            return {
                songId: index + 1, // Simple incremental ID
                title: formatTitle(filename),
                artist: "", // TODO: handle this
                filename: filename,
                lyrics: lyrics,
                themes: getSongThemes(lyrics),
                dateAdded: new Date()
            };
        });

        console.log(`Prepared ${ songDocuments.length } songs. Cleaning old collection...`);

        // 3. Clear existing data (Optional: remove this if you want to append instead of reset)
        // await collection.deleteMany({});

        // 4. Bulk Insert
        const result = await collection.insertMany(songDocuments);
        console.log(`✅ Success! ${ result.insertedCount } songs were uploaded to MongoDB.`);

    } catch (err) {
        console.error("❌ Error seeding database:", err);
    } finally {
        await client.close();
    }
}

seedDatabase();