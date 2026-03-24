# Loopy (Simple Loop Browser)

A minimal Electron desktop app to browse a chosen folder of audio loops (including subfolders), search by name/path, preview playback, and drag files out to your OS/DAW.

## Features
- Choose a folder to index (recursively)
- Supported formats: wav, aiff, aif, flac, mp3, m4a, aac, ogg, oga, opus
- Search by name or relative path
- Click to play/pause, double-click to restart
- Drag-and-drop files from the list to Finder/Explorer or into many DAWs

## Getting Started

1) Install dependencies:

   cd loopy
   npm install

2) Start the app:

   npm start

3) In the app, click "Choose Folder…" and select your loops directory.

## Notes
- Drag-and-drop uses Electron's startDrag and also sets text/uri-list so many targets recognize the file.
- Playback uses the built-in HTML5 audio element, which handles many common formats.
- Hidden files/folders (starting with a dot) are ignored during scan.

## License
MIT
