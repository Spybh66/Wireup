// §5.1 Component icons — 40×40, stroke-only silver line art, block-diagram style.
// Each is a React component accepting { size } (default 24). Registered in ICONS.

const S = '#e5e5e5';
const base = (size) => ({
  width: size,
  height: size,
  viewBox: '0 0 40 40',
  fill: 'none',
  stroke: S,
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  xmlns: 'http://www.w3.org/2000/svg',
});

export function ControllerIcon({ size = 24 }) {
  return (
    <svg {...base(size)}>
      <rect x="7" y="9" width="26" height="22" rx="2" />
      <line x1="7" y1="15" x2="33" y2="15" />
      <rect x="11" y="20" width="6" height="6" />
      <line x1="23" y1="21" x2="29" y2="21" />
      <line x1="23" y1="25" x2="29" y2="25" />
    </svg>
  );
}

export function PiIcon({ size = 24 }) {
  return (
    <svg {...base(size)}>
      <rect x="8" y="10" width="24" height="20" rx="2" />
      <rect x="13" y="15" width="8" height="8" />
      <line x1="25" y1="15" x2="28" y2="15" />
      <line x1="25" y1="19" x2="28" y2="19" />
      <line x1="25" y1="23" x2="28" y2="23" />
    </svg>
  );
}

export function BatteryIcon({ size = 24 }) {
  return (
    <svg {...base(size)}>
      <rect x="8" y="13" width="22" height="14" rx="1" />
      <line x1="30" y1="17" x2="33" y2="17" />
      <line x1="30" y1="23" x2="33" y2="23" />
      <line x1="14" y1="17" x2="14" y2="23" />
      <line x1="11" y1="20" x2="17" y2="20" />
      <line x1="24" y1="20" x2="27" y2="20" />
    </svg>
  );
}

export function BreakerIcon({ size = 24 }) {
  return (
    <svg {...base(size)}>
      <circle cx="11" cy="20" r="2" />
      <circle cx="29" cy="20" r="2" />
      <line x1="13" y1="20" x2="27" y2="13" />
      <line x1="20" y1="28" x2="20" y2="33" />
    </svg>
  );
}

export function PowerDistIcon({ size = 24 }) {
  return (
    <svg {...base(size)}>
      <rect x="7" y="8" width="26" height="24" rx="2" />
      <line x1="7" y1="14" x2="33" y2="14" />
      <line x1="13" y1="18" x2="13" y2="30" />
      <line x1="20" y1="18" x2="20" y2="30" />
      <line x1="27" y1="18" x2="27" y2="30" />
    </svg>
  );
}

export function VrmIcon({ size = 24 }) {
  return (
    <svg {...base(size)}>
      <rect x="8" y="11" width="24" height="18" rx="2" />
      <path d="M13 20 h4 l2 -4 l2 8 l2 -4 h4" />
    </svg>
  );
}

export function RadioPowerIcon({ size = 24 }) {
  return (
    <svg {...base(size)}>
      <rect x="8" y="14" width="20" height="14" rx="2" />
      <line x1="28" y1="18" x2="32" y2="18" />
      <line x1="28" y1="24" x2="32" y2="24" />
      <path d="M14 14 q4 -6 8 0" />
    </svg>
  );
}

export function MotorControllerIcon({ size = 24 }) {
  return (
    <svg {...base(size)}>
      <rect x="9" y="9" width="22" height="22" rx="2" />
      <path d="M15 25 v-10 l5 6 l5 -6 v10" />
    </svg>
  );
}

export function MotorIcon({ size = 24 }) {
  return (
    <svg {...base(size)}>
      <circle cx="20" cy="20" r="11" />
      <path d="M15 24 v-8 l5 6 l5 -6 v8" />
    </svg>
  );
}

export function KrakenMotorIcon({ size = 24 }) {
  return (
    <svg {...base(size)}>
      <circle cx="20" cy="20" r="11" />
      <circle cx="20" cy="20" r="4" />
      <line x1="20" y1="9" x2="20" y2="13" />
      <line x1="20" y1="27" x2="20" y2="31" />
      <line x1="9" y1="20" x2="13" y2="20" />
      <line x1="27" y1="20" x2="31" y2="20" />
    </svg>
  );
}

export function CanSensorIcon({ size = 24 }) {
  return (
    <svg {...base(size)}>
      <circle cx="20" cy="20" r="10" />
      <circle cx="20" cy="20" r="4" />
      <line x1="20" y1="10" x2="20" y2="6" />
    </svg>
  );
}

export function CameraIcon({ size = 24 }) {
  return (
    <svg {...base(size)}>
      <rect x="8" y="12" width="24" height="16" rx="2" />
      <circle cx="20" cy="20" r="5" />
      <circle cx="20" cy="20" r="2" />
    </svg>
  );
}

export function SensorIcon({ size = 24 }) {
  return (
    <svg {...base(size)}>
      <rect x="10" y="12" width="20" height="16" rx="2" />
      <path d="M14 24 q6 -10 12 0" />
    </svg>
  );
}

export function RadioIcon({ size = 24 }) {
  return (
    <svg {...base(size)}>
      <rect x="10" y="18" width="20" height="12" rx="2" />
      <line x1="20" y1="18" x2="20" y2="10" />
      <path d="M14 10 q6 -6 12 0" />
      <path d="M16 12 q4 -3 8 0" />
    </svg>
  );
}

export function SwitchIcon({ size = 24 }) {
  return (
    <svg {...base(size)}>
      <rect x="7" y="13" width="26" height="14" rx="2" />
      <line x1="12" y1="13" x2="12" y2="9" />
      <line x1="17" y1="13" x2="17" y2="9" />
      <line x1="22" y1="13" x2="22" y2="9" />
      <line x1="27" y1="13" x2="27" y2="9" />
    </svg>
  );
}

export function PneumaticHubIcon({ size = 24 }) {
  return (
    <svg {...base(size)}>
      <rect x="8" y="10" width="24" height="20" rx="2" />
      <circle cx="20" cy="20" r="5" />
      <line x1="20" y1="10" x2="20" y2="15" />
    </svg>
  );
}

export function CompressorIcon({ size = 24 }) {
  return (
    <svg {...base(size)}>
      <circle cx="18" cy="20" r="9" />
      <path d="M18 20 L24 14" />
      <rect x="27" y="17" width="5" height="6" rx="1" />
    </svg>
  );
}

export function SolenoidIcon({ size = 24 }) {
  return (
    <svg {...base(size)}>
      <rect x="10" y="14" width="20" height="12" rx="2" />
      <path d="M13 20 q2 -4 4 0 q2 -4 4 0 q2 -4 4 0" />
    </svg>
  );
}

export function RslIcon({ size = 24 }) {
  return (
    <svg {...base(size)}>
      <circle cx="20" cy="18" r="7" />
      <path d="M14 18 a6 6 0 0 1 12 0" />
      <line x1="16" y1="25" x2="24" y2="25" />
      <line x1="17" y1="29" x2="23" y2="29" />
    </svg>
  );
}

export function ServoIcon({ size = 24 }) {
  return (
    <svg {...base(size)}>
      <rect x="11" y="14" width="14" height="14" rx="1" />
      <line x1="25" y1="18" x2="31" y2="18" />
      <circle cx="18" cy="14" r="2" />
    </svg>
  );
}

export function CanJunctionIcon({ size = 24 }) {
  return (
    <svg {...base(size)}>
      <rect x="9" y="12" width="22" height="16" rx="2" />
      <line x1="20" y1="12" x2="20" y2="28" />
      <line x1="9" y1="16" x2="6" y2="16" />
      <line x1="9" y1="24" x2="6" y2="24" />
      <line x1="31" y1="15" x2="34" y2="15" />
      <line x1="31" y1="20" x2="34" y2="20" />
      <line x1="31" y1="25" x2="34" y2="25" />
    </svg>
  );
}

export function LedStripIcon({ size = 24 }) {
  return (
    <svg {...base(size)}>
      <rect x="6" y="16" width="28" height="8" rx="1" />
      <circle cx="11" cy="20" r="1.4" />
      <circle cx="16" cy="20" r="1.4" />
      <circle cx="20" cy="20" r="1.4" />
      <circle cx="24" cy="20" r="1.4" />
      <circle cx="29" cy="20" r="1.4" />
    </svg>
  );
}

export function GenericIcon({ size = 24 }) {
  return (
    <svg {...base(size)}>
      <rect x="9" y="11" width="22" height="18" rx="2" />
      <line x1="9" y1="16" x2="6" y2="16" />
      <line x1="9" y1="24" x2="6" y2="24" />
      <line x1="31" y1="16" x2="34" y2="16" />
      <line x1="31" y1="24" x2="34" y2="24" />
    </svg>
  );
}

export const ICONS = {
  controller: ControllerIcon,
  pi: PiIcon,
  battery: BatteryIcon,
  breaker: BreakerIcon,
  powerdist: PowerDistIcon,
  vrm: VrmIcon,
  radioPower: RadioPowerIcon,
  motorController: MotorControllerIcon,
  motor: MotorIcon,
  krakenMotor: KrakenMotorIcon,
  canSensor: CanSensorIcon,
  camera: CameraIcon,
  sensor: SensorIcon,
  radio: RadioIcon,
  switch: SwitchIcon,
  pneumaticHub: PneumaticHubIcon,
  compressor: CompressorIcon,
  solenoid: SolenoidIcon,
  rsl: RslIcon,
  servo: ServoIcon,
  canjunction: CanJunctionIcon,
  ledstrip: LedStripIcon,
  generic: GenericIcon,
};

export function getIcon(key) {
  return ICONS[key] ?? GenericIcon;
}
