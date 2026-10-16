'use client';
import { Box, Image } from 'lucide-react';
import './room-viewer-3d.css';

export type SceneView = '3d' | 'photo';

/** Display preference only: changing views never changes the saved scene. */
export function SceneViewControls({
  view,
  onChange,
  photoEnabled = false,
}: {
  view: SceneView;
  onChange: (view: SceneView) => void;
  photoEnabled?: boolean;
}) {
  return (
    <div className="scene-view-controls" role="group" aria-label="Scene view">
      {photoEnabled && (
        <button type="button" aria-pressed={view === 'photo'} onClick={() => onChange('photo')}>
          <Image size={15} /> Client photograph
        </button>
      )}
      <button type="button" aria-pressed={view === '3d'} onClick={() => onChange('3d')}>
        <Box size={15} /> 3D room view
      </button>
    </div>
  );
}
