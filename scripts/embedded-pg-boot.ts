/**
 * Embedded Postgres boot for ConTrack verification.
 *
 * NOTE (adaptation): @embedded-postgres/linux-x64 v18.6.0-beta.19 exports ONLY the
 * binary paths (pg_ctl / initdb / postgres) — the EmbeddedPostgres class lives in the
 * (uninstalled) `embedded-postgres` wrapper package. This script therefore drives the
 * same native binaries directly, replicating the class behaviour:
 *   initialise() -> start() -> createDatabase("contrack") -> print PG-READY -> keep alive
 */
import { spawnSync } from "child_process";
import { existsSync, writeFileSync, rmSync } from "fs";
import net from "node:net";

const PKG_DIR = "/home/z/my-project/node_modules/@embedded-postgres/linux-x64";
const INITDB = `${PKG_DIR}/native/bin/initdb`;
const PG_CTL = `${PKG_DIR}/native/bin/pg_ctl`;
const POSTGRES = `${PKG_DIR}/native/bin/postgres`;

const DATA_DIR = "/home/z/my-project/.embedded-pgdata";
const PORT = 54329;
const PG_LOG = "/tmp/embedded-pg-pgctl.log";
const USER = "postgres";
const PASSWORD = "postgres";
const DB = "contrack";

// The shipped binaries link against ICU 60 (libicuuc.so.60 / libicui18n.so.60) which the
// system does not provide (system ICU is 76). The package ships ICU 60.2 in native/lib,
// but bun does not run the postinstall symlink-hydration script, so the SONAME symlinks
// are missing. They were created under /tmp/ctrk-pg-libs and are injected via LD_LIBRARY_PATH.
const NATIVE_LIB = `${PKG_DIR}/native/lib`;
const EXTRA_LIB = "/tmp/ctrk-pg-libs";
const CHILD_ENV = {
  ...process.env,
  LD_LIBRARY_PATH: `${NATIVE_LIB}:${EXTRA_LIB}${process.env.LD_LIBRARY_PATH ? ":" + process.env.LD_LIBRARY_PATH : ""}`,
};

function sh(cmd: string, args: string[], input?: string) {
  return spawnSync(cmd, args, { input, encoding: "utf8", env: CHILD_ENV });
}

// ---- initialise() ----
if (!existsSync(`${DATA_DIR}/PG_VERSION`)) {
  const pwfile = "/tmp/embedded-pg-pwfile";
  writeFileSync(pwfile, PASSWORD + "\n");
  const r = sh(INITDB, [
    "-D", DATA_DIR,
    "-U", USER,
    "-A", "password",
    `--pwfile=${pwfile}`,
    "-E", "UTF8",
  ]);
  if (r.status !== 0) {
    console.error("PG-INITDB-FAILED");
    console.error((r.stderr || r.stdout || "").split("\n").slice(-15).join("\n"));
    process.exit(1);
  }
  console.log("PG-INIT-OK");
} else {
  console.log("PG-INIT-SKIP (existing datadir)");
}

// ---- createDatabase("contrack") while server is stopped (single-user mode) ----
{
  const r = sh(POSTGRES, ["--single", "-D", DATA_DIR, USER], `CREATE DATABASE ${DB};\n`);
  const err = (r.stderr || "") + (r.stdout || "");
  if (r.status !== 0) {
    if (/already exists/i.test(err)) console.log("PG-CREATEDB-SKIP (already exists)");
    else console.log("PG-CREATEDB-WARN:", err.trim().split("\n").slice(-3).join(" | "));
  } else {
    console.log("PG-CREATEDB-OK");
  }
}

// ---- start() ----
const startArgs = [
  "-D", DATA_DIR,
  "-l", PG_LOG,
  "-o", `-p ${PORT} -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp`,
  "start",
];
let st = sh(PG_CTL, ["-D", DATA_DIR, "status"]);
if (st.status === 0) {
  console.log("PG-START-SKIP (server already running)");
} else {
  let start = sh(PG_CTL, startArgs);
  if (start.status !== 0) {
    // stale postmaster.pid from a previous crash — clear it and retry once
    rmSync(`${DATA_DIR}/postmaster.pid`, { force: true });
    start = sh(PG_CTL, startArgs);
  }
  if (start.status !== 0) {
    console.error("PG-START-FAILED");
    console.error((start.stderr || "") + (start.stdout || ""));
    try {
      const log = await Bun.file(PG_LOG).text();
      console.error(log.split("\n").slice(-15).join("\n"));
    } catch {}
    process.exit(1);
  }
  console.log("PG-START-OK");
}

// ---- wait for port ----
function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    s.on("connect", () => { s.destroy(); resolve(true); });
    s.on("error", () => resolve(false));
  });
}
let open = false;
for (let i = 0; i < 90; i++) {
  if (await portOpen(PORT)) { open = true; break; }
  await new Promise((r) => setTimeout(r, 1000));
}
if (!open) {
  console.error("PG-PORT-NEVER-OPENED");
  process.exit(1);
}

console.log(`PG-READY postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DB}`);
setInterval(() => {}, 1 << 30); // keep alive
