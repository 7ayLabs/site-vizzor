/**
 * SignalOrbital — six glowing nodes orbiting a central core.
 *
 * Visual metaphor for the six Vizzor signal families pulsing around the
 * scoring core. R3F canvas — caller dynamic-imports with `ssr: false`
 * so we never bundle WebGL into the SSR payload.
 *
 * Reduced motion: the canvas is NEVER created — we return a static SVG
 * fallback that lays out the same six dots + center circle. This is the
 * single switching point; the Canvas import sits below the gate.
 *
 * Active index lifts one node to full opacity + slightly larger scale.
 */
'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { AdditiveBlending, type Mesh } from 'three';
import { useReducedMotionSafe } from '@/lib/motion';

export interface SignalOrbitalProps {
  /** 0..5 — node to highlight; out-of-range falls back to no highlight. */
  activeIndex?: number;
  /** Canvas height in px — defaults to 320. */
  height?: number;
}

const NODE_COUNT = 6;
const ORBIT_RADIUS = 1.7;

interface OrbitingNodeProps {
  index: number;
  active: boolean;
}

function OrbitingNode({ index, active }: OrbitingNodeProps) {
  const ref = useRef<Mesh | null>(null);
  const baseAngle = (index / NODE_COUNT) * Math.PI * 2;

  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = state.clock.elapsedTime;
    const angle = baseAngle + t * 0.25;
    mesh.position.x = Math.cos(angle) * ORBIT_RADIUS;
    mesh.position.y = Math.sin(angle) * ORBIT_RADIUS;
    const pulse = 1 + Math.sin(t * 1.8 + index) * 0.12;
    const scale = (active ? 0.22 : 0.14) * pulse;
    mesh.scale.setScalar(scale);
  });

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[1, 24, 24]} />
      <meshBasicMaterial
        color={active ? '#FFFFFF' : '#8A93A2'}
        transparent
        opacity={active ? 0.95 : 0.55}
        blending={AdditiveBlending}
      />
    </mesh>
  );
}

function CoreNode() {
  const ref = useRef<Mesh | null>(null);
  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh) return;
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 1.2) * 0.06;
    mesh.scale.setScalar(0.32 * pulse);
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[1, 32, 32]} />
      <meshBasicMaterial
        color="#E6EAF0"
        transparent
        opacity={0.9}
        blending={AdditiveBlending}
      />
    </mesh>
  );
}

function SignalOrbitalSVG({ activeIndex }: { activeIndex: number | undefined }) {
  // Static fallback mirrors the WebGL layout: six dots around a center
  // circle, no animation. Sized via viewBox so the parent height prop
  // scales it cleanly.
  const nodes = useMemo(
    () =>
      Array.from({ length: NODE_COUNT }, (_, i) => {
        const angle = (i / NODE_COUNT) * Math.PI * 2;
        const cx = 50 + Math.cos(angle) * 28;
        const cy = 50 + Math.sin(angle) * 28;
        const active = i === activeIndex;
        return { cx, cy, active, key: i };
      }),
    [activeIndex],
  );
  return (
    <svg
      viewBox="0 0 100 100"
      width="100%"
      height="100%"
      role="img"
      aria-label="Six signal families orbiting the scoring core"
    >
      <circle cx="50" cy="50" r="6" fill="var(--accent)" opacity="0.9" />
      {nodes.map((n) => (
        <circle
          key={n.key}
          cx={n.cx}
          cy={n.cy}
          r={n.active ? 3.6 : 2.4}
          fill={n.active ? 'var(--accent)' : 'var(--whale)'}
          opacity={n.active ? 0.95 : 0.55}
        />
      ))}
    </svg>
  );
}

export function SignalOrbital({
  activeIndex,
  height = 320,
}: SignalOrbitalProps) {
  const reduced = useReducedMotionSafe();

  // Hard gate: under reduced motion we render the SVG fallback ONLY —
  // the Canvas import is never instantiated, so no WebGL context is
  // created. This is the single switching point the brief mandates.
  if (reduced) {
    return (
      <div style={{ height }} className="w-full">
        <SignalOrbitalSVG activeIndex={activeIndex} />
      </div>
    );
  }

  const indices = Array.from({ length: NODE_COUNT }, (_, i) => i);
  return (
    <div style={{ height }} className="w-full">
      <Canvas
        camera={{ position: [0, 0, 5], fov: 50 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        <CoreNode />
        {indices.map((i) => (
          <OrbitingNode key={i} index={i} active={i === activeIndex} />
        ))}
      </Canvas>
    </div>
  );
}
