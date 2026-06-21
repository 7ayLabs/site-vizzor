/**
 * ParticleConverge — instanced particle field converging on a target.
 *
 * ~200 particles spawn from random edge positions and travel toward
 * `target`. When a particle reaches the target it respawns at a new
 * random edge point, creating a continuous "signal collection" loop.
 *
 * Reduced motion: static SVG fallback with a handful of dots at the
 * target. No WebGL context is created.
 */
'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  type InstancedMesh,
  Matrix4,
  Vector3,
} from 'three';
import { useReducedMotionSafe } from '@/lib/motion';

export interface ParticleConvergeProps {
  /** World-space convergence target — defaults to center-bottom [0,-1,0]. */
  target?: [number, number, number];
  /** Particle count — defaults to 200. */
  count?: number;
  /** Canvas height in px — defaults to 280. */
  height?: number;
}

const EDGE_RADIUS = 3.4;

interface ParticleState {
  position: Vector3;
  velocity: number;
}

function randomEdgePosition(): Vector3 {
  // Spawn on a circle at the canvas edge — gives a clean "incoming from
  // all directions" arc instead of a flat horizon.
  const angle = Math.random() * Math.PI * 2;
  const r = EDGE_RADIUS * (0.85 + Math.random() * 0.25);
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, 0);
}

interface ParticleFieldProps {
  target: Vector3;
  count: number;
}

function ParticleField({ target, count }: ParticleFieldProps) {
  const meshRef = useRef<InstancedMesh | null>(null);
  const matrix = useMemo(() => new Matrix4(), []);

  // Per-instance state — position + speed scalar. We avoid building one
  // Vector3 per frame per particle by reusing the stored vectors.
  const particles = useMemo<ParticleState[]>(
    () =>
      Array.from({ length: count }, () => ({
        position: randomEdgePosition(),
        velocity: 0.4 + Math.random() * 0.6,
      })),
    [count],
  );

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (!p) continue;
      const dir = new Vector3().subVectors(target, p.position);
      const dist = dir.length();
      if (dist < 0.05) {
        // Reached target — respawn at edge.
        const fresh = randomEdgePosition();
        p.position.copy(fresh);
        p.velocity = 0.4 + Math.random() * 0.6;
      } else {
        dir.normalize().multiplyScalar(p.velocity * delta);
        p.position.add(dir);
      }
      matrix.makeTranslation(p.position.x, p.position.y, p.position.z);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[0.025, 8, 8]} />
      <meshBasicMaterial
        color="#E6EAF0"
        transparent
        opacity={0.75}
        blending={AdditiveBlending}
      />
    </instancedMesh>
  );
}

function ParticleConvergeSVG({
  target,
}: {
  target: [number, number, number];
}) {
  // Project world target into the SVG viewBox — same convention used by
  // the WebGL layer: center of the box maps to (0,0), Y inverted.
  const cx = 50 + target[0] * 12;
  const cy = 50 - target[1] * 12;
  const dots = [
    { dx: 0, dy: 0, r: 2.8 },
    { dx: -3, dy: -1, r: 1.6 },
    { dx: 3, dy: -1, r: 1.6 },
    { dx: -2, dy: 2, r: 1.2 },
    { dx: 2, dy: 2, r: 1.2 },
  ];
  return (
    <svg
      viewBox="0 0 100 100"
      width="100%"
      height="100%"
      role="img"
      aria-label="Signal field converging on target"
    >
      {dots.map((d, idx) => (
        <circle
          key={idx}
          cx={cx + d.dx}
          cy={cy + d.dy}
          r={d.r}
          fill="var(--accent)"
          opacity={0.6 + (5 - idx) * 0.08}
        />
      ))}
    </svg>
  );
}

export function ParticleConverge({
  target = [0, -1, 0],
  count = 200,
  height = 280,
}: ParticleConvergeProps) {
  const reduced = useReducedMotionSafe();

  if (reduced) {
    return (
      <div style={{ height }} className="w-full">
        <ParticleConvergeSVG target={target} />
      </div>
    );
  }

  const targetVec = new Vector3(target[0], target[1], target[2]);

  return (
    <div style={{ height }} className="w-full">
      <Canvas
        camera={{ position: [0, 0, 6], fov: 50 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        <ParticleField target={targetVec} count={count} />
      </Canvas>
    </div>
  );
}
