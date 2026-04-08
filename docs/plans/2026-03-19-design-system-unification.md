# AutoSync Design System Unification

**Date:** 2026-03-19
**Status:** Approved
**Scope:** All 25+ app routes, shared components, navigation, footer

---

## Problem

The app was built incrementally — each page invented its own stat bar, icon badges, container patterns, and typography. This creates:
- Visual inconsistency (different icon sizes, card patterns, stat layouts)
- Same icons used for different concepts
- Navigation doesn't reflect current location
- No footer with branding/legal
- No shared components = every new page reinvents the wheel

## Solution

### 1. Shared Components

| Component | File | Purpose |
|-----------|------|---------|
| `StatBar` | `components/StatBar.tsx` | Single-card grid stat bar with icon→number→label |
| `IconBadge` | `components/IconBadge.tsx` | 28px circle with centered Polaris icon |
| `SectionCard` | `components/SectionCard.tsx` | Card with icon badge title + consistent padding |
| `PageFooter` | `components/PageFooter.tsx` | AutoSync logo + © 2026 + Privacy/Terms |

### 2. Canonical Icon Map

| Concept | Icon | Never Use For |
|---------|------|---------------|
| Products | `ProductIcon` | — |
| Fitments/Links | `LinkIcon` | — |
| Unmapped/Warning | `AlertCircleIcon` | Success states |
| Auto Mapped | `WandIcon` | Manual actions |
| Smart Mapped | `AutomationIcon` | Auto actions |
| Manual Mapped | `TargetIcon` | Auto actions |
| Flagged | `FlagIcon` | Normal states |
| Coverage/Progress | `GaugeIcon` | — |
| Collections | `CollectionIcon` | — |
| Providers | `PackageIcon` | Products |
| Import/Upload | `ImportIcon` | Export |
| Export/Push | `ExportIcon` | Import |
| Settings | `SettingsIcon` | — |
| Search/Browse | `SearchIcon` | — |
| Analytics/Charts | `ChartVerticalIcon` | — |
| Database/YMME | `DatabaseIcon` | — |
| Pricing/Money | `CashDollarIcon` | — |
| Help/Docs | `BookOpenIcon` | — |
| Delete | `DeleteIcon` | Non-destructive |
| Add/Create | `PlusCircleIcon` | — |

### 3. Typography Rules

| Element | Variant |
|---------|---------|
| Stat numbers | `headingLg` |
| Stat labels | `bodySm` |
| Section titles | `headingMd` |
| Table headers | `headingSm` |
| Body text | `bodyMd` |
| Small labels | `bodySm` |

### 4. Layout Pattern (Every Page)

```tsx
<Page title="..." primaryAction={...} secondaryActions={...} backAction={...}>
  <BlockStack gap="400">
    <StatBar items={[...]} />
    <SectionCard title="..." icon={SomeIcon}>
      {content}
    </SectionCard>
    <PageFooter />
  </BlockStack>
</Page>
```

### 5. Navigation

- Every page sets NavMenu active item
- Every sub-page has backAction to parent
- Menu reflects current location at all times

### 6. Footer

AutoSync logo + "© 2026 AutoSync" + Privacy Policy + Terms of Service + version

---

## Implementation Order

1. Create 4 shared components
2. Apply to all routes (alphabetical)
3. Fix NavMenu active states
4. Deploy + verify
