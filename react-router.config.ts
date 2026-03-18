import type { Config } from "@react-router/dev/config";
import { flatRoutes } from "@react-router/fs-routes";

export default {
  ssr: true,
  future: {
    unstable_optimizeDeps: true,
  },
  routes: (defineRoutes: Parameters<typeof flatRoutes>[0]) =>
    flatRoutes(defineRoutes),
} satisfies Config & { routes?: unknown };
