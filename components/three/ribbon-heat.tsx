/**
 * RibbonHeat — a tessellated mint ribbon whose vertices are displaced
 * by a heat function sin(x*2 + t) * amp.
 *
 * Visual metaphor for "live signal warmth" across the predicted horizon.
 * The `wr` prop (win-rate, 0..1) shifts the amplitude — higher WR rides
 * higher and brighter; lower WR sinks flatter and darker.
 *
 * Reduced motion: static SVG smooth-wave fallback. Canvas is never
 * mounted under reduced motion.
 */
'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  DoubleSide,
  PlaneGeometry,
  type Mesh,
} from 'three';
import { useReducedMotionSafe } from '@/lib/motion';

export interface RibbonHeatProps {
  /** Win-rate 0..1 — shifts the heat amplitude. Defaults to 0.65. */
  wr?: number;
  /** Canvas height in px — defaults to 240. */
  height?: number;
}

const PLANE_WIDTH = 6;
const PLANE_HEIGHT = 1.4;
const SEGMENTS_X = 64;
const SEGMENTS_Y = 8;

function Ribbon({ wr }: { wr: number }) {
  const ref = useRef<Mesh | null>(null);
  // Build geometry once; we'll mutate position attribute in-place.
  const geometry = useMemo(
    () => new PlaneGeometry(PLANE_WIDTH, PLANE_HEIGHT, SEGMENTS_X, SEGMENTS_Y),
    [],
  );

  // Stash the original X coords so we can drive the heat function
  // from a stable input (the displaced Z must depend on original X,
  // not on the latest displaced value).
  const baseX = useMemo(() => {
    const pos = geometry.attributes.position;
    if (!pos) return new Float32Array(0);
    const arr = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) arr[i] = pos.getX(i);
    return arr;
  }, [geometry]);

  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh) return;
    const pos = geometry.attributes.position;
    if (!pos) return;
    const t = state.clock.elapsedTime;
    const amp = 0.18 + wr * 0.32;
    for (let i = 0; i < pos.count; i++) {
      const x = baseX[i] ?? 0;
      const z = Math.sin(x * 2 + t) * amp;
      pos.setZ(i, z);
    }
    pos.needsUpdate = true;
  });

  return (
    <mesh ref={ref} rotation={[-0.35, 0, 0]} geometry={geometry}>
      <meshBasicMaterial
        color="#E6EAF0"
        transparent
        opacity={0.55 + wr * 0.35}
        side={DoubleSide}
        wireframe
        blending={AdditiveBlending}
      />
    </mesh>
  );
}

function RibbonHeatSVG({ wr }: { wr: number }) {
  // Smooth static wave — amplitude derived from wr so the visual delta
  // between low-WR and high-WR sections is still legible without WebGL.
  const amp = 8 + wr * 14;
  const mid = 60;
  const points: string[] = [];
  for (let x = 0; x <= 200; x += 4) {
    const y = mid + Math.sin(x * 0.05) * amp;
    points.push(`${x},${y.toFixed(1)}`);
  }
  return (
    <svg
      viewBox="0 0 200 120"
      width="100%"
      height="100%"
      role="img"
      aria-label="Win-rate heat ribbon"
      preserveAspectRatio="none"
    >
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.4"
        opacity={0.6 + wr * 0.35}
      />
    </svg>
  );
}

export function RibbonHeat({ wr = 0.65, height = 240 }: RibbonHeatProps) {
  const reduced = useReducedMotionSafe();
  const clampedWr = Math.max(0, Math.min(1, wr));

  if (reduced) {
    return (
      <div style={{ height }} className="w-full">
        <RibbonHeatSVG wr={clampedWr} />
      </div>
    );
  }

  return (
    <div style={{ height }} className="w-full">
      <Canvas
        camera={{ position: [0, 0.6, 4.2], fov: 45 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        <Ribbon wr={clampedWr} />
      </Canvas>
    </div>
  );
}
