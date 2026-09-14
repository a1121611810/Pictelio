import { type Component } from "solid-js";
import { createRouter } from "@solidjs/router";
import { QueryClientProvider } from "@tanstack/solid-query";
import { routes } from "./router";
import { queryClient } from "./api/queryClient";

// SolidJS 2 路由：@solidjs/router 2.0 移除了 <Router> 组件，改为 createRouter 工厂
// （路由树在 config 中声明、实例不可变，可安全地在模块级创建一次）。
// scrollRestoration: true 对应旧 <Router scrollRestoration> 的显式开启语义。
const Router = createRouter({ routes, scrollRestoration: true });

const App: Component = () => (
  <QueryClientProvider client={queryClient}>
    <Router />
  </QueryClientProvider>
);

export default App;
