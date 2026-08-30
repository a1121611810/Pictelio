<template>
  <div class="root">
    <main>
      <h1>PROTOTYPE app-nuxt OTA</h1>
      <p>web 版本：<b>{{ otaVersion }}</b> ｜ bundle 指针：<b>{{ status.current }}</b> ｜ lastGood：<b>{{ status.lastGood }}</b> ｜ pending：<b>{{ status.pending ?? "—" }}</b></p>
      <p>门槛 floor：<b>{{ floor ?? "未获取" }}</b> ｜ 门槛触发：<b>{{ gateBlocked ? "是" : "否" }}</b></p>
      <button class="btn" @click="runInstall">OTA 检查并安装（{{ otaBase }}）</button>
      <pre class="log">{{ debugText }}</pre>
    </main>
    <div v-if="gateBlocked" class="gate-overlay">
      <h1>需要更新后才能继续使用</h1>
      <p>当前版本 {{ otaVersion }} 低于最低可用版本 {{ floor }}，自动更新失败：{{ gateError }}</p>
      <button class="btn" @click="runInstall">重试更新</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { registerPlugin } from "@capacitor/core";

interface OtaPluginInterface {
  status(): Promise<{ current: string; lastGood: string; pending: string | null }>;
  install(opts: { urlBase: string }): Promise<{ ok: boolean; version: string }>;
  notifyReady(opts: { version: string }): Promise<void>;
  applyNow(): Promise<void>;
  fetchGate(opts: { url: string }): Promise<{ minWebVersion: string }>;
}
const Ota = registerPlugin<OtaPluginInterface>("Ota");

const otaBase = "http://127.0.0.1:8899";
const otaVersion = useRuntimeConfig().public.otaVersion as string;
const status = ref({ current: "public", lastGood: "public", pending: null as string | null });
const floor = ref<string | null>(null);
const gateBlocked = ref(false);
const gateError = ref("");
const debugText = ref("（OTA 原型就绪）");

function log(msg: string) {
  console.log(`[OTAPROTO] ${msg}`);
  debugText.value = `${new Date().toISOString().slice(11, 23)}  ${msg}\n` + debugText.value;
}

function isNewer(min: string, cur: string): boolean {
  const n = (s: string) => s.replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
  const a = n(min), b = n(cur);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
}

async function runInstall() {
  log("install 开始…");
  try {
    const r = await Ota.install({ urlBase: otaBase });
    log(`install-ok version=${r.version} → pending，重启后生效`);
    gateError.value = "";
  } catch (e) {
    log(`install-rejected ${e}`);
    gateError.value = String(e);
  }
}

onMounted(async () => {
  try {
    status.value = await Ota.status();
    log(`status current=${status.value.current} lastGood=${status.value.lastGood} pending=${status.value.pending ?? "—"}`);
  } catch (e) {
    log("status failed: " + e);
  }
  // 健康上报：页面可交互即 ready（broken bundle 永远走不到这里 → 超时回滚）
  setTimeout(() => Ota.notifyReady({ version: otaVersion }).catch(() => {}), 800);
  // 强制门槛检查（#243 语义）：floor > 当前版本 → 先尝试 OTA 自愈，失败才阻断
  try {
    const v = await Ota.fetchGate({ url: `${otaBase}/version.json` });
    floor.value = v.minWebVersion;
    if (isNewer(v.minWebVersion, otaVersion)) {
      log(`gate-triggered floor=${v.minWebVersion} > current=${otaVersion} → 先尝试 OTA 自愈`);
      gateBlocked.value = true;
      await selfHeal();
      return;
    }
    log(`gate-ok floor=${v.minWebVersion} ≤ current=${otaVersion}`);
  } catch (e) {
    log("gate skip（floor 不可达，fail-open）: " + e);
  }
  // 启动即检查更新（updateService 语义）：静默安装到 pending，下次启动生效
  await runInstall();
});

async function selfHeal() {
  try {
    const r = await Ota.install({ urlBase: otaBase });
    log(`gate self-heal ok version=${r.version} → applyNow + reload`);
    await Ota.applyNow();
    location.reload();
    return true;
  } catch (e) {
    log(`gate self-heal failed: ${e} → 阻断`);
    gateError.value = String(e);
    return false;
  }
}
</script>

<style>
.root { font-family: system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px 16px; color: #1a1a1a; }
.root p, .root h1 { margin: 8px 0; }
.root .btn { display: inline-block; padding: 10px 18px; margin: 8px 0; background: #d97706; color: #fff; border: none; border-radius: 8px; font-size: 15px; cursor: pointer; }
.root .log { background: #f4f4f5; padding: 12px; border-radius: 8px; overflow: auto; font-size: 12px; white-space: pre-wrap; }
.gate-overlay { position: fixed; inset: 0; background: #fff; z-index: 9; padding: 48px 24px; text-align: center; }
.gate-overlay h1 { font-size: 22px; }
</style>
