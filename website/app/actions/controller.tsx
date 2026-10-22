import { createController } from "remix/router";
import { HomePage } from "../home.tsx";
import { routes } from "../routes.ts";

export default createController(routes, {
  actions: {
    home(context) {
      return context.render(<HomePage />, {
        headers: {
          "Cache-Control": "public, max-age=0, must-revalidate",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "strict-origin-when-cross-origin",
        },
      });
    },
  },
});
