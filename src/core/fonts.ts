// A broad, dependency-free font catalog. These are CSS font-family names, so
// they work immediately when the font is installed and gracefully fall back
// otherwise. Users can add an unlimited number of real TTF/OTF/WOFF files in
// the inspector; those are registered with the browser through FontFace.
export const FONT_CATALOG = [
  'Inter', 'Arial', 'Arial Black', 'Arial Narrow', 'Aptos', 'Calibri', 'Cambria', 'Candara', 'Century Gothic', 'Comic Sans MS', 'Consolas', 'Courier New', 'Franklin Gothic Medium', 'Georgia', 'Impact', 'Lucida Console', 'Lucida Sans Unicode', 'Palatino Linotype', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana',
  'Roboto', 'Roboto Condensed', 'Roboto Mono', 'Open Sans', 'Open Sans Condensed', 'Lato', 'Montserrat', 'Poppins', 'Raleway', 'Nunito', 'Nunito Sans', 'Oswald', 'Barlow', 'Barlow Condensed', 'Merriweather', 'Playfair Display', 'Libre Baskerville', 'Source Sans 3', 'Source Serif 4', 'Ubuntu', 'Ubuntu Mono', 'Noto Sans', 'Noto Serif', 'Noto Sans Display', 'Noto Sans Mono', 'Fira Sans', 'Fira Code', 'Inconsolata', 'Work Sans', 'DM Sans', 'DM Mono', 'Manrope', 'Plus Jakarta Sans', 'Outfit', 'Sora', 'Space Grotesk', 'Space Mono', 'Lexend', 'Quicksand', 'Mulish', 'Karla', 'Rubik', 'Barlow Semi Condensed', 'Titillium Web', 'Josefin Sans', 'Comfortaa', 'Cabin', 'Heebo', 'Hind', 'Kanit', 'Prompt', 'Rajdhani', 'Chakra Petch', 'Exo 2', 'Orbitron', 'Audiowide', 'Russo One', 'Bebas Neue', 'Anton', 'Archivo', 'Archivo Black', 'League Spartan', 'Barlow Black', 'Black Han Sans', 'Bungee', 'Righteous', 'Fjalla One', 'Alfa Slab One', 'Abril Fatface', 'Lobster', 'Pacifico', 'Permanent Marker', 'Caveat', 'Dancing Script', 'Great Vibes', 'Sacramento', 'Satisfy', 'Kaushan Script', 'Lora', 'Cormorant Garamond', 'Crimson Text', 'EB Garamond', 'Bitter', 'Zilla Slab', 'Slabo 27px', 'Arvo', 'Roboto Slab', 'Courier Prime', 'Cutive Mono', 'Source Code Pro', 'JetBrains Mono', 'IBM Plex Mono', 'IBM Plex Sans', 'IBM Plex Serif', 'PT Sans', 'PT Serif', 'M PLUS Rounded 1c', 'Yeseva One', 'Unbounded', 'Montserrat Alternates', 'Bodoni Moda', 'DM Serif Display', 'Fraunces', 'Playwrite GB S', 'Atkinson Hyperlegible', 'Alegreya', 'Alegreya Sans', 'Archivo Narrow', 'Asap', 'Assistant', 'Bai Jamjuree', 'Be Vietnam Pro', 'Catamaran', 'Chivo', 'Cousine', 'Encode Sans', 'Epilogue', 'Gabarito', 'Hanken Grotesk', 'IBM Plex Sans Condensed', 'Instrument Sans', 'Jost', 'Kufam', 'Marcellus', 'Maven Pro', 'Mitr', 'Overpass', 'Public Sans', 'Questrial', 'Red Hat Display', 'Sarabun', 'Signika', 'Sora', 'Spectral', 'Syne', 'Urbanist', 'Varela Round', 'Wix Madefor Display', 'Yanone Kaffeesatz',
] as const;

// Keep imported font bytes for the lifetime of the editor session. The
// browser preview already has the loaded FontFace; retaining the bytes lets
// the FFmpeg exporter use that same imported face instead of silently falling
// back to the bundled font.
const loadedFontFiles = new Map<string, Uint8Array>();

export function cssFontFamily(name: string): string {
  const generic = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy'].includes(name) ? name : 'sans-serif';
  return name.includes(' ') ? `'${name}', ${generic}` : `${name}, ${generic}`;
}

export async function loadFontFile(file: File): Promise<string> {
  const family = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Imported font';
  const bytes = new Uint8Array(await file.arrayBuffer());
  const face = new FontFace(family, bytes.buffer);
  await face.load();
  document.fonts.add(face);
  loadedFontFiles.set(family, bytes);
  return family;
}

export function getLoadedFontFile(fontFamily: string): Uint8Array | undefined {
  const family = fontFamily.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '');
  const bytes = family ? loadedFontFiles.get(family) : undefined;
  return bytes ? new Uint8Array(bytes) : undefined;
}
