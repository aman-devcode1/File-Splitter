# File Splitter

Browser mein file ko parts mein todne ka tool. Aapki file kabhi upload nahi hoti. Sab kaam aapke browser mein hota hai.

## Status

Legend: ✅ tested in browser · 🟡 code ready, testing pending · ⬜ planned · ➖ byte split only (by design)

| Folder | Formats | Mode | Status |
|---|---|---|---|
| shared | Koi bhi file | Byte split (size) | ✅ |
| documents | PDF | By pages | ✅ |
| documents | DOCX | By paragraphs (numbering har part mein continue) | ✅ |
| documents | XLSX | By rows (header har part mein, table range sahi) | ✅ |
| documents | PPTX, EPUB | By slides / chapters | ✅ |
| documents | ODT | By paragraphs | ✅ |
| documents | ODS | By rows | ✅ |
| documents | ODP | By slides | ✅ |
| archives | ZIP | By files inside | ✅ |
| archives | 7Z, TAR | By files inside (parts ZIP mein) | ✅ |
| archives | RAR | By files inside (parts ZIP mein) | ✅ |
| text | TXT | By lines, ya byte split | ✅ |
| text | CSV | By rows (header har part mein) | ✅ |
| text | SRT, VTT | By cues | ✅ |
| images | JPG, PNG | Diagonal, percent, equal parts | ✅ |
| images | WEBP, GIF, BMP | Same as JPG | 🟡 |
| audio | MP3, WAV, FLAC, M4A | By length | ✅ |
| audio | OGG (Vorbis) | By length | ✅ (seek par ~1 sec delay) |
| audio | Opus | By length | ✅ |
| video | MP4, MOV | By length | ✅ |
| video | MP4 (fragmented) | By length | ✅ |
| video | 3GP | By length | ✅ |
| video | M4V | By length | ✅ |
| video | MKV, WebM | By length | ✅ |
| video | AVI | By length | ✅ |
| video | FLV | By length | ✅ |
| video | TS, M2TS | By length | ✅ |

Sirf byte split wale formats: JSON, XML, HTML, code files, GZIP, ISO, IMG, VHD, EXE, DLL, APK, fonts, SQLite, PSD, HEIC, aur koi bhi unknown file. Ye formats structure ke bina split nahi ho sakte, ya unka structure split karna fayda nahi deta.

## Kaise kaam karta hai

1. File drop karo. App file ke pehle bytes dekhkar type pehchanta hai (extension ke bharose nahi).
2. Sirf wahi modes dikhte hain jo us format par kaam karte hain. Byte split un formats par chhup jata hai jinke byte parts khulte nahi (jaise PDF, MP4, JPG, DOCX, ZIP).
3. Value bharo (count, percent, seconds ya size). Count ki upper limit file ke total se aati hai.
4. Parts download karo, ya sab ek ZIP mein.

Count modes (rows, slides, paragraphs, cues, files) mein header row ya header wali cheezein value mein nahi ginti jati. Wo har part mein apne aap aati hain.

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

**Archive support (7Z, RAR, TAR):** `libarchive.js` ki worker files `public/libarchive/` mein honi chahiye. Ye folder repo mein already hai. Agar kisi wajah se nahi hai, to ye chalao:

```powershell
New-Item -ItemType Directory -Force public\libarchive | Out-Null
Copy-Item -Recurse -Force node_modules\libarchive.js\dist\* public\libarchive\
```

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
public/
  libarchive/               7Z, RAR, TAR ke liye worker files (libarchive.js)
src/
  types.d.ts                CSS aur libarchive ke type declarations
  ui/
    main.ts                 browser UI (file drop, modes, download)
    styles.css              design
  core/                     split logic, browser mein chalta hai
    index.ts                saare engines register karta hai (lazy loading)
    registry.ts             modes, input validation
    types.ts                shared types
    estimate.ts             time estimate
    duration.ts             video/audio duration
    detect/                 file type pehchan (magic bytes + extension)
    shared/                 byte split, cut planning (sab formats ke liye)
    documents/              PDF, DOCX, XLSX, PPTX, EPUB, ODT/ODS/ODP
    archives/               ZIP (JSZip), 7Z/RAR/TAR (libarchive.js)
    text/                   TXT, CSV, SRT, VTT
    images/                 diagonal, percent, equal parts
    audio/                  WAV, MP3, FLAC, OGG, Opus
    video/                  MP4, MOV, fragmented MP4, MKV, AVI, FLV, TS, 3GP
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
- 7Z, RAR aur TAR ke parts ZIP format mein save hote hain, kyunki 7Z/RAR/TAR likhne ka support nahi hai.
- Archive mein empty folders output mein nahi aate, sirf files aati hain.
- Archive ke andar ki poori files memory mein load hoti hain. Bahut badi archive slow hogi.
- Password-protected archive nahi khulegi.
- Highly compressed archive (chhoti zip, badi andar ki files) ka split estimate se zyada time le sakta hai.
- DOCX mein numbering sirf directly lagi list (numPr) par continue hoti hai, style se lagi list par nahi.
- XLSX mein formulas jo purani row numbers par refer karti hain, wo part mein alag result de sakti hain.
- CSV mein quotes ka galat use (jaise unquoted field mein `"`) records ko galat jod sakta hai.
- Text (TXT, CSV) ka byte split multi-byte characters (jaise Hindi) ke beech kat sakta hai.

## License

Abhi license file nahi hai. Share karne se pehle MIT jaisa license add karein.