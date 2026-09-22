import sys
import json
import numpy as np
from sentence_transformers import SentenceTransformer

# Load Model
MODEL_NAME = "odunola/sentence-transformers-bible-reference-final"
model = SentenceTransformer(MODEL_NAME)

THEMES = ["Trust and Guidance", "Restoration and Peace", "Wrath and Judgment", "Jesus", 
          "Resurrection", "Love", "Faith", "Hope", "Power", "Joy", "Victory", "Creation", 
          "Suffering", "Grace", "Kingdom", "Sin", "Spirit", "Trinity", "Eternity", 
          "Humble", "Wisdom", "Mercy", "Heaven", "Throne", "Covenant"]

THEME_VECS = model.encode(THEMES, convert_to_numpy=True)
THEME_VECS = THEME_VECS / np.linalg.norm(THEME_VECS, axis=1, keepdims=True)

def chunk_text(text):
    words = text.split()
    return [" ".join(words[i : i + 400]) for i in range(0, len(words), 200)]

def get_normalized_vector(text):
    chunks = chunk_text(text)
    embeddings = model.encode(chunks)
    avg_vec = np.mean(embeddings, axis=0)
    return avg_vec / np.linalg.norm(avg_vec)

def get_thematic_signature(doc_vec):
    raw_scores = np.dot(doc_vec, THEME_VECS.T)
    relu_scores = np.maximum(0, raw_scores)
    norm = np.linalg.norm(relu_scores)
    return relu_scores / (norm if norm > 0 else 1.0)

def main():
    # Read input from Node.js (passed via stdin)
    input_data = json.loads(sys.stdin.read())
    passage_text = input_data['passage']
    songs = input_data['songs'] # List of objects {name, lyrics}

    p_vec = get_normalized_vector(passage_text)
    p_sig = get_thematic_signature(p_vec)

    results = []

    for song in songs:
        l_vec = get_normalized_vector(song['lyrics'])
        direct_sim = float(np.dot(p_vec, l_vec))
        
        relevant_themes = []
        final_score = direct_sim

        if direct_sim >= 0.1: # Threshold constant
            l_sig = get_thematic_signature(l_vec)
            thematic_sim = float(np.dot(p_sig, l_sig))
            
            contributions = p_sig * l_sig
            relevant_themes = [THEMES[i] for i, val in enumerate(contributions) if val > 0.05]
            final_score = (0.6 * direct_sim) + (0.4 * thematic_sim)

        results.append({
            "name": song['name'],
            "score": round(final_score, 4),
            "themes": relevant_themes
        })

    # Sort and return to Node.js
    results.sort(key=lambda x: x['score'], reverse=True)
    print(json.dumps(results))

if __name__ == "__main__":
    main()