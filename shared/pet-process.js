// Closing the overlay, shared by both plugin entry points (V1 and V2).
//
// The Electron app owns the pid file. To close promptly we stop the heartbeat
// and signal the app's pid. Only a pid we have confirmed is alive is signalled,
// so a stale pet.pid (the pet crashed, the OS recycled the pid) cannot make us
// terminate an unrelated process. The liveness probe is inherently racy, but it
// removes the common stale-file case.
//
// `options` exists so tests can redirect the files and inject a fake signal,
// mirroring the injection style of shared/state-protocol.js.
const fs = require("fs");
const { PID_FILE, HEARTBEAT_FILE } = require("./paths");
const { isProcessAlive } = require("./process-alive");

function readPetPid(pidFile = PID_FILE) {
  try {
    const pid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
  } catch {
    return 0;
  }
}

function closePetProcess(options = {}) {
  const pidFile = options.pidFile || PID_FILE;
  const heartbeatFile = options.heartbeatFile || HEARTBEAT_FILE;
  const isAlive = options.isAlive || isProcessAlive;
  const kill = options.kill || ((pid) => process.kill(pid));

  try {
    fs.unlinkSync(heartbeatFile);
  } catch {
    /* heartbeat already gone */
  }

  const pid = readPetPid(pidFile);
  if (!pid || !isAlive(pid)) return false;

  try {
    kill(pid);
  } catch {
    /* already exited between the probe and the signal */
  }
  // The pet normally removes its own pid file on exit; clean up here too so a
  // failed shutdown cannot strand a stale pid.
  try {
    fs.unlinkSync(pidFile);
  } catch {}
  return true;
}

module.exports = { readPetPid, closePetProcess };
