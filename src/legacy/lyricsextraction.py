
from typing import List, Dict
import re
import os

# constants
# directory_path = "lyrics/"
directory_path = "lyrics/"
regex_filter = r"[^a-zA-Z0-9']"
input_path = "input.txt"
output_path = "output.txt"

def handleSpecialCases(word: str) -> str:
    """
    Handle special cases by condensing similar words into one for analysis
    """
    if word in ["son", "christ", "messiah"]:
        word = "jesus"
    if word in ["pow'r", "powers", "pow'rs"]:
        word = "power"
    if word in ["heav'n", "heavens", "heaven's", "heav'n's"]:
        word = "heaven"
    if word in ["cause", "'cause"]:
        word = "because"
    if word in ["'till", "till", "'til", "til"]:
        word = "until"
    if word in ["blessing", "blessed"]:
        word = "bless"
    if word in ["sins", "sinful", "sinfulness", "sinner", "sinners"]:
        word = "sin"
    if word in ["judged", "judgement"]:
        word = "judge"
    if word in ["humbled", "humbleness"]:
        word = "humble"
    if word in ["savior"]:
        word = "saviour"
    if word in ["joyous", "joyful", "rejoice", "rejoicing"]:
        word = "joy"
    if word in ["forgive"]:
        word = "forgiveness"

    return word


def readFile(path: str) -> Dict:
    """
    Read words in a file and add to a dictionary with value as frequency
    """
    words = {}
    try:
        with open(path, 'r', encoding='utf-8') as file:
            for line in file:
                lineWords = line.strip().split()
                if "three in one" in line:
                    lineWords.append("trinity")

                for word in lineWords:
                    word = word.lower()
                    word = re.sub(regex_filter, '', word)
                    
                    if (not word):
                        continue

                    # special cases 
                    word = handleSpecialCases(word)
                       
                    # increment count
                    if (word in words.keys()):
                        words[word] += 1
                    else:
                        words[word] = 1

    except FileNotFoundError:
        print(f"Error: The file at '{path}' was not found.")
        return {}
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        return {}

    sorted_items = sorted(words.items(), key=lambda item: item[1], reverse=True)
    words = dict(sorted_items)
    return words


def getFilesInDir() -> List:
    """
    Get all the files in a directory and add them to a sorted list
    """
    files = []
    for filename in os.listdir(directory_path):
        fullPath = os.path.join(directory_path, filename)
        if os.path.isfile(fullPath): 
            # print(filename)
            files.append(filename)
    files.sort()
    return files


def writeOutput(songWordsFreq: Dict) -> None:
    """
    Write dict to an output file. Warning: overrides existing contents
    """
    with open(output_path, 'w') as file:
        for k, v in songWordsFreq.items():
            line = k + ": " + str(v) + "\n"
            file.write(line)


def printSongs(songs: Dict) -> None:
    """
    Print words in dict to stdout
    """
    print("Songs analysed:")

    for k in songs.keys():
        print(getSongname(k))
    print()
    print()


def printWords(path: str, words: Dict) -> None:
    """
    Print words in dict to stdout
    """
    print("Words in", path.strip(".txt"))

    for k, v in words.items():
        print(k + ": " + str(v))
    print()
    print()


def printFreq(checkWords: List, checkWordFreq: Dict) -> None:
    """
    Print word frequency to stdout
    """
    print("Songs containing", checkWords, "\n")

    # 1. Print words and their frequency
    # for k, v in checkWordFreq.items():
    #     print(k.removesuffix(".txt") + ":\n" + str(v) + "\n")

    # 2. Print comma separated list of words (not frequency)
    for song, values in checkWordFreq.items():
        outputStr = getSongname(song) + ": "
        for k in values.keys():
            outputStr += str(k) + ", "
        outputStr = outputStr.removesuffix(",")
        print(outputStr + "\n")
    print()
    print()


def topSongsWithWords(checkWords: List, songWordsFreq: Dict) -> Dict:
    """
    Move words found in checkWords for each song to a new dict
    """
    checkWordFreq = {}
    for song, values in songWordsFreq.items():
        for k, v in values.items():
            if k in checkWords:
                if (song not in checkWordFreq.keys()):
                    checkWordFreq[song] = {}
                checkWordFreq[song][k] = v
    return checkWordFreq


def scoreTopWords(checkWordFreq: Dict) -> Dict:
    """
    Sum number of words found for each song and sort them to score top songs
    """
    wordScore = {}
    for song, values in checkWordFreq.items():
        score = len(values.keys())
        wordScore[song] = score

    sorted_items = sorted(wordScore.items(), key=lambda item: item[1], reverse=True)
    wordScore = dict(sorted_items)
    return wordScore


def printScore(wordScore: Dict) -> None:
    """
    Print song scores to stdout
    """
    print("Top songs by score:")

    for k, v in wordScore.items():
        title = getSongname(k)
        print(title + ": " + str(v))
    print()
    print()


def isGospelCentric(songWords: Dict) -> bool:
    """
    Determine if a song's lyrics are gospel-centric or not, by finding instances of gospel-centric words
    """
    gospelCentricWords = ["jesus"]

    for k in songWords.keys():
        if k in gospelCentricWords:
            return True
    return False


def printGospelCentric(checkWordFreq: Dict) -> None:
    """
    Print all song names that are considered gospel-centric
    """
    print("Gospel-centric songs:")

    for song, values in checkWordFreq.items():
        if (isGospelCentric(values)):
            print(getSongname(song))
    print()
    print()


def extractLyricsByName(songname: str) -> str:
    """
    Get a song's lyrics by name. That's it.
    """
    return extractLyricsByFile(getFilename(songname))


def extractLyricsByFile(filename: str) -> str:
    """
    Get a song's lyrics by filename. That's it
    """
    path = os.path.join(directory_path, filename)
    content = ""

    try:
        with open(path, 'r', encoding='utf-8') as file:
            content = file.read()

        content = content.strip()
        return content

    except FileNotFoundError:
        print(f"Error: The file at '{path}' was not found.")
        return ""
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        return ""


def getSongname(filename: str) -> str:
    """
    Get the name of a song in title case format from its filename
    """
    return filename.removesuffix(".txt").replace("_", " ").title()


def getFilename(songname: str) -> str:
    """
    Get the name of a song in title case format from its filename
    """
    return songname.strip().lower().replace(' ', '_') + '.txt'


def main() -> None:
    print()

    # 0. Optional step to print song lyrics of a single song to test extractLyrics
    # print(extractLyrics("Your Word"))

    # 1. Load lyrics from all songs and record words
    files = getFilesInDir()
    songWordsFreq = {}
    for file in files:
        words = readFile(directory_path + file)
        # printWords(file, words)

        songWordsFreq[file] = words

    printSongs(songWordsFreq)
    # writeOutput(songWordsFreq)

    # 2. Check occurrences of word in songs
    checkWords = readFile(input_path)
    checkWords = list(checkWords.keys()) # only list required here

    checkWordFreq = topSongsWithWords(checkWords, songWordsFreq)
    printFreq(checkWords, checkWordFreq)

    printGospelCentric(checkWordFreq)

    wordScore = scoreTopWords(checkWordFreq)
    printScore(wordScore)

    print()

if __name__ == "__main__":
    main()
