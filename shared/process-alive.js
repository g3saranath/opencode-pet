// Process liveness check shared by the plugin and the Electron app.
//
// `process.kill(pid, 0)` sends no signal, it only probes. The distinction that
// matters is the error code: ESRCH means no such process, whereas EPERM means
// the process exists but is owned by another user. Treating EPERM as "dead"
// would make the pet quit while opencode is still running, so only ESRCH (and
// an unparseable pid) count as gone.
function isProcessAlive(pid) {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== "ESRCH";
  }
}

module.exports = { isProcessAlive };
