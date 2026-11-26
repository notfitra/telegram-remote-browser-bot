import os from 'node:os';
import fs from 'node:fs';

export interface SystemStats {
  cpuCores: number;
  cpuUsagePercent: number;
  loadAvg1m: number;
  memTotalMB: number;
  memUsedMB: number;
  memFreeMB: number;
  memUsagePercent: number;
  diskTotalGB: number;
  diskUsedGB: number;
  diskFreeGB: number;
  diskUsagePercent: number;
  processRssMB: number;
  uptimeSeconds: number;
  activeBrowserSessions: number;
}

function readCpuTimes() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.idle +
      cpu.times.irq;
  }
  return { idle, total };
}

function readCgroupMemoryLimitBytes(): number | null {
  // Cgroup v2 (Podman/Docker modern)
  try {
    const v2 = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
    if (v2 && v2 !== 'max') {
      const val = Number(v2);
      if (Number.isFinite(val) && val > 0 && val < os.totalmem()) return val;
    }
  } catch {
    // Abaikan jika bukan cgroup v2
  }

  // Cgroup v1
  try {
    const v1 = fs.readFileSync('/sys/fs/cgroup/memory/memory.limit_in_bytes', 'utf8').trim();
    const val = Number(v1);
    if (Number.isFinite(val) && val > 0 && val < os.totalmem()) return val;
  } catch {
    // Abaikan jika bukan cgroup v1
  }

  return null;
}

function readCgroupMemoryUsageBytes(): number | null {
  try {
    const v2 = fs.readFileSync('/sys/fs/cgroup/memory.current', 'utf8').trim();
    const val = Number(v2);
    if (Number.isFinite(val) && val > 0) return val;
  } catch {
    // Abaikan
  }

  try {
    const v1 = fs.readFileSync('/sys/fs/cgroup/memory/memory.usage_in_bytes', 'utf8').trim();
    const val = Number(v1);
    if (Number.isFinite(val) && val > 0) return val;
  } catch {
    // Abaikan
  }

  return null;
}

function readDiskStats(mountPath = '/'): {
  diskTotalGB: number;
  diskUsedGB: number;
  diskFreeGB: number;
  diskUsagePercent: number;
} {
  try {
    const s = fs.statfsSync(mountPath);
    const totalBytes = Number(s.blocks) * Number(s.bsize);
    const freeBytes = Number(s.bavail) * Number(s.bsize);
    const usedBytes = Math.max(0, totalBytes - freeBytes);

    const toGB = (b: number) => Number((b / (1024 * 1024 * 1024)).toFixed(1));
    const totalGB = toGB(totalBytes);
    const usedGB = toGB(usedBytes);
    const freeGB = toGB(freeBytes);
    const percent = totalBytes > 0 ? Number(((usedBytes / totalBytes) * 100).toFixed(1)) : 0;

    return {
      diskTotalGB: totalGB,
      diskUsedGB: usedGB,
      diskFreeGB: freeGB,
      diskUsagePercent: percent,
    };
  } catch {
    return {
      diskTotalGB: 0,
      diskUsedGB: 0,
      diskFreeGB: 0,
      diskUsagePercent: 0,
    };
  }
}

export async function getSystemStats(activeBrowserSessions: number): Promise<SystemStats> {
  const start = readCpuTimes();
  await new Promise((r) => setTimeout(r, 250));
  const end = readCpuTimes();

  const idleDiff = end.idle - start.idle;
  const totalDiff = end.total - start.total;
  const cpuUsagePercent =
    totalDiff > 0 ? Math.max(0, Math.min(100, ((totalDiff - idleDiff) / totalDiff) * 100)) : 0;

  const totalBytes = readCgroupMemoryLimitBytes() ?? os.totalmem();
  const cgroupUsed = readCgroupMemoryUsageBytes();
  const usedBytes =
    cgroupUsed !== null && cgroupUsed <= totalBytes
      ? cgroupUsed
      : totalBytes - os.freemem();
  const freeBytes = Math.max(0, totalBytes - usedBytes);

  const disk = readDiskStats('/');
  const toMB = (b: number) => Math.round(b / (1024 * 1024));

  return {
    cpuCores: os.cpus().length,
    cpuUsagePercent: Number(cpuUsagePercent.toFixed(1)),
    loadAvg1m: Number(os.loadavg()[0].toFixed(2)),
    memTotalMB: toMB(totalBytes),
    memUsedMB: toMB(usedBytes),
    memFreeMB: toMB(freeBytes),
    memUsagePercent: Number(((usedBytes / totalBytes) * 100).toFixed(1)),
    diskTotalGB: disk.diskTotalGB,
    diskUsedGB: disk.diskUsedGB,
    diskFreeGB: disk.diskFreeGB,
    diskUsagePercent: disk.diskUsagePercent,
    processRssMB: toMB(process.memoryUsage().rss),
    uptimeSeconds: Math.floor(process.uptime()),
    activeBrowserSessions,
  };
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}h`);
  if (h > 0 || d > 0) parts.push(`${h}j`);
  parts.push(`${m}m`);
  return parts.join(' ');
}
