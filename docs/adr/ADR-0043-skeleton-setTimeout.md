# ADR 0043: 骨架屏渲染保障 — setTimeout(0) 替换 requestAnimationFrame

## 状态

已接受（2026-07-30）

## 背景

### 问题

`requestAnimationFrame` 的回调在浏览器**渲染当前帧之前**执行（rAF 是渲染管线的第一步，paint 是最后一步）。如果回调中的 `ensureLoaded → fetch` 在 rAF 期间同步完成，数据在浏览器 paint 之前就绪，骨架屏条件 `illusts.length === 0` 不满足，不渲染。

日志证据：
```
① rAF fired → ensureLoaded → fetch
② fetch 同步完成 → illusts: 0 → 57
③ 浏览器 paint → 骨架屏条件不满足 → 无骨架屏
```

### 时序对比

`requestAnimationFrame` 的执行顺序：
```
rAF queue → ensureLoaded → fetch (sync)
→ style → layout → paint
← 此时数据已就绪，骨架屏条件不满足
```

`setTimeout(0)` 的执行顺序：
```
rAF queue → style → layout → paint
← 骨架屏渲染到屏幕（第一帧）
setTimeout(0) → ensureLoaded → fetch
← 数据到达 → 替换内容（至少一帧骨架屏可见）
```

### 约束

- 确保至少一帧骨架屏在数据加载前渲染到屏幕
- 不增加首屏加载延迟
- 不影响缓存命中时的体验

## 决策

### 决策：setTimeout(0) 替换 requestAnimationFrame

在 `RecommendedFeed` 和 `FollowFeed` 的 `onMount` 中，将 `requestAnimationFrame` 替换为 `setTimeout(fn, 0)`。

### 不改动的文件

- `IllustBookmarks.tsx` 和 `NovelBookmarks.tsx` — 用户切换到收藏 Tab 时才挂载，首次交互已有可见帧
- `VirtualFeed.tsx` — 骨架屏逻辑不变
- `HomePage.tsx` — Splash 关闭逻辑不变

## 后果

### 正面

- 骨架屏至少显示一帧后再加载数据
- 延迟仅 ~4ms（一个 macrotask），用户无感知
- 不影响缓存命中时的响应速度

### 反面

- 在慢速设备上，首屏加载延迟略有增加。可接受
