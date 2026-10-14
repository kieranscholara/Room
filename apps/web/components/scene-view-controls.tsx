'use client';
import { Box, Grid2X2 } from 'lucide-react';
import './room-viewer-3d.css';

export type SceneView = '2d' | '3d';

/** Display preference only: changing views never changes the saved scene. */
export function SceneViewControls({
  view,
  onChange,
}: {
  view: SceneView;
  onChange: (view: SceneView) => void;
}) {
  return (
    <div className="scene-view-controls" role="group" aria-label="Scene view">
      <button type="button" aria-pressed={view === '2d'} onClick={() => onChange('2d')}>
        <Grid2X2 size={15} /> 2D floor plan
      </button>
      <button type="button" aria-pressed={view === '3d'} onClick={() => onChange('3d')}>
        <Box size={15} /> 3D room view
      </button>
    </div>
  );
}
