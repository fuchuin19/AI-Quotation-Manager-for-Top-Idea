---
name: Lustre Editorial
colors:
  surface: '#f9f9f8'
  surface-dim: '#dadad9'
  surface-bright: '#f9f9f8'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f3'
  surface-container: '#eeeeed'
  surface-container-high: '#e8e8e7'
  surface-container-highest: '#e2e2e2'
  on-surface: '#1a1c1c'
  on-surface-variant: '#45464d'
  inverse-surface: '#2f3130'
  inverse-on-surface: '#f1f1f0'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#645d58'
  on-secondary: '#ffffff'
  secondary-container: '#eae1da'
  on-secondary-container: '#6a635e'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#002114'
  on-tertiary-container: '#069669'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#eae1da'
  secondary-fixed-dim: '#cec5bf'
  on-secondary-fixed: '#1f1b17'
  on-secondary-fixed-variant: '#4b4641'
  tertiary-fixed: '#85f8c4'
  tertiary-fixed-dim: '#68dba9'
  on-tertiary-fixed: '#002114'
  on-tertiary-fixed-variant: '#005137'
  background: '#f9f9f8'
  on-background: '#1a1c1c'
  surface-variant: '#e2e2e2'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '500'
    lineHeight: '1.4'
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.05em
  price-display:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: '1'
  price-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  margin-mobile: 20px
  margin-desktop: 80px
  gutter: 16px
  touch-target: 44px
---

## Brand & Style

The design system is engineered for the high-end sanitaryware market, where precision and material quality are paramount. The aesthetic is **High-End Minimalism**—drawing inspiration from luxury horology and private banking interfaces. It evokes a sense of "quiet luxury" through generous white space, rigorous grid alignment, and a total absence of decorative flourishes.

The target audience consists of sales managers who require a professional tool that reflects the premium nature of the products they sell. The interface prioritizes clarity and confidence, using a "form follows function" approach to ensure technical specifications and pricing are the focal points. The visual mood is surgical, clean, and authoritative.

## Colors

The palette is anchored in a monochromatic "near-white" spectrum to allow product photography to stand out without competition.

- **Primary Accent:** Deep Navy (#0F172A) is reserved strictly for primary calls to action and critical navigation states, providing a heavy, grounded anchor to the light interface.
- **Surface Strategy:** Use #FAFAF9 for global backgrounds and #FFFFFF for cards and input fields to create subtle, non-shadow-based depth.
- **Functional Borders:** Hairline borders (#E7E5E4) are the primary method of structural separation, replacing shadows.
- **Success State:** A muted Emerald (#059669) is used for approved quotations or available stock indicators, maintaining the professional tone.

## Typography

Typography is used as a structural element. **Inter** provides the necessary neutrality and geometric precision. 

- **Tabular Figures:** All price displays and SKU codes must utilize `tnum` (tabular numbers) and `lnum` (lining numbers) OpenType features to ensure vertical alignment in quotation tables.
- **Hierarchy:** High contrast in weight is used rather than color. Labels use uppercase tracking to differentiate from body content.
- **Mobile Accessibility:** Body text never drops below 16px in form fields to prevent iOS zoom-on-focus, ensuring a seamless data entry experience.

## Layout & Spacing

This design system employs a **Fluid-Fixed Hybrid** model. 

- **Mobile (390px):** A single-column layout with 20px side margins. Primary actions (Create Quote, Finalize) are pinned to the bottom 30% of the screen (the "Thumb Zone") for ergonomic one-handed use.
- **Desktop (1280px):** Used specifically for the product catalogue. A 12-column grid with 80px margins. Content is capped at 1120px to maintain readability.
- **Rhythm:** All spacing is based on a 4px baseline grid. Internal component padding follows a `12px / 16px / 24px` progression.

## Elevation & Depth

Depth is achieved through **Tonal Layering** and **Hairline Outlines** rather than traditional shadows.

- **Flat Hierarchy:** Elements sit on the same optical plane. Distinctions between the background and a card are made by shifting from #FAFAF9 (background) to #FFFFFF (container).
- **Hairline Borders:** 1px solid borders in #E7E5E4 define all boundaries. 
- **Exceptions:** A single, highly diffused shadow (0px 10px 30px rgba(0,0,0,0.04)) is permitted only for modal bottom sheets on mobile to indicate they are temporary overlays.

## Shapes

The shape language is "Precision Softened." 

- **Radius:** A standard 8px radius is applied to all cards, input fields, and buttons. This provides a modern, approachable feel while maintaining a structured, architectural silhouette.
- **Interactive Elements:** Small UI controls like checkboxes or stepper buttons use a 4px radius to maintain a sharper, more "instrument-like" appearance.
- **Iconography:** Use 2px stroke-width icons with rounded terminals to match the font weight and corner radii of the containers.

## Components

### Buttons
- **Primary:** Solid #0F172A with white text. 44px minimum height. No gradients or shadows.
- **Secondary:** Transparent background with 1px #E7E5E4 border. Text in #0F172A.
- **Ghost:** Text only, used for secondary navigation or "Cancel" actions.

### Input Fields
- **State:** 1px #E7E5E4 border with #FFFFFF background. On focus, the border thickens to 1.5px and color shifts to #0F172A.
- **Labels:** Always visible, positioned above the field in `label-caps` style.

### Quotation Cards
- **Structure:** 1px border, 8px radius. Use a horizontal layout for pricing and vertical for product descriptions. Pricing must be right-aligned and set in tabular figures.

### Selection Controls
- **Checkboxes/Radios:** Custom-styled to match the primary navy. No default OS styling. 24x24px hit area within a 44px tap zone.

### Navigation
- **Mobile:** A clean bottom tab bar with 1px top border.
- **Desktop:** A minimalist side-rail or top-bar with generous 32px spacing between items.