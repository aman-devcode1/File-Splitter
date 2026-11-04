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

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  drop: $<HTMLElement>('drop'),
  picker: $<HTMLInputElement>('picker'),
  details: $<HTMLElement>('details'),
  fname: $<HTMLElement>('fname'),
  fsize: $<HTMLElement>('fsize'),
  ftype: $<HTMLElement>('ftype'),
  mode: $<HTMLSelectElement>('mode'),
  modeHelp: $<HTMLElement>('modeHelp'),
  value: $<HTMLInputElement>('value'),
  unit: $<HTMLSelectElement>('unit'),
  inputHelp: $<HTMLElement>('inputHelp'),
  estimate: $<HTMLElement>('estimate'),
  error: $<HTMLElement>('error'),
  split: $<HTMLButtonElement>('split'),
  reset: $<HTMLButtonElement>('reset'),
  result: $<HTMLElement>('result'),
  summary: $<HTMLElement>('summary'),
  parts: $<HTMLElement>('parts'),
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
}

function clearResult(): void {
  for (const u of urls) URL.revokeObjectURL(u);
  urls = [];
  els.result.hidden = true;
  els.parts.innerHTML = '';
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

function currentMode(): ModeDefinition | undefined {
  return modes.find((m) => m.id === els.mode.value);
}

function renderInput(): void {
  const mode = currentMode();
  if (!mode) return;

  els.modeHelp.textContent = mode.help;
  els.value.value = mode.defaultValue;
  els.unit.hidden = mode.input !== 'bytes';
  if (mode.input === 'bytes' && mode.defaultUnit) els.unit.value = mode.defaultUnit;

  const hints = {
    bytes: 'Part size (for example 10 MB or 2.5 GB).',
    count: 'How many items go into each part (for example 10).',
    seconds: 'Length of each clip in seconds (for example 60).',
  } as const;
  els.inputHelp.textContent = hints[mode.input];
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
  els.details.hidden = false;

  const d = await detectFile(f);
  if (id !== runId) return; // a newer file was dropped meanwhile

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
    setError(v.ok ? '' : v.error);
    return;
  }

  const id = runId;
  els.split.disabled = true;
  setError('');
  els.estimate.textContent = `Splitting... ${describeEstimate(estimateSeconds(mode.engine, file.size))} expected.`;

  try {
    const parts = await splitFile(file, detected, mode.id, v.value);
    if (id !== runId) return;
    renderParts(parts);
  } catch (e) {
    if (id === runId) setError(e instanceof Error ? e.message : 'Split failed.');
  } finally {
    els.split.disabled = false;
    updateEstimate();
  }
}

function renderParts(parts: SplitPart[]): void {
  clearResult();
  els.result.hidden = false;
  const total = parts.reduce((s, p) => s + p.blob.size, 0);
  els.summary.textContent = `${parts.length} parts, ${fmt(total)} in total.`;

  for (const p of parts) {
    const url = URL.createObjectURL(p.blob);
    urls.push(url);
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = `${p.name} (${fmt(p.blob.size)})`;
    const a = document.createElement('a');
    a.href = url;
    a.download = p.name;
    a.className = 'btn small';
    a.textContent = 'Download';
    li.append(name, a);
    els.parts.appendChild(li);
  }
}

function reset(): void {
  runId++;
  file = null;
  detected = null;
  modes = [];
  clearResult();
  els.details.hidden = true;
  setError('');
  els.picker.value = '';
}

// Events
els.picker.addEventListener('change', () => {
  const f = els.picker.files?.[0];
  if (f) void loadFile(f);
});

els.drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  els.drop.classList.add('dragging');
});
els.drop.addEventListener('dragleave', () => els.drop.classList.remove('dragging'));
els.drop.addEventListener('drop', (e) => {
  e.preventDefault();
  els.drop.classList.remove('dragging');
  const f = e.dataTransfer?.files[0];
  if (f) void loadFile(f);
});

els.mode.addEventListener('change', renderInput);
els.value.addEventListener('input', () => setError(''));
els.split.addEventListener('click', () => void doSplit());
els.reset.addEventListener('click', reset);