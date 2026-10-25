/**
 * Hungarian (Kuhn-Munkres) Algorithm for optimal minimum-cost bipartite assignment.
 * Solves N x M cost matrix in O(N^3).
 */

/**
 * Solves the assignment problem for cost matrix.
 * @param {Array<Array<number>>} cost Square matrix N x N (values >= 0)
 * @returns {Array<number>} Array of length N where result[i] is the matched column j (-1 if unassigned)
 */
export function hungarian(cost) {
  const n = cost.length;
  if (n === 0) return [];
  const m = cost[0].length;
  if (m === 0) return [];

  // Work with n <= m (pad/transpose conceptually)
  const u = new Float32Array(n + 1);
  const v = new Float32Array(m + 1);
  const p = new Int32Array(m + 1);
  const way = new Int32Array(m + 1);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float32Array(m + 1).fill(Infinity);
    const used = new Uint8Array(m + 1);

    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;

      for (let j = 1; j <= m; j++) {
        if (!used[j]) {
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
      }

      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }

  const rowToCol = new Int32Array(n).fill(-1);
  for (let j = 1; j <= m; j++) {
    if (p[j] > 0 && p[j] <= n) {
      rowToCol[p[j] - 1] = j - 1;
    }
  }

  return Array.from(rowToCol);
}
