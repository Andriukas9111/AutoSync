# AutoSync Website — Page-by-Page Design Plan

## Design Direction
- **Light theme** with lavender hero gradient (from Figma: #EEE8FF → #F5F0FF → #FFFFFF)
- **Split hero layout** like Cal.com — text LEFT, product UI RIGHT (NOT centered)
- **Tabbed product showcase** like Dub.co — tabs to switch between widget views
- **Massive typography** like Resend — headline does the heavy lifting
- **Product-first** like Linear — show the actual app UI, not abstract illustrations

## Typography
- Headings: DM Sans (700-800 weight, -3% to -4.5% tracking)
- Body: Inter (400-500 weight)
- Mono: JetBrains Mono (for VIN, technical data)

## Colors (from Figma + Opscale)
- Background: #FFFFFF (white) / #F8F8FA (snow) / #EEE8FF (lavender hero)
- Text: #0F172A (ink) / #334155 (carbon) / #64748B (slate) / #9CA3AF (gray)
- Accent: #0099FF (blue) / #6B52D9 (purple)
- Success: #10B981 / Error: #DC2626 / Amber: #D97706

## Section Plan — EACH SECTION IS VISUALLY UNIQUE

### 1. NAV (sticky, glassmorphism)
- Logo + links + pill CTA
- Height: 72px
- Glass effect on scroll

### 2. HERO — Split Layout (Cal.com style)
- LEFT SIDE: Pill badge → H1 (56-72px) → Subtitle → 2 CTAs → Stats row (inline, not card grid)
- RIGHT SIDE: Floating dashboard mockup with perspective tilt + gradient shadow
- Background: Lavender gradient with dot grid
- THIS IS FUNDAMENTALLY DIFFERENT from centered hero + dashboard below

### 3. TRUST — Infinite marquee
- Simple, minimal — just logos scrolling
- "Trusted by parts retailers worldwide"

### 4. FEATURES — Tabbed Product Showcase (Dub.co style)
- Section tag + heading
- TABS at top: "YMME Search" | "Plate Lookup" | "VIN Decode" | "Wheel Finder" | "Fitment Badge"
- Each tab shows a DIFFERENT visual composition:
  - YMME: Brand logo grid (like our Figma version) — NOT dropdowns
  - Plate: Realistic UK plate bar with result card — NOT an input field
  - VIN: Decoded spec waterfall grid — NOT an input with button
  - Wheel: PCD/diameter visual selector — NOT dropdowns
  - Badge: Product card with fit/no-fit states — NOT text strips
- The visual sits inside a product frame with perspective tilt
- THIS REPLACES the alternating left/right rows that were in every previous attempt

### 5. SYSTEMS — Horizontal scroll cards (NOT bento grid)
- 8 system cards that scroll horizontally (like a carousel)
- Each card: icon + title + description + stat badge
- DIFFERENT from bento grid — this is a horizontal scroll experience

### 6. HOW IT WORKS — Vertical timeline (NOT horizontal steps)
- 4 steps arranged VERTICALLY with connecting line on the LEFT
- Step number on left, content on right
- THIS IS DIFFERENT from the horizontal step cards with dots

### 7. STATS — Full-width dark section
- Dark background (#0F172A) with large counter numbers
- 374+ Makes | 3,686+ Models | 29,515+ Engines | 29,516+ Specs
- Typography-driven — big numbers, small labels
- THIS IS A VISUAL BREAK between light sections

### 8. PRICING — 3 visible tiers + expandable
- Show Starter, Growth (highlighted), Professional
- "Show all plans" expands to 6
- Clean cards with shadows, not borders

### 9. COMPARE — Side-by-side (NOT a table)
- AutoSync card on left (full featured, highlighted)
- Competitors stacked on right (showing what they lack)
- THIS IS DIFFERENT from the same table every time

### 10. TESTIMONIALS — Large quote cards
- 3 cards with large quotation marks, star ratings
- Clean, minimal

### 11. FAQ — Standard accordion
- Max-width 720px, centered

### 12. CTA — Blue gradient rounded section
- Inside a rounded container with gradient bg + dot pattern
- "Ready to sell more parts?"

### 13. LOGIN — Shopify install form
- Centered, minimal

### 14. FOOTER — 4 columns
- Brand + description | Product links | Company links | Legal links

## KEY DIFFERENCES FROM ALL PREVIOUS ATTEMPTS
1. **Split hero** (text left, product right) — NOT centered everything
2. **Tabbed product showcase** — NOT alternating left/right rows
3. **Horizontal scroll systems** — NOT bento grid
4. **Vertical timeline** — NOT horizontal steps
5. **Dark stats section** — visual break between light sections
6. **Side-by-side comparison** — NOT a table
7. **Content from website-content.ts** — NOT hardcoded in components
