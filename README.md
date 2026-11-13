# File Splitter

Browser mein file ko parts mein todne ka tool. Aapki file kabhi upload nahi hoti. Sab kaam aapke browser mein hota hai.

## Status

Legend: ✅ tested in browser · 🟡 code ready, testing pending · ⬜ planned · ➖ byte split only (by design)

| Folder | Formats | Mode | Status |
|---|---|---|---|
| shared | Koi bhi file | Byte split (size) | ✅ |
| documents | PDF | By pages | ✅ |
| documents | DOCX, XLSX | By paragraphs / rows | 🟡 |
| documents | PPTX, EPUB | By slides / chapters | 🟡 |
| archives | ZIP | By files inside | 🟡 |
| text | TXT, CSV | By lines | 🟡 |
| images | JPG, PNG | Diagonal, percent, equal parts | ✅ |
| images | WEBP, GIF, BMP | Same as JPG | 🟡 |
| audio | MP3, WAV, FLAC, M4A | By length | ✅ |
| audio | OGG (Vorbis) | By length | ✅ (seek par ~1 sec delay) |
| audio | Opus | By length | 🟡 |
| video | MP4, MOV | By length | ✅ |
| video | MP4 (fragmented) | By length | ✅ |
| video | MKV, WebM | By length | 🟡 |
| video | AVI | By length | 🟡 |
| video | M4V, 3GP, FLV, TS | By length | ⬜ |
| text | SRT, VTT | By cues | ⬜ |
| documents | ODT, ODS, ODP | By paragraphs / rows / slides | ⬜ |

Sirf byte split wale formats: RAR, 7Z, GZIP, TAR, JSON, XML, HTML, code files, ISO, IMG, VHD, EXE, DLL, APK, fonts, SQLite, PSD, HEIC, aur koi bhi unknown file. Ye formats structure ke bina split nahi ho sakte, ya unka structure split karna fayda nahi deta.

## Kaise kaam karta hai

1. File drop karo. App file ke pehle bytes dekhkar type pehchanta hai (extension ke bharose nahi).
2. Sirf wahi modes dikhte hain jo us format par kaam karte hain. Byte split un formats par chhup jata hai jinke byte parts khulte nahi (jaise PDF, MP4, JPG).
3. Value bharo (count, percent, seconds ya size). Count ki upper limit file ke total se aati hai.
4. Parts download karo, ya sab ek ZIP mein.

## Requirements

**Sirf use karne ke liye:** Chrome, Edge ya Firefox ka latest version.

**Development ke liye:**
- Node.js 20 ya usse upar: https://nodejs.org
- Git: https://git-scm.com

**Manual testing ke liye (optional):**
- FFmpeg: `winget install Gyan.FFmpeg` (test video/audio banane ke liye)
- VLC: parts check karne ke liye

Ye tools sirf test files banane aur check karne ke liye hain. App ko runtime par inki zaroorat nahi.

## Setup (development)

```powershell
git clone https://github.com/aman-devcode1/File-Splitter.git
cd File-Splitter
npm install
npm run dev
```

Browser mein `http://localhost:5173` kholo.

## Commands

| Command | Kya karta hai |
|---|---|
| `npm run dev` | Development server (hot reload) |
| `npm test` | Saare automatic tests (koi external file nahi chahiye) |
| `npm run build` | Production build, `dist/` folder mein |
| `npm run preview` | Build ko local par chalata hai |

## Production par deploy karna

```powershell
npm run build
```

`dist/` folder ko kisi static hosting par upload karo (Netlify, GitHub Pages, Vercel, ya apna server). `dist/index.html` ko double-click karke nahi chalega, HTTP server chahiye. Local check ke liye `npm run preview` use karo.

## Project structure

```
index.html                  UI ka HTML
vitest.config.ts            test settings
src/
  types.d.ts                CSS imports ke liye type declaration
  ui/
    main.ts                 browser UI (file drop, modes, download)
    styles.css              design
  core/                     split logic, browser mein chalta hai
    index.ts                saare engines register karta hai
    registry.ts             modes, input validation
    types.ts                shared types
    estimate.ts             time estimate
    duration.ts             video/audio duration
    detect/                 file type pehchan (magic bytes + extension)
    shared/                 byte split, cut planning (sab formats ke liye)
    documents/              PDF, DOCX, XLSX (PPTX, EPUB pending)
    archives/               ZIP
    text/                   TXT, CSV
    images/                 diagonal, percent, equal parts
    audio/                  WAV, MP3, FLAC, OGG
    video/                  MP4, MOV, fragmented MP4, MKV, AVI
    tests/                  automatic tests (*.spec.ts)
```

## Tests

```powershell
npm test
```

Saare test data code se ban jaate hain (synthetic files). Test ke liye FFmpeg, Python ya koi video file nahi chahiye.

## Known limits

- Poori file browser memory mein load hoti hai. Bahut badi files (kai GB) par browser slow ho sakta hai.
- Video/audio ka cut keyframe ya frame boundary par hota hai, isliye clip ki length exact nahi hoti (kuch second ka fark).
- Fragmented MP4 ko regular MP4 mein convert karke split hota hai, isliye thoda processing time lagta hai.
- Password-protected aur DRM-protected files split nahi hongi.
- Ogg Vorbis mein seek par thoda delay ho sakta hai. Opus version better hai.
- AVI ke kuch players mein "index" warning aa sakti hai.
- Byte split wale parts (PDF, video, image) ko alag se nahi khola ja sakta. Join karke hi original banta hai.

## License

Abhi license file nahi hai. Share karne se pehle MIT jaisa license add karein.