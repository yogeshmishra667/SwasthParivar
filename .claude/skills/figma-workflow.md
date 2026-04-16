---
name: figma-workflow
description: Figma-to-code workflow — reading designs, extracting tokens, icons, and checking pixel accuracy. Load when any task involves a Figma design.
---

# Skill: Figma Workflow

> Read this skill when any task involves a Figma design — new component, design update, icon extraction, or pixel-accuracy check.

---

## How to Get Figma Content Into Claude Code

### Method 1 — Screenshot (use for layouts and full components)
```
Figma → select frame → Cmd+Shift+C (Mac) / Ctrl+Shift+C (Windows)
→ paste directly into Claude Code chat
```
Use when: building a new component or page section from scratch.

### Method 2 — Dev Mode values (use for exact measurements)
```
Figma → Dev Mode (bottom toolbar icon) → click any element
→ right panel shows: exact px, font size, color hex, border radius
→ screenshot the right panel alongside the design
```
Use when: you need pixel-accurate values, not approximations.
Figma Pro gives you full Dev Mode access — always use it for spacing-critical work.

### Method 3 — Copy SVG directly (use for icons and illustrations)
```
Figma → select vector/icon layer → right-click → Copy as SVG
→ paste directly into Claude Code chat
```
Use when: extracting icons or any vector element for a React component.

### Method 4 — Export PNG/SVG (use for files you want to keep)
```
Figma → right-click frame → Export → PNG (layouts) or SVG (vectors)
→ drag into Claude Code chat
```
Use when: you want a saved file, or the screenshot quality isn't enough.

---

## Use Case 1 — New Component From Figma

**What to attach:** Screenshot of the component (or Dev Mode screenshot for precision)

**What to say:**
```
Implement this component. Match spacing, typography, and layout exactly.
Mobile-first Tailwind. Component goes in src/components/[folder]/[Name].tsx
```

**What Claude does:**
1. Reads layout structure (flex/grid, direction, alignment)
2. Converts spacing (Figma px ÷ 4 = Tailwind scale)
3. Converts typography (font size, weight, line height)
4. Converts colors to hex arbitrary values or existing config tokens
5. Adds responsive variants (desktop Figma → mobile-first implementation)
6. Handles states visible in the design (hover, disabled, empty)

---

## Use Case 2 — Update Existing Component to New Figma Design

**What to attach:** 
- Screenshot of OLD Figma design
- Screenshot of NEW Figma design  
- The existing component code (paste it or reference the file path)

**What to say:**
```
Update [ComponentName] to match the new design.
Old design: [first screenshot]
New design: [second screenshot]
Existing code: [paste code or say "read src/components/product/ProductCard.tsx"]

Only change what's visually different. Keep all logic and props intact.
```

**What Claude does:**
- Diffs old vs new visually (spacing changed? colors updated? layout restructured?)
- Applies only the visual changes — never touches props, state logic, or TypeScript types
- Preserves className props, event handlers, conditional rendering

**Common changes Claude looks for:**
```
Spacing updated    → update padding/gap classes
Color updated      → update bg/text/border classes  
Typography updated → update text-size/font-weight classes
Layout changed     → restructure flex/grid
New element added  → add the element, wire up with existing props
Element removed    → remove cleanly, check if prop becomes unused
Border radius      → update rounded classes
Shadow added       → add shadow class
```

---

## Use Case 3 — Extract Icon from Figma

**What to attach:** The SVG (Copy as SVG from Figma, paste directly)

**What to say:**
```
Convert this to a typed React icon component.
Save to src/components/ui/icons/[IconName]Icon.tsx
Export it from src/components/ui/icons/index.tsx
```

**What Claude produces:**
```tsx
// Typed, flexible, works with Tailwind text-* for color control
interface IconProps {
  size?: number;
  className?: string;
}

export function RingIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"      // preserved from Figma
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* paths from your SVG */}
    </svg>
  );
}
```

**Multiple icons at once:**
```
Here are 5 icon SVGs [paste all]. 
Convert each to a React component and export all from src/components/ui/icons/index.tsx
```

---

## Use Case 4 — Full Page Implementation

Full pages are too large to implement accurately in one shot. Always break into sections.

**Approach:**
```
1. Screenshot the full page → send to Claude → say:
   "List all sections you see. We'll implement one at a time."

2. Claude identifies: Hero, ProductGrid, FilterSidebar, Footer, etc.

3. Implement bottom-up: start with smallest/simplest components first
   (ProductCard before ProductGrid, ProductGrid before the full page)

4. After each section: /verify → check it matches before moving on
```

**Why bottom-up:** Large components compose smaller ones. If ProductCard is wrong, ProductGrid will be wrong too. Fix the leaves before the tree.

---

## Use Case 5 — Pixel Accuracy Check

When implementation is done but you're not sure it matches Figma:

**What to attach:** 
- Screenshot of Figma design
- Screenshot of your browser at the same viewport

**What to say:**
```
Compare these two screenshots. 
List every visual difference — spacing, colors, typography, alignment.
Then fix them in [ComponentName].
```

**Claude checks:**
- Spacing gaps between elements
- Padding inside containers
- Font size and weight
- Color accuracy
- Alignment (left/center/right)
- Border radius
- Missing hover states

---

## Use Case 6 — Responsive: Figma Shows Desktop Only

Figma designs are usually desktop. When implementing, you need to invent the mobile layout.

**What to say:**
```
Figma shows the desktop layout (1440px). 
Implement mobile-first. Invent a reasonable mobile layout (375px) that follows the same visual language.
Use the figma-to-code skill for spacing conversion.
```

**If Figma has both desktop and mobile frames:**
```
[Attach desktop screenshot] — desktop at 1440px
[Attach mobile screenshot] — mobile at 375px
Implement both. Mobile-first Tailwind.
```

---

## Dev Mode Values — How to Read Them

When you screenshot the Dev Mode panel, it shows values like:

```
Figma Dev Mode shows:
  padding: 24px 32px
  gap: 16px
  font-size: 14px
  font-weight: 500
  color: #1A1A1A
  border-radius: 8px
```

Tell Claude:
```
Use these exact Dev Mode values:
padding: 24px 32px → py-6 px-8
gap: 16px → gap-4
font-size: 14px / weight 500 → text-sm font-medium
color: #1A1A1A → text-[#1A1A1A]
border-radius: 8px → rounded-lg
```

Or just paste the Dev Mode screenshot and Claude converts them.

---

## What to Always Tell Claude When Attaching Figma

```
1. Where the component lives:
   "Save to src/components/product/ProductCard.tsx"

2. What viewport the Figma shows:
   "This is the desktop design at 1440px"
   "This is mobile at 375px"

3. What behavior you want:
   "Implement from scratch" or "Update existing component"

4. Any Figma-specific context:
   "The gray boxes are image placeholders"
   "The dashed border is a Figma annotation, not part of the design"
   "Ignore the red redline measurements — just use the visual layout"
```
