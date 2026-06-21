// Inline SVG weather icons in the spirit of yr.no — colorful, simple, and
// recognizable at small sizes. We compose each glyph from a handful of
// primitives (Sun, Moon, Cloud, Drops, Flakes, Bolt, Fog) and pick the
// composition from the MET Norway symbol_code in WeatherSymbol().

const SUN_FILL = '#f6c026';
const SUN_STROKE = '#e0a116';
const MOON_FILL = '#f7eec0';
const MOON_STROKE = '#bba84a';
const CLOUD_FILL = '#dfe4ea';
const CLOUD_STROKE = '#a3afbb';
const CLOUD_DARK_FILL = '#aab4be';
const CLOUD_DARK_STROKE = '#6f7a85';
const DROP_FILL = '#3ea0e2';
const FLAKE_STROKE = '#7fb4e6';
const BOLT_FILL = '#f6b21a';
const BOLT_STROKE = '#c98a08';
const FOG_STROKE = '#9aa6b3';

function Sun({ x = 4, y = 3, r = 3 }: { x?: number; y?: number; r?: number }) {
  const rays = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <g transform={`translate(${x},${y})`}>
      {rays.map((a) => {
        const rad = (a * Math.PI) / 180;
        const x1 = 5 + Math.cos(rad) * (r + 1.2);
        const y1 = 5 + Math.sin(rad) * (r + 1.2);
        const x2 = 5 + Math.cos(rad) * (r + 2.5);
        const y2 = 5 + Math.sin(rad) * (r + 2.5);
        return (
          <line
            key={a}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={SUN_STROKE}
            strokeWidth="1.1"
            strokeLinecap="round"
          />
        );
      })}
      <circle
        cx="5"
        cy="5"
        r={r}
        fill={SUN_FILL}
        stroke={SUN_STROKE}
        strokeWidth="0.8"
      />
    </g>
  );
}

function Moon({ x = 4, y = 3 }: { x?: number; y?: number }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <path
        d="M8.6 6.5 A4.2 4.2 0 1 1 3.5 1.4 A3.2 3.2 0 0 0 8.6 6.5 z"
        fill={MOON_FILL}
        stroke={MOON_STROKE}
        strokeWidth="0.8"
        strokeLinejoin="round"
      />
    </g>
  );
}

// A puffy cloud. The path lives in a 16×10 box at (x,y).
function Cloud({
  dark = false,
  x = 2,
  y = 8,
  scale = 1,
}: {
  dark?: boolean;
  x?: number;
  y?: number;
  scale?: number;
}) {
  const fill = dark ? CLOUD_DARK_FILL : CLOUD_FILL;
  const stroke = dark ? CLOUD_DARK_STROKE : CLOUD_STROKE;
  return (
    <g transform={`translate(${x},${y}) scale(${scale})`}>
      <path
        d="M4.5 9.5 C1.6 9.5 0.4 7.2 2 5.6 C1.8 3 4.4 1.2 6.6 2.2 C7.6 0.8 10 0.8 11 2.4 C13.2 2.2 14.6 4 13.8 5.8 C16 6.2 16 9.5 13.5 9.5 Z"
        fill={fill}
        stroke={stroke}
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
    </g>
  );
}

function Drop({ x, y }: { x: number; y: number }) {
  // Simple teardrop, point up.
  return (
    <path
      d={`M ${x} ${y} q -1.1 1.5 0 2.6 q 1.1 -1.1 0 -2.6 z`}
      fill={DROP_FILL}
    />
  );
}

function Drops({ count = 3 }: { count?: number }) {
  const xs = count === 1 ? [12] : count === 2 ? [9, 15] : [7, 12, 17];
  return (
    <g>
      {xs.map((x, i) => (
        <Drop key={i} x={x} y={19} />
      ))}
    </g>
  );
}

function Flake({ x, y, size = 2.2 }: { x: number; y: number; size?: number }) {
  return (
    <g
      transform={`translate(${x},${y})`}
      stroke={FLAKE_STROKE}
      strokeWidth="0.8"
      strokeLinecap="round"
    >
      <line x1={-size} y1="0" x2={size} y2="0" />
      <line x1="0" y1={-size} x2="0" y2={size} />
      <line x1={-size * 0.7} y1={-size * 0.7} x2={size * 0.7} y2={size * 0.7} />
      <line x1={-size * 0.7} y1={size * 0.7} x2={size * 0.7} y2={-size * 0.7} />
    </g>
  );
}

function Flakes({ count = 3 }: { count?: number }) {
  const xs = count === 1 ? [12] : count === 2 ? [9, 15] : [7, 12, 17];
  return (
    <g>
      {xs.map((x, i) => (
        <Flake key={i} x={x} y={20} />
      ))}
    </g>
  );
}

function Bolt() {
  return (
    <path
      d="M11.5 16 L14.5 16 L12.5 20 L16 20 L10 24 L11.5 19.5 L9 19.5 Z"
      fill={BOLT_FILL}
      stroke={BOLT_STROKE}
      strokeWidth="0.5"
      strokeLinejoin="round"
    />
  );
}

function Fog() {
  return (
    <g stroke={FOG_STROKE} strokeWidth="1.1" strokeLinecap="round">
      <line x1="3" y1="19" x2="21" y2="19" />
      <line x1="5" y1="22" x2="19" y2="22" />
    </g>
  );
}

interface IconProps {
  size?: number;
  title?: string;
}

function Svg({
  size = 28,
  title,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden={!title}>
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

// --- Composed icons -----------------------------------------------------

const ClearSky = (p: IconProps) => (
  <Svg {...p}>
    <Sun x={7} y={6} r={4} />
  </Svg>
);

const ClearNight = (p: IconProps) => (
  <Svg {...p}>
    <Moon x={7} y={5} />
  </Svg>
);

const Fair = (p: IconProps) => (
  <Svg {...p}>
    <Sun x={2} y={1} r={3} />
    <Cloud x={6} y={9} scale={0.85} />
  </Svg>
);

const FairNight = (p: IconProps) => (
  <Svg {...p}>
    <Moon x={2} y={1} />
    <Cloud x={6} y={9} scale={0.85} />
  </Svg>
);

const PartlyCloudy = (p: IconProps) => (
  <Svg {...p}>
    <Sun x={0} y={-1} r={3} />
    <Cloud x={3} y={8} />
  </Svg>
);

const PartlyCloudyNight = (p: IconProps) => (
  <Svg {...p}>
    <Moon x={0} y={-1} />
    <Cloud x={3} y={8} />
  </Svg>
);

const Cloudy = (p: IconProps) => (
  <Svg {...p}>
    <Cloud x={3} y={6} dark />
  </Svg>
);

const Foggy = (p: IconProps) => (
  <Svg {...p}>
    <Cloud x={3} y={4} />
    <Fog />
  </Svg>
);

const Rain = ({ intensity = 'normal', ...p }: IconProps & { intensity?: 'light' | 'normal' | 'heavy' }) => (
  <Svg {...p}>
    <Cloud x={3} y={5} dark />
    <Drops count={intensity === 'light' ? 1 : intensity === 'heavy' ? 3 : 2} />
  </Svg>
);

const RainShowers = ({ night = false, intensity = 'normal', ...p }: IconProps & { night?: boolean; intensity?: 'light' | 'normal' | 'heavy' }) => (
  <Svg {...p}>
    {night ? <Moon x={0} y={-1} /> : <Sun x={0} y={-1} r={3} />}
    <Cloud x={3} y={8} dark />
    <Drops count={intensity === 'light' ? 1 : intensity === 'heavy' ? 3 : 2} />
  </Svg>
);

const Snow = ({ intensity = 'normal', ...p }: IconProps & { intensity?: 'light' | 'normal' | 'heavy' }) => (
  <Svg {...p}>
    <Cloud x={3} y={5} />
    <Flakes count={intensity === 'light' ? 1 : intensity === 'heavy' ? 3 : 2} />
  </Svg>
);

const SnowShowers = ({ night = false, intensity = 'normal', ...p }: IconProps & { night?: boolean; intensity?: 'light' | 'normal' | 'heavy' }) => (
  <Svg {...p}>
    {night ? <Moon x={0} y={-1} /> : <Sun x={0} y={-1} r={3} />}
    <Cloud x={3} y={8} />
    <Flakes count={intensity === 'light' ? 1 : intensity === 'heavy' ? 3 : 2} />
  </Svg>
);

const Sleet = (p: IconProps) => (
  <Svg {...p}>
    <Cloud x={3} y={5} dark />
    <Drop x={9} y={19} />
    <Flake x={15} y={20} />
  </Svg>
);

const SleetShowers = ({ night = false, ...p }: IconProps & { night?: boolean }) => (
  <Svg {...p}>
    {night ? <Moon x={0} y={-1} /> : <Sun x={0} y={-1} r={3} />}
    <Cloud x={3} y={8} dark />
    <Drop x={9} y={19} />
    <Flake x={15} y={20} />
  </Svg>
);

const Thunder = (p: IconProps) => (
  <Svg {...p}>
    <Cloud x={3} y={4} dark />
    <Bolt />
  </Svg>
);

// --- Symbol-code dispatcher --------------------------------------------

interface SymbolProps extends IconProps {
  code: string | null;
}

const Unknown = (p: IconProps) => (
  <Svg {...p}>
    <Cloud x={3} y={6} />
  </Svg>
);

// Parse a MET Norway symbol_code like "lightrainshowers_day" into a coarse
// bucket. The codes follow a stable naming convention: optional intensity
// prefix ("light"/"heavy"), a precipitation type ("rain"/"sleet"/"snow") with
// optional "showers", optional "andthunder", and an optional "_day"/"_night"
// /"_polartwilight" suffix.
export function WeatherSymbol({ code, size = 28, title }: SymbolProps) {
  const props: IconProps = { size, title: title ?? code ?? undefined };
  if (!code) return <Unknown {...props} />;
  const lower = code.toLowerCase();
  const night = lower.endsWith('_night');
  const intensity: 'light' | 'normal' | 'heavy' = lower.startsWith('light')
    ? 'light'
    : lower.startsWith('heavy')
      ? 'heavy'
      : 'normal';
  const hasThunder = lower.includes('thunder');
  const hasShowers = lower.includes('showers');

  if (hasThunder) return <Thunder {...props} />;
  if (lower.includes('snow')) {
    return hasShowers
      ? <SnowShowers {...props} night={night} intensity={intensity} />
      : <Snow {...props} intensity={intensity} />;
  }
  if (lower.includes('sleet')) {
    return hasShowers
      ? <SleetShowers {...props} night={night} />
      : <Sleet {...props} />;
  }
  if (lower.includes('rain')) {
    return hasShowers
      ? <RainShowers {...props} night={night} intensity={intensity} />
      : <Rain {...props} intensity={intensity} />;
  }
  if (lower.includes('fog')) return <Foggy {...props} />;
  if (lower.startsWith('cloudy')) return <Cloudy {...props} />;
  if (lower.startsWith('partlycloudy')) {
    return night ? <PartlyCloudyNight {...props} /> : <PartlyCloudy {...props} />;
  }
  if (lower.startsWith('fair')) {
    return night ? <FairNight {...props} /> : <Fair {...props} />;
  }
  if (lower.startsWith('clearsky')) {
    return night ? <ClearNight {...props} /> : <ClearSky {...props} />;
  }
  return <Unknown {...props} />;
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
