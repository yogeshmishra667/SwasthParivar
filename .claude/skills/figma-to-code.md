---
name: figma-to-code
description: Translate Figma designs into React / React Native components. Load when converting a design frame into JSX.
---

# Skill: Figma to Code

> Read this skill whenever you're converting a Figma design into a React component. This is the translation layer between design and implementation.

---

## The Conversion Workflow

When given a Figma description or screenshot, always work in this order:

1. **Layout first** — how elements are arranged (flex/grid, direction, alignment)
2. **Spacing** — padding inside elements, gaps between elements
3. **Sizing** — widths, heights, aspect ratios
4. **Typography** — font size, weight, line height, color
5. **Colors** — backgrounds, borders, text colors
6. **Effects** — shadows, rounded corners, transitions
7. **States** — hover, active, disabled, loading, empty

Never start with colors or effects — nail the structure first.

---

## Spacing Conversion — Figma px → Tailwind

Tailwind base unit = 4px. Divide Figma px by 4.

```
4px   → 1    (p-1, gap-1, m-1)
8px   → 2
12px  → 3
16px  → 4
20px  → 5
24px  → 6
28px  → 7
32px  → 8
36px  → 9
40px  → 10
48px  → 12
56px  → 14
64px  → 16
80px  → 20
96px  → 24
```

Non-standard values (e.g. 18px, 28px, 44px) → use arbitrary:

```
18px → [18px]
28px → [28px]
44px → [44px]
```

---

## Typography Conversion

### Font Sizes

```
Figma 12px → text-xs     (0.75rem)
Figma 14px → text-sm     (0.875rem)
Figma 16px → text-base   (1rem)
Figma 18px → text-lg     (1.125rem)
Figma 20px → text-xl     (1.25rem)
Figma 24px → text-2xl    (1.5rem)
Figma 30px → text-3xl    (1.875rem)
Figma 36px → text-4xl    (2.25rem)
Figma 48px → text-5xl    (3rem)
```

### Font Weight

```
Figma Regular (400) → font-normal
Figma Medium  (500) → font-medium
Figma Semibold(600) → font-semibold
Figma Bold    (700) → font-bold
```

### Line Height

Figma shows line height in px. Divide by font size to get the ratio, then pick the closest Tailwind value:

```
Ratio 1.0 → leading-none
Ratio 1.25 → leading-tight
Ratio 1.375 → leading-snug
Ratio 1.5 → leading-normal
Ratio 1.625 → leading-relaxed
Ratio 2.0 → leading-loose

Example: Figma shows 14px font, 21px line height
21 / 14 = 1.5 → leading-normal
```

### Letter Spacing

```
Figma -1%  → tracking-tight
Figma 0%   → tracking-normal
Figma 5%   → tracking-wide
Figma 10%  → tracking-wider
```

---

## Color Conversion

Figma gives hex codes. Use them as Tailwind arbitrary values or add to your config.

```tsx
// One-off color — arbitrary value
<div className="bg-[#F5F0EB] text-[#1A1A1A]">

// Repeated color — add to tailwind.config.ts
// tailwind.config.ts
theme: {
  extend: {
    colors: {
      cream: '#F5F0EB',
      'jewelry-gold': '#C9A84C',
      'jewelry-dark': '#1A1A1A',
    }
  }
}
// Then use:
<div className="bg-cream text-jewelry-dark">
```

### Opacity in Colors

```
Figma: fill color #000000 at 50% opacity
→ bg-black/50

Figma: fill color #1A1A1A at 80% opacity
→ bg-[#1A1A1A]/80
```

---

## Border Radius Conversion

```
Figma 2px  → rounded-sm
Figma 4px  → rounded
Figma 6px  → rounded-md
Figma 8px  → rounded-lg
Figma 12px → rounded-xl
Figma 16px → rounded-2xl
Figma 24px → rounded-3xl
Figma 9999px (pill) → rounded-full
```

---

## Shadow Conversion

Figma shadow format: `X Y Blur Spread Color Opacity`

```
Figma: 0 1px 2px #0000001A → shadow-sm
Figma: 0 2px 4px #00000014 → shadow
Figma: 0 4px 8px #0000001F → shadow-md
Figma: 0 8px 16px #00000024 → shadow-lg
Figma: 0 16px 32px #00000029 → shadow-xl
Figma: 0 24px 48px #0000002E → shadow-2xl

Custom shadow → arbitrary:
Figma: 0 4px 20px rgba(0,0,0,0.08) → shadow-[0_4px_20px_rgba(0,0,0,0.08)]
```

---

## Layout Reading — How to Read Figma Frames

### Auto Layout → Flexbox

Figma Auto Layout maps directly to flex in Tailwind.

```
Figma Auto Layout: Horizontal, gap 16px, padding 24px
→ className="flex flex-row gap-4 p-6"

Figma Auto Layout: Vertical, gap 12px, padding 16px 24px
→ className="flex flex-col gap-3 py-4 px-6"

Figma Alignment: Left → items-start
Figma Alignment: Center → items-center
Figma Alignment: Right → items-end
Figma Alignment: Space between → justify-between
```

### Fixed Frame → Width/Height

```
Figma fixed width 320px → w-80 (if it's 320px exactly) or w-[320px]
Figma fixed height 200px → h-[200px] or use aspect ratio if it's an image
Figma fill container → w-full
Figma hug contents → (no width class — content determines size)
```

---

## Responsive Interpretation

Figma designs are usually desktop-first. When implementing, flip to mobile-first:

```
Figma shows: 3-column grid at 1440px
→ Implement as: 1 column mobile → 2 at sm → 3 at xl

Figma shows: horizontal nav with all items visible
→ Implement as: hamburger on mobile → full nav at md

Figma shows: side-by-side product detail at 1440px
→ Implement as: stacked on mobile → side by side at lg

Figma shows: 24px padding around a section
→ Implement as: px-4 base → sm:px-6 → xl:px-8
   (reduce padding on mobile, scale up to desktop value)
```

---

## Component Skeleton — How to Start

When given a Figma component to implement:

```tsx
// Step 1: Write the structure with layout only — no colors yet
export function ProductCard({ product }: ProductCardProps) {
  return (
    <div className="flex flex-col">
      <div className="aspect-square">
        {/* image */}
      </div>
      <div className="flex flex-col gap-1 mt-3">
        <p>{product.name}</p>
        <p>{product.price}</p>
      </div>
    </div>
  );
}

// Step 2: Add spacing
<div className="flex flex-col gap-1 mt-3 px-1">

// Step 3: Add typography
<p className="text-sm font-medium text-gray-900 truncate">

// Step 4: Add colors + effects
<div className="aspect-square overflow-hidden rounded-lg bg-gray-100">

// Step 5: Add responsive variants
<div className="flex flex-col gap-1 mt-2 sm:mt-3 px-1">
```

---

## Pixel-Perfect Checklist

Before calling a component done, check against the Figma:

```
□ Spacing matches (padding, gaps, margins)
□ Font size and weight match
□ Colors match (use color picker on Figma)
□ Border radius matches
□ Image aspect ratio is correct
□ Text truncates correctly when long
□ Component handles mobile viewport (375px)
□ Component handles desktop viewport (1280px)
□ Hover state implemented if Figma shows one
□ Empty/loading state looks reasonable
```
