# DrawTruss

A web app for drawing planar trusses freehand on screen, then automatically vectorizing them into proper nodes and edges.

## Features

- Freehand drawing on an HTML canvas
- Automatic vectorization using Ramer-Douglas-Peucker simplification and endpoint clustering
- Adjustable snap radius for controlling node merging sensitivity
- SVG and JSON export of the vectorized truss
- Undo, clear, and reset controls
- Touch-device support
- Dark themed UI with grid background

## Usage

1. Draw lines on the canvas to sketch a truss structure
2. Adjust the **Snap radius** slider to control how aggressively nearby endpoints are merged into single nodes
3. Click **Vectorize** to convert your freehand drawing into a clean truss
4. Use **Export SVG** or **Export JSON** to save the result
5. Click **Reset** to go back to editing your freehand drawing

## Deployment

The app is pure HTML/CSS/JS with no build step. It is deployed via GitHub Pages from the root of the repository.