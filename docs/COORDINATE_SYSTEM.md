# Coordinate system

Positions are in metres: X is horizontal, Y vertical, Z the second horizontal axis. The origin is the room's top-left corner in the plan; +X is right and +Z down. Objects are centred on their ground footprints, with `y = 0`. Dimensions are local width (+X), depth (+Z) and height (+Y).

Rotation is radians about +Y, using Three.js's right-handed convention: local `(x,z)` maps to `(x cos θ + z sin θ, -x sin θ + z cos θ)`. Konva's clockwise screen rotation is therefore `-θ` in degrees. The inspector converts radians to degrees for display only. Geometry is never stored in pixels.

Viewport fit, zoom and pan are display transforms. Dragging converts canvas coordinates back to metres, with optional 0.1 m grid snapping and nearby wall snapping. Distance guides measure the rotated footprint's outer extents to the room walls. The backend validates the exact proposed footprint through preview/accept.

SAT uses a 1e-8 m floating-point tolerance; touching edges are allowed and true overlaps are rejected. The solver's local candidate grid is 0.25 m, with exact current/preferred transforms retained. Door/window envelopes and rectangular exclusion zones use the same room coordinates.

Validated model bounds use the same metre axes, including decoded mesh/world transforms. Uploading a model does not yet add a 3D viewer or change the canonical rectangular collision proxy.
