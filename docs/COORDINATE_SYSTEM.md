# Coordinate system

Positions are in metres: X is horizontal, Y vertical, Z the second horizontal axis. The origin is the room's top-left corner in the plan; +X is right, +Z down in the plan. Objects are centred on their ground footprints. `y = 0` is floor level. Dimensions are local width (+X), depth (+Z), and height (+Y).

Rotation is radians about +Y, using Three.js's right-handed convention: local `(x,z)` maps to `(x cos θ + z sin θ, -x sin θ + z cos θ)`. Konva's clockwise screen rotation is therefore `-θ` in degrees. The inspector converts radians to degrees for display only. No geometry is stored in pixels.

Viewport fit, zoom and pan are display transformations. Dragging converts canvas coordinates back to metres and snaps to a 0.1 m grid. The backend validates the exact proposed oriented footprint. SAT uses a 1e-8 m floating-point tolerance; touching edges are allowed, genuine overlaps are rejected. The solver's candidate grid is 0.25 m, with exact current and preferred transforms retained.
