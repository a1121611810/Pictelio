#!/usr/bin/env node

/**
 * kill-dev-server.mjs
 *
 * 安全终止 pixivizer monorepo 开发服务器占用的端口进程。
 *
 * 设计目标：
 * - 高可维护性：单一脚本，常量/函数分离，详尽注释，自文档化 CLI。
 * - 高性能：仅执行少量必要系统调用，无第三方依赖，启动即执行。
 * - 高安全性：只终止由本项目目录启动的进程，拒绝误杀外部服务；
 *   默认交互确认，--force 才跳过；先 SIGTERM 再 SIGKILL。
 * - 低内存占用：原生 Node.js 子进程调用，无第三方依赖。
 * - 跨平台：macOS/Unix 用 lsof + ps，Windows 用 netstat + taskkill。
 *
 * 用法：
 *   node scripts/kill-dev-server.mjs app                # 查看占用 app 端口(5173)的进程
 *   node scripts/kill-dev-server.mjs app --force        # 终止进程
 *   node scripts/kill-dev-server.mjs all --force        # 终止全部 dev 端口
 *   node scripts/kill-dev-server.mjs --port 4321        # 指定端口（不校验项目白名单）
 */

import { exec, execSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

// -------------------- 配置常量 --------------------

/** 包名到开发服务器端口的映射（数组表示该包可能占用的多个端口） */
const PROJECT_PORTS = {
  app: [5173],
  'app-lynx': [3000, 3001], // rspeedy 在 3000 被占时自动切到 3001
  website: [4321],
};

const PROJECT_NAME_LIST = Object.keys(PROJECT_PORTS);

/** 脚本位于 <repo>/scripts/kill-dev-server.mjs，repo 根目录是上一级 */
const SCRIPT_DIR = path.dirname(path.resolve(process.argv[1]));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

/** 优雅终止等待时间（毫秒） */
const GRACEFUL_TIMEOUT_MS = 5_000;

/** 强制终止后等待时间（毫秒） */
const KILL_WAIT_TIMEOUT_MS = 2_000;

/** 轮询进程是否退出的间隔（毫秒） */
const POLL_INTERVAL_MS = 100;

// -------------------- 日志工具 --------------------

/** 标准输出 */
function log(...args) {
  // oxlint-disable-next-line no-console
  console.log(...args);
}

/** 错误输出 */
function error(...args) {
  // oxlint-disable-next-line no-console
  console.error(...args);
}

/** 退出进程 */
function exit(code) {
  process.exit(code);
}

// -------------------- 参数解析 --------------------

/**
 * 解析命令行参数
 * @returns {{
 *   target: string | null,   // 项目名或 'all'
 *   port: number | null,     // 指定端口
 *   force: boolean,
 *   dryRun: boolean,
 *   help: boolean
 * }}
 */
function parseArgs(argv) {
  const result = {
    target: null,
    port: null,
    force: false,
    dryRun: false,
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '-h' || arg === '--help') {
      result.help = true;
    } else if (arg === '-f' || arg === '--force' || arg === '-y' || arg === '--yes') {
      result.force = true;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else if ((arg === '-p' || arg === '--port') && next && !next.startsWith('-')) {
      result.port = Number(next);
      i++;
    } else if (arg.startsWith('--port=')) {
      result.port = Number(arg.slice('--port='.length));
    } else if (arg.startsWith('-p') && arg.length > 2 && !Number.isNaN(Number(arg.slice(2)))) {
      // -p4321
      result.port = Number(arg.slice(2));
    } else if (!arg.startsWith('-') && result.target === null) {
      result.target = arg;
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }

  return result;
}

/** 打印帮助信息 */
function printHelp() {
  const lines = [
    `用法: kill-dev-server [项目名|all] [选项]

项目名:
  app         终止 packages/app 的开发服务器 (端口 ${PROJECT_PORTS.app.join('/')})`,
  ];
  for (const name of PROJECT_NAME_LIST.slice(1)) {
    lines.push(`  ${name.padEnd(10)}终止 packages/${name} 的开发服务器 (端口 ${PROJECT_PORTS[name].join('/')})`);
  }
  lines.push(`  all         终止全部开发服务器（等效 dev:all 的完整端口集）

选项:
  -p, --port <port>   指定端口，跳过项目白名单校验
  -f, --force         跳过确认，直接终止进程
  -y, --yes           同 --force
      --dry-run       只显示进程信息，不终止
  -h, --help          显示此帮助

示例:
  node scripts/kill-dev-server.mjs website --force
  pnpm run kill:all
`);
  log(lines.join('\n'));
}

// -------------------- 端口解析 --------------------

/**
 * 解析目标端口集合
 * @returns {{ ports: number[], projectName: string | null }}
 */
function resolvePorts(args) {
  if (args.port !== null) {
    if (Number.isInteger(args.port) && args.port > 0 && args.port <= 65_535) {
      return { ports: [args.port], projectName: null };
    }
    throw new Error(`无效端口: ${args.port}，必须是 1-65535 的整数`);
  }

  if (args.target === 'all') {
    // 全部端口去重
    const ports = [...new Set(PROJECT_NAME_LIST.flatMap((name) => PROJECT_PORTS[name]))];
    return { ports, projectName: null };
  }

  if (args.target && PROJECT_PORTS[args.target]) {
    return { ports: PROJECT_PORTS[args.target], projectName: args.target };
  }

  if (args.target) {
    throw new Error(`未知项目: ${args.target}。可用: ${PROJECT_NAME_LIST.join(', ')} 或 all`);
  }

  throw new Error('未指定目标，请提供项目名、all 或 --port');
}

// -------------------- 系统调用封装 --------------------

const platform = os.platform();

/**
 * 异步执行 shell 命令
 * @param {string} command
 * @returns {Promise<string>}
 */
function execAsync(command) {
  return new Promise((resolve, reject) => {
    exec(command, { encoding: 'utf8', maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err && err.code !== 1) {
        reject(err);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

/**
 * 同步执行 shell 命令并 trim 输出；lsof "无结果" 的退出码 1 视为正常空结果
 * @param {string} command
 * @returns {string}
 */
function execSyncTrim(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    // lsof 无结果时返回 1，stdout 为空，视为正常空结果
    if (err.status === 1 && (!err.stdout || err.stdout.toString().trim() === '')) {
      return '';
    }
    throw err;
  }
}

/**
 * 查找占用指定端口的监听进程 PID 列表
 * @param {number} port
 * @returns {Promise<number[]>}
 */
async function findPidsByPort(port) {
  if (platform === 'win32') {
    const output = await execAsync(`netstat -ano | findstr :${port}`);
    const pids = new Set();
    for (const line of output.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) continue;
      const state = parts[parts.length - 2];
      const pidStr = parts[parts.length - 1];
      if (state === 'LISTENING' && /^\d+$/.test(pidStr)) {
        pids.add(Number(pidStr));
      }
    }
    return Array.from(pids);
  }

  // Unix: lsof -i :PORT -sTCP:LISTEN -nP -t 直接输出 PID
  const output = execSyncTrim(`lsof -i :${port} -sTCP:LISTEN -nP -t`);
  if (!output) return [];
  return output
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map(Number);
}

/**
 * 获取进程的当前工作目录
 * @param {number} pid
 * @returns {Promise<string | null>}
 */
async function getProcessCwd(pid) {
  if (platform === 'linux') {
    try {
      return execSyncTrim(`readlink -f /proc/${pid}/cwd`);
    } catch {
      // 回退到 lsof
    }
  }

  if (platform === 'win32') {
    try {
      const output = await execAsync(
        `powershell -Command "(Get-Process -Id ${pid} -ErrorAction Stop).Path"`
      );
      // Path 是 exe 路径，不是 cwd；Windows 下 cwd 获取较复杂，这里返回 null 交给命令行校验
      return output.trim() || null;
    } catch {
      return null;
    }
  }

  // macOS / 通用 Unix
  try {
    const output = execSyncTrim(`lsof -a -p ${pid} -d cwd`);
    // 输出格式：
    // COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
    // node    65707 lilianda  cwd    DIR   1,14      832 6531621 /path/to/cwd
    const lines = output.split('\n');
    const dataLine = lines.find((l) => /\bcwd\b/.test(l));
    if (!dataLine) return null;
    const parts = dataLine.trim().split(/\s+/);
    return parts[parts.length - 1] || null;
  } catch {
    return null;
  }
}

/**
 * 获取进程命令行
 * @param {number} pid
 * @returns {Promise<string | null>}
 */
async function getProcessCommandLine(pid) {
  if (platform === 'win32') {
    try {
      const output = await execAsync(
        `powershell -Command "Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' | Select-Object -ExpandProperty CommandLine"`
      );
      return output.trim() || null;
    } catch {
      return null;
    }
  }

  try {
    return execSyncTrim(`ps -p ${pid} -o command=`);
  } catch {
    return null;
  }
}

/**
 * 检查进程是否仍在运行
 * @param {number} pid
 * @returns {boolean}
 */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 等待进程退出
 * @param {number} pid
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
async function waitForDeath(pid, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return !isProcessAlive(pid);
}

/**
 * 终止单个进程（Unix）
 * @param {number} pid
 * @param {boolean} allowSigKill 是否允许在 SIGTERM 失败后使用 SIGKILL
 * @returns {Promise<boolean>}
 */
async function terminateProcessUnix(pid, allowSigKill) {
  if (!isProcessAlive(pid)) {
    log(`  进程 ${pid} 已结束`);
    return true;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    error(`  发送 SIGTERM 到 ${pid} 失败: ${err.message}`);
    return false;
  }

  const graceful = await waitForDeath(pid, GRACEFUL_TIMEOUT_MS);
  if (graceful) {
    log(`  进程 ${pid} 已优雅终止`);
    return true;
  }

  if (!allowSigKill) {
    error(`  进程 ${pid} 在 ${GRACEFUL_TIMEOUT_MS}ms 内未退出，未执行强制终止`);
    return false;
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch (err) {
    error(`  发送 SIGKILL 到 ${pid} 失败: ${err.message}`);
    return false;
  }

  const killed = await waitForDeath(pid, KILL_WAIT_TIMEOUT_MS);
  if (killed) {
    log(`  进程 ${pid} 已强制终止`);
  } else {
    error(`  进程 ${pid} 无法终止，请检查权限`);
  }
  return killed;
}

/**
 * 终止单个进程（Windows）
 * @param {number} pid
 * @returns {Promise<boolean>}
 */
async function terminateProcessWindows(pid) {
  try {
    await execAsync(`taskkill /PID ${pid} /T /F`);
    log(`  进程 ${pid} 已强制终止`);
    return true;
  } catch (err) {
    error(`  终止进程 ${pid} 失败: ${err.message}`);
    return false;
  }
}

// -------------------- 白名单校验 --------------------

/**
 * 判断进程是否属于 pixivizer 的目标包
 * 校验策略：进程的 cwd 严格等于包目录，或命令行包含包目录的绝对路径
 * @param {number} pid
 * @param {string | null} projectName 目标包名；null 表示匹配任一包
 * @param {string | null} cwd
 * @param {string | null} cmdline
 * @returns {string | null} 命中的包名，未命中返回 null
 */
function matchProject(pid, projectName, cwd, cmdline) {
  const candidates = projectName ? [projectName] : PROJECT_NAME_LIST;

  for (const name of candidates) {
    const projectPath = path.resolve(REPO_ROOT, 'packages', name);

    // 策略 1：cwd 严格匹配包目录
    if (cwd === projectPath) {
      return name;
    }

    // 策略 2：命令行包含包目录绝对路径
    if (cmdline && cmdline.includes(projectPath)) {
      return name;
    }

    // 策略 3：命令行包含 packages/<name> 相对片段，且 cwd 在 repo 内
    if (cmdline) {
      const relativeMarker = `packages${path.sep}${name}`;
      if (cmdline.includes(relativeMarker) && cwd && cwd.startsWith(REPO_ROOT)) {
        return name;
      }
    }
  }

  return null;
}

// -------------------- 主流程 --------------------

async function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (err) {
    error(err.message);
    exit(1);
  }

  if (args.help) {
    printHelp();
    exit(0);
  }

  let ports;
  let projectName;
  try {
    ({ ports, projectName } = resolvePorts(args));
  } catch (err) {
    error(err.message);
    exit(1);
  }

  log(`🔍 检查端口 ${ports.join(', ')} 占用情况...`);

  // 收集所有端口的占用进程并做白名单过滤
  const targets = [];
  for (const port of ports) {
    const pids = await findPidsByPort(port);
    if (pids.length === 0) {
      log(`✅ 端口 ${port} 未被占用`);
      continue;
    }
    log(`⚠️  端口 ${port} 被 ${pids.length} 个进程占用:`);

    for (const pid of pids) {
      const cwd = await getProcessCwd(pid);
      const cmdline = await getProcessCommandLine(pid);

      log(`\n  PID:      ${pid}`);
      log(`  CWD:      ${cwd || '未知'}`);
      log(`  Command:  ${cmdline || '未知'}`);

      const matched = matchProject(pid, projectName, cwd, cmdline);
      if (matched) {
        targets.push({ pid, cwd, cmdline, port });
        log(`  ✅ 判定为 ${matched} 项目进程`);
      } else {
        log(`  ❌ 不是项目进程，跳过`);
      }
    }
  }

  if (targets.length === 0) {
    log(`\n✅ 未发现属于本项目的残留进程，无需处理`);
    exit(0);
  }

  if (args.dryRun) {
    log(`\n🏃 处于 --dry-run 模式，未终止进程`);
    exit(0);
  }

  if (!args.force) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await new Promise((resolve) => {
      rl.question(`\n确认终止上述 ${targets.length} 个进程? [y/N] `, resolve);
    });
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) {
      log('已取消');
      exit(0);
    }
  }

  log(`\n🛑 终止进程...`);
  let successCount = 0;
  for (const { pid, port } of targets) {
    if (platform === 'win32') {
      if (await terminateProcessWindows(pid)) successCount++;
    } else {
      if (await terminateProcessUnix(pid, true)) successCount++;
    }
  }

  if (successCount === targets.length) {
    log(`\n✅ 已清理 ${successCount} 个进程，相关端口已释放`);
    exit(0);
  } else {
    log(`\n⚠️  成功 ${successCount}/${targets.length}，请检查剩余进程`);
    exit(1);
  }
}

main().catch((err) => {
  error('未处理的错误:', err.message);
  exit(1);
});
