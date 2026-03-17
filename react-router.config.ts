import type { Config } from "@react-router/dev/config";
import { flatRoutes } from "@react-router/fs-routes";

export default {
  ssr: true,
  future: {
    unstable_optimizeDeps: true,
  },
  routes: (defineRoutes) => flatRoutes(defineRoutes),
} satisfies Config;
