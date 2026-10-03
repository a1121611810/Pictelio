// PROTOTYPE / THROWAWAY —— JS 侧首帧管线埋点（2026-10-04 原型，测完即删）
//
// 目的：抓官方口径的 LoadBundleEntry，把首帧拆成
//       parse / loadBackground / mtsRender / resolve / layout / paint。
//       文档要求「listener 越早注册越好」——它只在初次渲染完成时触发一次，
//       所以必须挂在 import 之后、app.mount() 之前的顶层。
//
// 取全局对象的事实依据：utils/tokenStorage.ts 注明 lynx runtime 的
// NativeModules 是**裸全局、不在 globalThis 上**（真机实测），
// 先试裸名再回落 globalThis。
//
// 实测结论：**这个通道是死的**——observer 注册成功但一条条目都不投递，
// 与 LynxView.forceGetPerf() 返回 null、onFirstLoadPerfReady 不触发同根因。
// 原生分段计时（LynxActivity 的 PICO_PROTO 埋点）才是本原型实际用的判据。
//
// @ts-expect-error 原型期：lynp 性能 API 未进 rspeedy-env.d.ts
const _nm: any = (typeof NativeModules !== 'undefined' ? NativeModules : undefined) ??
  (globalThis as any).NativeModules

const collectLoadBundle = (): void => {
  try {
    // @ts-expect-error 原型期：lynx 也是裸全局
    const perf = (typeof lynx !== 'undefined' ? lynx : undefined) ?? (globalThis as any).lynx
    const observer = perf.performance.createObserver((entry: any) => {
      // 不做筛选：先确认 observer 到底收不收得到东西
      console.log('LB_any', entry?.entryType, entry?.name, entry?.identifier)
      if (entry?.name?.startsWith?.('loadBundle')) {
        console.log('LB_full', JSON.stringify(entry))
      }
    })
    observer.observe(['pipeline'])
    console.log('LB_perf_keys', Object.keys(perf?.performance ?? {}).join(','))
  } catch (e) {
    console.log('LB_observer_error', String(e))
  }
}
collectLoadBundle()
