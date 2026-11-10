import JSZip from 'jszip';
import {
    detectFile,
    modesFor,
    parseModeInput,
    splitFile,
    estimateSeconds,
    describeEstimate,
    itemTotal,
    type DetectedFile,
    type ModeDefinition,
    type SplitPart,
    formatClock,
    mediaDuration,
    oggCodec,
} from '../core';
import type { ByteUnit } from '../core/shared/byte-split';


import '@fontsource/philosopher/400.css';
import '@fontsource/philosopher/700.css';

// const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const $ = <T extends HTMLElement>(id: string): T => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing element #${id} in index.html`);
    return el as T;
};

const els = {
    dropzone: $<HTMLElement>('dropzone'),
    picker: $<HTMLInputElement>('picker'),
    browse: $<HTMLButtonElement>('browse'),
    fileinfo: $<HTMLElement>('fileinfo'),
    fname: $<HTMLElement>('fname'),
    fsize: $<HTMLElement>('fsize'),
    ftype: $<HTMLElement>('ftype'),
    setup: $<HTMLElement>('setup'),
    mode: $<HTMLInputElement>('mode'),
    modeBtn: $<HTMLButtonElement>('modeBtn'),
    modeLabel: $<HTMLElement>('modeLabel'),
    modeList: $<HTMLElement>('modeList'),
    modeHelp: $<HTMLElement>('modeHelp'),
    valueField: $<HTMLElement>('valueField'),
    value: $<HTMLInputElement>('value'),
    valueLabel: $<HTMLElement>('valueLabel'),
    unit: $<HTMLSelectElement>('unit'),
    unitField: $<HTMLElement>('unitField'),
    inputHelp: $<HTMLElement>('inputHelp'),
    presets: $<HTMLElement>('presets'),
    error: $<HTMLElement>('error'),
    split: $<HTMLElement>('split'),
    splitBtn: $<HTMLButtonElement>('splitBtn'),
    estimate: $<HTMLElement>('estimate'),
    progress: $<HTMLElement>('progress'),
    reset: $<HTMLButtonElement>('reset'),
    result: $<HTMLElement>('result'),
    summary: $<HTMLElement>('summary'),
    partRows: $<HTMLElement>('partRows'),
    zipAll: $<HTMLButtonElement>('zipAll'),
    valueSuffix: $<HTMLElement>('valueSuffix'),
    durationRow: $<HTMLElement>('fdurationRow'),
    duration: $<HTMLElement>('fduration'),
    codecTip: $<HTMLElement>('codecTip'),
};

interface Preset {
    readonly label: string;
    readonly value: string;
    readonly unit?: ByteUnit;
}

const countLabels: Record<string, string> = {
    'pdf-pages': 'Pages per part',
    'zip-entries': 'Files per part',
    'text-lines': 'Lines per part',
    'docx-paragraphs': 'Paragraphs per part',
    'xlsx-rows': 'Rows per part',
    'image-h-count': 'Number of horizontal parts',
    'image-v-count': 'Number of vertical parts',
};

const countNouns: Record<string, string> = {
    'pdf-pages': 'pages',
    'zip-entries': 'files',
    'text-lines': 'lines',
    'docx-paragraphs': 'paragraphs',
    'xlsx-rows': 'rows',
};

const BYTE_PRESETS: Preset[] = [
    { label: '1 MB', value: '1', unit: 'MB' },
    { label: '10 MB', value: '10', unit: 'MB' },
    { label: '100 MB', value: '100', unit: 'MB' },
    { label: '1 GB', value: '1', unit: 'GB' },
];

const TIME_PRESETS: Preset[] = [
    { label: '30 sec', value: '30' },
    { label: '1 min', value: '60' },
    { label: '5 min', value: '300' },
    { label: '10 min', value: '600' },
];

const CONFIRM_ABOVE_PARTS = 10_000;
const WARN_ABOVE_PARTS = 500;

let file: File | null = null;
let detected: DetectedFile | null = null;
let modes: ModeDefinition[] = [];
let urls: string[] = [];
/** Items in the file for the current count mode. null while loading. */
let total: number | null = null;
/** Changes on every mode or file change, so a late itemTotal result is ignored. */
let modeRun = 0;
/** Changes on every new file, so a late detection result is ignored. */
let runId = 0;
/** The parts of the current result, and the download links shown in the table. */
let currentParts: SplitPart[] = [];
let rowLinks: HTMLAnchorElement[] = [];
/** Indexes of parts downloaded at least once, so the button can say "Download again". */
let downloaded = new Set<number>();

function isImageCount(mode: ModeDefinition): boolean {
    return mode.engine === 'image-h-count' || mode.engine === 'image-v-count';
}

function fmt(bytes: number): string {
    if (bytes < 1000) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = bytes;
    let i = -1;
    do { v /= 1000; i++; } while (v >= 1000 && i < units.length - 1);
    return `${v.toFixed(v < 10 ? 2 : 1)} ${units[i]}`;
}

function setError(msg: string): void {
    els.error.textContent = msg;
    els.error.hidden = msg === '';
}

function clearResult(): void {
    for (const u of urls) URL.revokeObjectURL(u);
    urls = [];
    currentParts = [];
    rowLinks = [];
    downloaded = new Set<number>();
    els.result.hidden = true;
    els.partRows.innerHTML = '';
    els.zipAll.hidden = true;
}

function currentMode(): ModeDefinition | undefined {
    return modes.find((m) => m.id === els.mode.value);
}

function labelFor(mode: ModeDefinition): string {
    switch (mode.input) {
        case 'bytes': return 'Part size';
        case 'seconds': return 'Seconds per clip';
        case 'percent': return 'Share of the first part';
        case 'none': return '';
        default: return countLabels[mode.engine] ?? 'Items per part';
    }
}

function hintFor(mode: ModeDefinition): string {
    switch (mode.input) {
        case 'bytes': return 'Part size, for example 10 MB or 2.5 GB.';
        case 'seconds': return 'Length of each clip in seconds, for example 60. Cuts happen at the nearest keyframe.';
        case 'percent': return 'Please type a number between 1 and 99 (for example 40). Decimals and minus signs are not allowed.';
        case 'none': return 'No input needed. This option always makes 2 parts.';
        default: return 'How many items go into each part, for example 10.';
    }
}

function totalHint(mode: ModeDefinition, n: number): string {
    if (isImageCount(mode)) {
        const side = mode.engine === 'image-h-count' ? 'tall' : 'wide';
        return `This image is ${n} pixels ${side}. Enter ${mode.min ?? 1} to ${n}.`;
    }
    return `This file has ${n} ${countNouns[mode.engine] ?? 'items'} in total. Enter 1 to ${n}.`;
}

/** Quick options. Count modes (not images) get options relative to the file total. */
function presetsFor(mode: ModeDefinition): Preset[] {
    if (mode.input === 'bytes') return BYTE_PRESETS;
    if (mode.input === 'seconds') return TIME_PRESETS;
    if (mode.input === 'count' && total !== null && !isImageCount(mode)) {
        const half = Math.max(1, Math.ceil(total / 2));
        const all: Preset[] = [
            { label: '1', value: '1' },
            { label: 'Half', value: String(half) },
            { label: 'All', value: String(total) },
        ];
        return all.filter((p, i, arr) => arr.findIndex((q) => q.value === p.value) === i);
    }
    return [];
}

function renderPresets(mode: ModeDefinition): void {
    els.presets.innerHTML = '';
    for (const p of presetsFor(mode)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.textContent = p.label;
        b.addEventListener('click', () => {
            els.value.value = p.value;
            if (p.unit) els.unit.value = p.unit;
            checkInput();
        });
        els.presets.appendChild(b);
    }
}

function renderModes(): void {
    els.modeList.innerHTML = '';
    modes.forEach((m, i) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.dataset.id = m.id;
        li.textContent = m.label;
        li.tabIndex = 0;
        li.addEventListener('click', () => pickMode(m.id));
        li.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickMode(m.id); }
        });
        els.modeList.appendChild(li);
        if (i === 0) els.mode.value = m.id;
    });
    els.modeLabel.textContent = modes[0]?.label ?? 'Choose';
    markSelected();
    void onModeChanged();
}

function markSelected(): void {
    for (const li of Array.from(els.modeList.children) as HTMLElement[]) {
        li.setAttribute('aria-selected', String(li.dataset.id === els.mode.value));
    }
}

function setListOpen(open: boolean): void {
    els.modeList.hidden = !open;
    els.modeBtn.setAttribute('aria-expanded', String(open));
}

function pickMode(id: string): void {
    els.mode.value = id;
    els.modeLabel.textContent = modes.find((m) => m.id === id)?.label ?? '';
    markSelected();
    setListOpen(false);
    void onModeChanged();
}

/** Loads the total for a count mode, then redraws the input. Late results are ignored. */
async function onModeChanged(): Promise<void> {
    const run = ++modeRun;
    total = null;
    const mode = currentMode();
    if (mode && file && mode.input === 'count') {
        const f = file;
        let t: number | null = null;
        try {
            t = await itemTotal(mode, f);
        } catch {
            t = null;
        }
        if (run !== modeRun || f !== file) return;
        total = t;
    }
    renderInput();
}

function renderInput(): void {
    const mode = currentMode();
    if (!mode) return;

    els.modeHelp.textContent = mode.help;
    els.unitField.hidden = mode.input !== 'bytes';
    els.valueField.hidden = mode.input === 'none';
    if (mode.input === 'bytes' && mode.defaultUnit) els.unit.value = mode.defaultUnit;
    els.valueLabel.textContent = labelFor(mode);
    els.valueSuffix.hidden = mode.input !== 'percent' && mode.input !== 'seconds';
    els.valueSuffix.textContent = mode.input === 'seconds' ? 'sec' : '%';

    if (mode.input === 'count' && total !== null) {
        els.value.value = String(mode.min ?? 1);
        els.inputHelp.textContent = totalHint(mode, total);
    } else {
        els.value.value = mode.input === 'none' ? '' : mode.defaultValue;
        els.inputHelp.textContent = hintFor(mode);
    }

    renderPresets(mode);
    checkInput();
}

function validate(): { ok: true; value: number } | { ok: false; error: string } {
    const mode = currentMode();
    if (!mode) return { ok: false, error: 'Choose a split mode.' };
    if (mode.input === 'none') return { ok: true, value: 0 };
    const r = parseModeInput(mode, els.value.value, els.unit.value as ByteUnit, total ?? undefined);
    return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error };
}

/** Shows the validation error live while the user types, then updates the estimate. */
function checkInput(): void {
    const v = validate();
    setError(v.ok ? '' : v.error);
    updateEstimate();
}

/** How many parts a valid value creates, or null if it cannot be known yet. */
function partCountFor(mode: ModeDefinition, value: number): number | null {
    if (!file) return null;
    switch (mode.input) {
        case 'bytes': return Math.ceil(file.size / value);
        case 'none':
        case 'percent': return 2;
        case 'count':
            if (isImageCount(mode)) return value;
            return total === null ? null : Math.ceil(total / value);
        default: return null;
    }
}

function updateEstimate(): void {
    const mode = currentMode();
    if (!file || !mode) {
        els.estimate.textContent = '';
        return;
    }
    if (file.size === 0) {
        els.estimate.textContent = 'This file is empty, so there is nothing to split.';
        return;
    }

    const time = describeEstimate(estimateSeconds(mode.engine, file.size));
    let partsText = '';
    const v = validate();
    if (v.ok) {
        const n = partCountFor(mode, v.value);
        if (n !== null) {
            partsText = `This will create ${n} ${n === 1 ? 'part' : 'parts'}. `;
            if (n > WARN_ABOVE_PARTS) partsText += 'That is a lot of files, so consider a larger value. ';
        }
    }
    els.estimate.textContent = `${partsText}Estimated time: ${time} (depends on your device).`;
}

async function loadFile(f: File): Promise<void> {
    const id = ++runId;
    modeRun++;
    file = f;
    detected = null;
    modes = [];
    total = null;
    clearResult();
    setError('');
    els.fname.textContent = f.name;
    els.fsize.textContent = `${fmt(f.size)} (${f.size.toLocaleString('en-US')} bytes)`;
    els.ftype.textContent = 'Detecting...';
    els.fileinfo.hidden = false;
    els.setup.hidden = false;
    els.split.hidden = false;
    els.durationRow.hidden = true;
    els.codecTip.hidden = true;

    let d: DetectedFile;
    try {
        d = await detectFile(f);
    } catch (e) {
        if (id === runId) {
            els.ftype.textContent = 'Unknown (could not be read)';
            setError(e instanceof Error ? e.message : 'The file could not be read.');
        }
        return;
    }
    if (id !== runId) return;

    detected = d;
    modes = modesFor(d);
    els.ftype.textContent = `${d.kind.label} (${d.method === 'signature' ? 'checked from content' : 'from extension'})`;
    renderModes();

    const isVideoOrAudio = d.kind.category === 'video' || d.kind.category === 'audio';
    if (isVideoOrAudio) {
        try {
            const secs = await mediaDuration(f, d.kind.id);
            if (id === runId && secs !== null) {
                els.durationRow.hidden = false;
                els.duration.textContent = `${formatClock(secs)} (${Math.round(secs).toLocaleString('en-US')} sec)`;
            }
        } catch {
            // duration is optional, so a failure here must not block splitting
        }
    }

    if (d.kind.id === 'ogg' && id === runId) {
        try {
            const codec = await oggCodec(f);
            els.codecTip.hidden = codec !== 'vorbis';
            els.codecTip.textContent =
                'This is an Ogg Vorbis file. If there is a delay when jumping to a specific point, try the Opus version of the same audio, which often offers better seeking and quality.';
        } catch {
            els.codecTip.hidden = true;
        }
    }
}

async function doSplit(): Promise<void> {
    if (!file || !detected) return;
    const mode = currentMode();
    const v = validate();
    if (!mode || !v.ok) {
        setError(v.ok ? 'Choose a split mode.' : v.error);
        return;
    }

    const n = partCountFor(mode, v.value);
    if (n !== null && n > CONFIRM_ABOVE_PARTS) {
        const ok = window.confirm(
            `This will create ${n.toLocaleString('en-US')} parts. That can take a long time and fill your disk. Continue?`,
        );
        if (!ok) return;
    }

    const id = runId;
    els.splitBtn.disabled = true;
    els.progress.textContent = `Splitting... ${describeEstimate(estimateSeconds(mode.engine, file.size))} expected.`;
    setError('');

    try {
        const parts = await splitFile(file, detected, mode.id, v.value);
        if (id !== runId) return;
        renderParts(parts);
        els.progress.textContent = '';
    } catch (e) {
        if (id === runId) {
            setError(e instanceof Error ? e.message : 'Split failed.');
            els.progress.textContent = '';
        }
    } finally {
        els.splitBtn.disabled = false;
    }
}

function markDownloaded(i: number): void {
    downloaded.add(i);
    const link = rowLinks[i];
    if (link) {
        link.textContent = 'Download again';
        link.dataset.again = 'true';
    }
}

function renderParts(parts: SplitPart[]): void {
    clearResult();
    currentParts = parts;
    els.result.hidden = false;

    const totalBytes = parts.reduce((s, p) => s + p.blob.size, 0);
    const word = parts.length === 1 ? 'part' : 'parts';
    els.summary.textContent = `${parts.length} ${word}, ${fmt(totalBytes)} in total. Nothing was uploaded.`;
    els.zipAll.hidden = parts.length < 2;

    parts.forEach((p, i) => {
        const url = URL.createObjectURL(p.blob);
        urls.push(url);

        const tr = document.createElement('tr');
        const tdName = document.createElement('td');
        tdName.className = 'name';
        tdName.textContent = p.name;
        const tdSize = document.createElement('td');
        tdSize.textContent = fmt(p.blob.size);
        const tdBtn = document.createElement('td');
        tdBtn.className = 'action';

        const a = document.createElement('a');
        a.href = url;
        a.download = p.name;
        a.className = 'btn btn-small';
        a.textContent = 'Download';
        a.addEventListener('click', () => markDownloaded(i));

        rowLinks.push(a);
        tdBtn.appendChild(a);
        tr.append(tdName, tdSize, tdBtn);
        els.partRows.appendChild(tr);
    });
}

/** Packs all parts into one ZIP. Parts are already compressed (images, PDFs), so ZIP stores them as is. */
async function downloadAllZip(): Promise<void> {
    if (!file || currentParts.length === 0) return;
    els.zipAll.disabled = true;
    els.progress.textContent = 'Building ZIP...';

    try {
        const zip = new JSZip();
        for (const p of currentParts) zip.file(p.name, p.blob);
        const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });

        const base = file.name.replace(/\.[^.]+$/, '');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${base}_parts.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);

        currentParts.forEach((_, i) => markDownloaded(i));
    } catch {
        setError('The ZIP could not be built. Try downloading the parts one by one.');
    } finally {
        els.zipAll.disabled = false;
        els.progress.textContent = '';
    }
}

function reset(): void {
    runId++;
    modeRun++;
    file = null;
    detected = null;
    modes = [];
    total = null;
    clearResult();
    els.modeList.innerHTML = '';
    els.modeLabel.textContent = 'Choose';
    els.presets.innerHTML = '';
    els.estimate.textContent = '';
    els.progress.textContent = '';
    els.fileinfo.hidden = true;
    els.setup.hidden = true;
    els.split.hidden = true;
    setError('');
    els.picker.value = '';
    els.codecTip.hidden = true;
}

// Events
els.browse.addEventListener('click', () => els.picker.click());
els.picker.addEventListener('change', () => {
    const f = els.picker.files?.[0];
    if (f) void loadFile(f);
});
els.dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.dropzone.classList.add('dragging');
});
els.dropzone.addEventListener('dragleave', () => els.dropzone.classList.remove('dragging'));
els.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    els.dropzone.classList.remove('dragging');
    const f = e.dataTransfer?.files[0];
    if (f) void loadFile(f);
});
els.modeBtn.addEventListener('click', () => setListOpen(Boolean(els.modeList.hidden)));
document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('#modeWrap')) setListOpen(false);
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setListOpen(false);
});
els.value.addEventListener('input', checkInput);
els.unit.addEventListener('change', checkInput);
els.splitBtn.addEventListener('click', () => void doSplit());
els.zipAll.addEventListener('click', () => void downloadAllZip());
els.reset.addEventListener('click', reset);