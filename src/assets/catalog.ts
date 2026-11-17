const bundledFiles = import.meta.glob('../../assets/**/*.{mp3,jpeg,jpg,png,webp,wav,mp4}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export interface BundledAsset {
  id: string;
  name: string;
  url: string;
  kind: 'audio' | 'image' | 'video';
  mimeType: string;
}

function kindFor(name: string): BundledAsset['kind'] {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'mp3' || ext === 'wav') return 'audio';
  if (ext === 'mp4') return 'video';
  return 'image';
}

function mimeFor(kind: BundledAsset['kind'], name: string): string {
  const ext = name.toLowerCase().split('.').pop();
  if (kind === 'audio') return ext === 'wav' ? 'audio/wav' : 'audio/mpeg';
  if (kind === 'video') return 'video/mp4';
  return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
}

export const BUNDLED_ASSETS: BundledAsset[] = Object.entries(bundledFiles)
  .map(([path, url]) => {
    const name = path.split('/').pop() ?? path;
    const kind = kindFor(name);
    return { id: `bundled-${path}`, name, url, kind, mimeType: mimeFor(kind, name) };
  })
  .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
