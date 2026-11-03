# Hitaru (Yes I use claude, if you dont like AI use dont use this project)

A Japanese immersion log and subtitle video player that runs on your own computer. Log your
watching time, play episodes with clickable subtitles, see which words you already know from
Anki, and turn new words into Anki cards in one click.

Only the first section is required. Add whichever of the others you want, in any order.
Everything has only been tested on Windows, and the commands below are for PowerShell.

| I want to… | Set up |
|---|---|
| Log immersion and see my stats | [Basic setup](#basic-setup) |
| Watch my own episodes with subtitles | [Add your shows](#add-your-shows) |
| See which words I know | [Anki](#anki) |
| Make Anki cards from episodes | [Anki](#anki), then [Card creation](#card-creation) |
| Highlight each word as it's spoken | [Word highlighting with Whisper](#word-highlighting-with-whisper) |
| Log YouTube watching | [YouTube extension](#youtube-extension) |
| Log time from mpv | [mpv capture](#mpv-capture) |

## Basic setup

Install [Node.js](https://nodejs.org) 20.19 or newer (22.12 or newer on the 22 line), then:

```powershell
git clone https://github.com/SimonSaltys/hitaru.git
cd hitaru
npm install
npm run dev
```

Open <http://localhost:5173>. Run `npm run dev` each time you want to use Hitaru, and keep that
terminal open while you do.

Your log is saved to `Documents\Hitaru\hitaru-data.json`, with daily backups kept alongside it.
Nothing in it is uploaded anywhere.

## Add your shows

Put your videos in `Desktop\Shows`, using a folder for each show. The folder name becomes the
title in your log, and anything in parentheses is left out:

```text
Desktop\Shows\
  Some Show (2024)\
    Episode 01.mkv
    Episode 02.mp4
    Episode 02.ja.srt
```

Videos can be `.mkv`, `.mp4`, `.m4v` or `.webm`. Hitaru plays them in your browser, so a file
won't play if your browser can't handle its video or audio format. H.264 video with AAC audio is
the safest choice.

Subtitles come from one of two places:

- **Inside an `.mkv`:** a Japanese text subtitle track is used automatically.
- **A separate `.srt` file:** give it the same name as the video, ending in `.ja.srt`, `.jpn.srt`
  or `.srt`.

To keep your shows somewhere else, set the folder before starting Hitaru:

```powershell
$env:HITARU_LIBRARY = "D:\Anime"
npm run dev
```

### Player keys

| Key | Action |
|---|---|
| `Q` / `E` | Previous / next line |
| `R` | Replay the current line |
| `S` | Subtitles on or off |
| `M` | Switch between Immersion and Study (pauses at the end of every line) |

## Anki

This highlights words by how well you know them, and lists the words worth learning next.

1. Install [Anki](https://apps.ankiweb.net).
2. In Anki, go to **Tools → Add-ons → Get Add-ons** and enter code `2055492159` to install
   [AnkiConnect](https://ankiweb.net/shared/info/2055492159). Then restart Anki.
3. Leave Anki open while you use Hitaru.

Hitaru reads your existing cards from any deck, as long as the note type has a field named `Word`,
`Expression`, `Vocab` or `Vocabulary`. A word counts as known once its card is green (past the
learning stage) and not suspended.

## Card creation

Each card gets the word, its reading and definition, the subtitle line, a screenshot and an audio
clip. Cards go into a deck called `Hitaru Mining`, which is created for you. This needs the
[Anki setup](#anki) plus two things:

1. **The `Kaishi 1.5k` note type.** Download the Kaishi 1.5k shared deck from AnkiWeb and import
   it. New cards use its note type, which must keep that exact name and its field names.
2. **ffmpeg, by either of these routes:**
   - Set up [word highlighting](#word-highlighting-with-whisper), which includes it.
   - Install ffmpeg yourself and tell Hitaru where it is. This is the much smaller download:

     ```powershell
     winget install Gyan.FFmpeg
     ```

     Open a new terminal, then point Hitaru at it:

     ```powershell
     $env:HITARU_FFMPEG = (Get-Command ffmpeg).Source
     npm run dev
     ```

     That setting only lasts for the current terminal. To keep it, run
     `setx HITARU_FFMPEG (Get-Command ffmpeg).Source` once and open a new terminal.

The first card you make also downloads the JMdict dictionary, so you need to be online for that
one. After that, definitions work offline.

## Word highlighting with Whisper

This uses Whisper to time each subtitle's words against the episode's audio, so the current word
lights up as it's spoken.

**Before you start:**

- It takes about 7.5 GB of disk space: about 4.6 GB for PyTorch and the aligner, plus about 3 GB
  for the Whisper `large-v3` model.
- An NVIDIA graphics card is strongly recommended. It can run on the CPU, but expect that to be
  very slow.

**Setup:**

1. Install [uv](https://docs.astral.sh/uv/), then open a new terminal:

   ```powershell
   winget install astral-sh.uv
   ```

2. From the `hitaru` folder, install the aligner. uv fetches the right Python version itself:

   ```powershell
   cd aligner
   uv sync
   cd ..
   ```

3. Restart `npm run dev`.

**Use:** open an episode on the Watch page and click **Prepare word highlighting**. The model
downloads on the first run, and progress is shown as lines completed. Each episode only needs
preparing once.

Lines the aligner isn't confident about stay unhighlighted. That's expected, and it's most common
on short sounds like うん.

## YouTube extension

Times the YouTube videos you watch and lets you choose which ones to log.

1. In Chrome, open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick the `extension` folder.

The extension only talks to Hitaru on port 5173. If `npm run dev` shows a different port, something
else is using 5173, so close it and restart Hitaru.

## mpv capture

Logs time from [mpv](https://mpv.io) instead of the built-in player. Start mpv with:

```powershell
mpv --input-ipc-server=\\.\pipe\hitaru-mpv "path\to\episode.mkv"
```

To avoid typing that each time, add this line to `%APPDATA%\mpv\mpv.conf`:

```text
input-ipc-server=\\.\pipe\hitaru-mpv
```

## Settings

Set these in the terminal before running `npm run dev`.

| Variable | What it changes | Default |
|---|---|---|
| `HITARU_LIBRARY` | Folder containing your shows | `Desktop\Shows` |
| `HITARU_DATA` | Folder for your log and the dictionary | `Documents\Hitaru` |
| `HITARU_FFMPEG` | Full path to ffmpeg | The copy included with the aligner |

## Troubleshooting

- **No episodes listed:** check that the videos are in your shows folder, then reload the page.
- **No subtitles:** check that the `.srt` has the same name as the video, or that the `.mkv` has a
  Japanese text track. Image-based subtitles can't be read.
- **Video won't play:** your browser probably doesn't support its format. Try converting it to
  H.264 and AAC.
- **Known words aren't showing:** check that Anki is open and AnkiConnect is installed.
- **"ffmpeg wasn't found":** follow the ffmpeg step in [Card creation](#card-creation).
- **A card fails or says the note type is missing:** check that `Kaishi 1.5k` is in Anki under
  **Tools → Manage Note Types**.
- **Word highlighting failed:** hover over the button to see the error. "Couldn't start the
  aligner" usually means uv isn't installed, or Hitaru was started before it was.

## Development

```powershell
npm test
npm run build
```

## License

[MIT](LICENSE): free to use, change and share, including commercially, as long as the license
notice is kept.
