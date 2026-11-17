/** Installable-app support: service worker registration, install prompt and file-launch handling. */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: window-controls-overlay)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
export const canInstall = (): boolean => deferred !== null && !isStandalone();
export function onInstallStateChange(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  const evt = deferred;
  deferred = null; emit();
  await evt.prompt();
  return (await evt.userChoice).outcome;
}

export function initPwa(): void {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BeforeInstallPromptEvent; emit(); });
  window.addEventListener('appinstalled', () => { deferred = null; emit(); });
  // Only register in production builds: a dev-server service worker would serve stale modules.
  if ((import.meta as ImportMeta & { env?: { PROD?: boolean } }).env?.PROD && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => undefined); });
  }
}

type LaunchParams = { files: Array<{ getFile: () => Promise<File> }> };
/** When the installed app is opened by double-clicking a .f4proj, the OS hands the file over here. */
export function handleLaunchFiles(open: (file: File) => Promise<unknown>): void {
  const lq = (window as unknown as { launchQueue?: { setConsumer: (fn: (p: LaunchParams) => void) => void } }).launchQueue;
  lq?.setConsumer((params) => { for (const handle of params.files ?? []) void handle.getFile().then(open).catch(() => undefined); });
}
