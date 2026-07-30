import { type Component } from "solid-js";
import { Router } from "@solidjs/router";
import { QueryClientProvider } from "@tanstack/solid-query";
import { routes } from "./router";
import { queryClient } from "./api/queryClient";

const App: Component = () => (
  <QueryClientProvider client={queryClient}>
    <Router scrollRestoration>{routes}</Router>
  </QueryClientProvider>
);

export default App;
