import { createApp } from 'vue-lynx'

// Tailwind 指令必须从独立 CSS 入口加载（见 styles/tailwind.css 注释）：
// .vue <style> 内联 @tailwind 指令不经过 rsbuild CSS 链，utility 类不会生成。
import './styles/tailwind.css'
import App from './App.vue'

const app = createApp(App)
app.mount()
