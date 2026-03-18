/**
 * Type declarations for Shopify App Bridge web components.
 * These custom elements are rendered by the Shopify admin shell
 * and don't have published TypeScript definitions.
 */

import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & {
          "current-path"?: string;
        },
        HTMLElement
      >;
      "s-banner": DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & {
          tone?: string;
        },
        HTMLElement
      >;
      "s-stack": DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & {
          direction?: string;
          gap?: string;
        },
        HTMLElement
      >;
      "s-text": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
      "s-button": DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & {
          href?: string;
          variant?: string;
        },
        HTMLElement
      >;
    }
  }
}
