// Weather icons from MET Norway's official `metno/weathericons` set
// (MIT-licensed, the same artwork used on yr.no). The SVG filenames match
// the MET Norway `symbol_code` field 1:1, and the full set is shipped under
// /public/weather-icons/, so rendering is just a path lookup.

interface IconProps {
  size?: number;
  title?: string;
}

interface SymbolProps extends IconProps {
  code: string | null;
}

export function WeatherSymbol({ code, size = 28, title }: SymbolProps) {
  if (!code) {
    return (
      <span
        aria-hidden
        style={{ display: 'inline-block', width: size, height: size }}
      />
    );
  }
  return (
    <img
      src={`/weather-icons/${code}.svg`}
      width={size}
      height={size}
      alt={title ?? code}
      draggable={false}
      style={{ display: 'block' }}
    />
  );
}

// A small arrow used to indicate wind direction. The default points right
// (east); rotate via CSS transform to map MET Norway's wind_from_direction
// onto where the wind is blowing TO.
export function WindArrowIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M3 12 H17 M13 7 L18 12 L13 17"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
