---
name: visual-assets
description: Working with images, SVGs, icons, and design screenshots in UI tasks. Load when handling any visual asset.
---

# Skill: Visual Assets in UI Development

> Read this skill when working with images, SVGs, icons, or design screenshots in any UI task.

---

## What You Can Attach in Claude Code Sessions

When building UI, attach these directly in the chat:

```
Design screenshots    → Claude reads layout, spacing, colors, components
Figma exports (PNG)   → Use with figma-to-code skill for pixel-accurate conversion
Icon SVGs             → Claude embeds directly or converts to components
Product images        → Claude uses dimensions/aspect ratios to build correct containers
Logo SVGs             → Claude extracts paths, colors, viewBox for component
UI reference images   → "Make this look like the attached screenshot"
```

---

## How to Use Attached Assets

### Design Screenshot → Component

Attach the screenshot and say:

```
Implement this component. Match spacing, typography, and layout exactly.
```

Claude will read the image using figma-to-code patterns — layout first, then spacing, then colors.

### SVG Icon → React Component

Attach the SVG file and say:

```
Convert this to a typed React icon component
```

Claude will produce:

```tsx
// src/components/ui/icons/RingIcon.tsx
interface IconProps {
  size?: number;
  color?: string;
  className?: string;
}

export function RingIcon({ size = 24, color = "currentColor", className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24" // preserved from original
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* paths from attached SVG */}
    </svg>
  );
}
```

### Multiple Icons → Icon System

Attach several SVGs at once and say:

```
Create an icon system from these SVGs. Single export file.
```

Claude will produce `src/components/ui/icons/index.tsx` with all icons exported from one place so you import like:

```tsx
import { RingIcon, NecklaceIcon, CartIcon } from "@/components/ui/icons";
```

### Product Image → Correct Container

Attach a product photo and say:

```
Build the product card container for this image. Match aspect ratio.
```

Claude reads the image dimensions and builds:

```tsx
// If image is square (1:1)
<div className="aspect-square overflow-hidden rounded-lg">

// If image is portrait (4:5)
<div className="aspect-[4/5] overflow-hidden rounded-lg">
```

---

## SVG Best Practices Claude Follows

When working with any SVG:

```tsx
// ✅ Always replace hardcoded colors with currentColor for icon SVGs
// This lets you control color via Tailwind text-* classes
fill = "currentColor"; // instead of fill="#1A1A1A"
stroke = "currentColor"; // instead of stroke="#333"

// ✅ Always preserve the original viewBox — never change it
viewBox = "0 0 24 24"; // keep exactly as in original SVG

// ✅ Remove width/height from SVG element — control via size prop or className
// ❌ <svg width="24" height="24">
// ✅ <svg width={size} height={size}>

// ✅ Remove xmlns:xlink if unused — reduces noise
// ✅ Remove title tags unless accessibility needs them (add aria-label to wrapper instead)
```

---

## Where Assets Live in the Project

```
public/
  images/
    products/       → Product photos (referenced as /images/products/ring-001.jpg)
    hero/           → Homepage banner images
  icons/            → SVG files used as static assets (favicon, og-image)

src/
  components/
    ui/
      icons/        → SVG React components (RingIcon, CartIcon, etc.)
        index.tsx   → Single export file for all icons
```

---

## Naming Convention

```
React icon components:   PascalCase + Icon suffix
  RingIcon.tsx, CartIcon.tsx, ChevronDownIcon.tsx

Static SVG files:        kebab-case
  ring-icon.svg, cart-icon.svg

Product images:          kebab-case with identifier
  ring-gold-001.jpg, necklace-pearl-002.jpg
```

---

## When Attaching Assets — Tell Claude What You Need

Be specific about the goal:

```
"Convert this SVG to a React component"
"Build a component matching this screenshot"
"Match the spacing in this Figma export exactly"
"Create product card containers that work with these image proportions"
"Implement the hover state shown in the second screenshot"
```

The more specific, the more accurate the output.
