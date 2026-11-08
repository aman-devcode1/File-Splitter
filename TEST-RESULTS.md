# File Splitter: test results

Status: pending / pass / fail / n/a (expected)

| Folder | File | Mode | Value | Parts | Plays or opens | Duration row | Status | Notes |
|---|---|---|---|---|---|---|---|---|
| Video/MP4 | Lake Louise 18s | By length | 5 | | | | pending | aap test karein |
| Video/MP4 | Cat video 4:59 | By length | 60 | 5 | yes | 4:59 | pass | timeline, seek ok |
| Video/MP4 | Granny 25:45 (261 MB) | By length | 300 | | | | pending | memory/time note karein |
| Video/MP4 | Fragmented (ffmpeg-converted) cat | By length | 60 | 5 | yes, sync ok | 4:59 | pass | tfdt rebased per track, converted to regular MP4 with full index, smooth seek |
| Video/MP4 | Byte split on any MP4 | n/a | | | | | n/a | byte split hidden (header only in part 1) |
| Video/MOV | Cat video 4:59 | By length | 60 | 5 | yes | 4:59 | pass | |
| Audio/M4A | Taswir 3:52 | By length | 60 | 4 | yes | 3:52 | pending | browser test karein |
| Audio/WAV | Taswir 41 MB | By length | 60 | | | 2:xx | pending | browser test karein |
| Audio/MP3 | Taswir 7.7 MB | By length | 60 | | | 2:xx | pending | browser test karein |
| Audio/FLAC | NARAZ (MP3 se convert) | By length | 60 sec | 4 | yes | 3:08 | pass | frame-accurate cut, total duration matches |
| Audio/Opus | NARAZ_test.opus (libopus 128k) | By length | 60 sec | 4 | yes | 3:08 | pending | seek delay compare with ogg |
| Image | Screenshot JPG | Diagonal | - | 2 | yes | - | pass | |
| Image | Screenshot JPG | Horizontal percent | 50 | 2 | | | pending | |
| Image | Screenshot JPG | Vertical equal | 3 | 3 | | | pending | |
| Image | PNG | Diagonal | - | 2 | | | pending | transparent check |
| Document | PDF | By pages | 1 | | | | pending | |
| Document | DOCX | By paragraphs | 1 | | | | pending | |
| Document | XLSX | By rows | 1 | | | | pending | |
| Document | ZIP | By files inside | 1 | | | | pending | |
| Text | TXT | By lines | 1 | | | | pending | |
| Any | MKV / AVI | Byte split only | | | | | n/a | no length mode yet |