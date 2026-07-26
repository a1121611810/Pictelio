import { type Component } from "solid-js";
import { QueryClientProvider } from "@tanstack/solid-query";
import { router } from "./router";
import { queryClient } from "./api/queryClient";

const App: Component = () => (
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>
);

export default App;
