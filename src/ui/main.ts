import {
    detectFile,
    modesFor,
    parseModeInput,
    splitFile,
    estimateSeconds,
    describeEstimate,
    type DetectedFile,
    type ModeDefinition,
    type SplitPart,
} from '../core';
import type { ByteUnit } from '../core/split/byte-split';

// @ts-ignore -- CSS imports are resolved by the bundler.
import '@fontsource/philosopher/400.css';
// @ts-ignore -- CSS imports are resolved by the bundler.
import '@fontsource/philosopher/700.css';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
    dropzone: $<HTMLElement>('dropzone'),
    picker: $<HTMLInputElement>('picker'),
    browse: $<HTMLButtonElement>('browse'),
    fileinfo: $<HTMLElement>('fileinfo'),
    fname: $<HTMLElement>('fname'),
    fsize: $<HTMLElement>('fsize'),
    ftype: $<HTMLElement>('ftype'),
    setup: $<HTMLElement>('setup'),
    mode: $<HTMLSelectElement>('mode'),
    modeHelp: $<HTMLElement>('modeHelp'),
    value: $<HTMLInputElement>('value'),
    valueLabel: $<HTMLElement>('valueLabel'),
    unit: $<HTMLSelectElement>('unit'),
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
};

let file: File | null = null;
let detected: DetectedFile | null = null;
let modes: ModeDefinition[] = [];
let runId = 0;
let urls: string[] = [];

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
    els.result.hidden = true;
    els.partRows.innerHTML = '';
}

const presetsByMode: Record<string, { label: string; value: string; unit?: ByteUnit }[]> = {
    bytes: [
        { label: '1 MB', value: '1', unit: 'MB' },
        { label: '10 MB', value: '10', unit: 'MB' },
        { label: '100 MB', value: '100', unit: 'MB' },
        { label: '1 GB', value: '1', unit: 'GB' },
    ],
    'media-time': [
        { label: '30 sec', value: '30' },
        { label: '1 min', value: '60' },
        { label: '5 min', value: '300' },
        { label: '10 min', value: '600' },
    ],
};

function renderPresets(mode: ModeDefinition): void {
    els.presets.innerHTML = '';
    const list = presetsByMode[mode.id] ?? [];
    for (const p of list) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.textContent = p.label;
        b.addEventListener('click', () => {
            els.value.value = p.value;
            if (p.unit) els.unit.value = p.unit;
            setError('');
            updateEstimate();
        });
        els.presets.appendChild(b);
    }
}

function currentMode(): ModeDefinition | undefined {
    return modes.find((m) => m.id === els.mode.value);
}

function renderModes(): void {
    els.mode.innerHTML = '';
    for (const m of modes) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.label;
        els.mode.appendChild(opt);
    }
    renderInput();
}

function renderInput(): void {
    const mode = currentMode();
    if (!mode) return;
    els.modeHelp.textContent = mode.help;
    els.value.value = mode.defaultValue;
    els.unit.hidden = mode.input !== 'bytes';
    if (mode.input === 'bytes' && mode.defaultUnit) els.unit.value = mode.defaultUnit;

    const labels = { bytes: 'Part size', count: 'Items per part', seconds: 'Seconds per clip' } as const;
    const hints = {
        bytes: 'Part size, for example 10 MB or 2.5 GB.',
        count: 'How many items go into each part, for example 10.',
        seconds: 'Length of each clip in seconds, for example 60. Cuts happen at the nearest keyframe.',
    } as const;
    els.valueLabel.textContent = labels[mode.input];
    els.inputHelp.textContent = hints[mode.input];
    renderPresets(mode);
    setError('');
    updateEstimate();
}

function updateEstimate(): void {
    const mode = currentMode();
    if (!file || !mode) {
        els.estimate.textContent = '';
        return;
    }
    const seconds = estimateSeconds(mode.engine, file.size);
    els.estimate.textContent = `Estimated time: ${describeEstimate(seconds)} (depends on your device).`;
}

function validate(): { ok: true; value: number } | { ok: false; error: string } {
    const mode = currentMode();
    if (!mode) return { ok: false, error: 'Choose a split mode.' };
    const r = parseModeInput(mode, els.value.value, els.unit.value as ByteUnit);
    return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error };
}

async function loadFile(f: File): Promise<void> {
    const id = ++runId;
    file = f;
    clearResult();
    setError('');
    els.fname.textContent = f.name;
    els.fsize.textContent = `${fmt(f.size)} (${f.size.toLocaleString('en-US')} bytes)`;
    els.ftype.textContent = 'Detecting...';
    els.fileinfo.hidden = false;
    els.setup.hidden = false;
    els.split.hidden = false;

    const d = await detectFile(f);
    if (id !== runId) return;

    detected = d;
    modes = modesFor(d);
    els.ftype.textContent = `${d.kind.label} (${d.method === 'signature' ? 'checked from content' : 'from extension'})`;
    renderModes();
}

async function doSplit(): Promise<void> {
    if (!file || !detected) return;
    const mode = currentMode();
    const v = validate();
    if (!mode || !v.ok) {
        setError(v.ok ? 'Choose a split mode.' : v.error);
        return;
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

function renderParts(parts: SplitPart[]): void {
    clearResult();
    els.result.hidden = false;
    const total = parts.reduce((s, p) => s + p.blob.size, 0);
    els.summary.textContent = `${parts.length} parts, ${fmt(total)} in total. Nothing was uploaded.`;

    for (const p of parts) {
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
        tdBtn.appendChild(a);
        tr.append(tdName, tdSize, tdBtn);
        els.partRows.appendChild(tr);
    }
}

function reset(): void {
    runId++;
    file = null;
    detected = null;
    modes = [];
    clearResult();
    els.fileinfo.hidden = true;
    els.setup.hidden = true;
    els.split.hidden = true;
    setError('');
    els.picker.value = '';
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
els.mode.addEventListener('change', renderInput);
els.value.addEventListener('input', () => {
    setError('');
    updateEstimate();
});
els.unit.addEventListener('change', () => setError(''));
els.splitBtn.addEventListener('click', () => void doSplit());
els.reset.addEventListener('click', reset);