'use client';

import { useState } from 'react';
import { HorizonStrip } from '@/components/ui/horizon-strip';

const HORIZONS = ['5m', '15m', '30m', '1h', '2h', '4h', '1d', '7d', '30d'] as const;

export function HorizonStripDemo() {
  const [selected, setSelected] = useState<string | null>('4h');
  return (
    <div className="space-y-3">
      <HorizonStrip horizons={HORIZONS} selected={selected} onSelect={setSelected} />
      <p className="text-[12px] mono tabular text-[var(--fg-3)]">
        selected: {selected ?? 'all'}
      </p>
    </div>
  );
}
