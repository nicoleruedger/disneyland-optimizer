/* Disneyland Day Optimizer — greedy scheduler
 * Works in browser (window.Scheduler) and Node (module.exports).
 *
 * plan = optimize(DATA, {
 *   ratings: { [rideId]: 1..5 },        // rides you want; unrated = skipped
 *   arrival: "09:00", departure: "22:00",
 *   startPark: "DL",                     // "DL" | "DCA"
 *   liveWaits: { [rideId]: minutes },    // optional; overrides curve "now"
 *   nowMinutes: null,                    // optional; when liveWaits was fetched
 * })
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Scheduler = factory();
})(typeof self !== "undefined" ? self : this, function () {

  function toMin(hhmm) {
    var p = hhmm.split(":");
    return parseInt(p[0], 10) * 60 + parseInt(p[1] || 0, 10);
  }
  function toHHMM(min) {
    var h = Math.floor(min / 60), m = Math.round(min % 60);
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }

  // Expected wait for a ride at absolute minute t (linear interp between hours).
  // If a live wait exists and t is within 90 min of the live snapshot, blend
  // live -> typical as we look further into the future.
  function expectedWait(ride, t, liveWaits, nowMinutes, waitScale) {
    waitScale = waitScale || 1;
    var hours = Object.keys(ride.typicalWait).map(Number).sort(function (a, b) { return a - b; });
    var h = t / 60;
    var lo = Math.max(hours[0], Math.min(hours[hours.length - 1], Math.floor(h)));
    var hi = Math.min(hours[hours.length - 1], lo + 1);
    var w0 = ride.typicalWait[String(lo)], w1 = ride.typicalWait[String(hi)];
    var frac = Math.min(1, Math.max(0, h - lo));
    var typical = (w0 + (w1 - w0) * frac) * waitScale;

    if (liveWaits && liveWaits[ride.id] != null && nowMinutes != null) {
      var age = Math.abs(t - nowMinutes);
      if (age <= 90) {
        var trust = 1 - age / 90; // 1 now -> 0 at 90 min out
        return liveWaits[ride.id] * trust + typical * (1 - trust);
      }
    }
    return typical;
  }

  function optimize(DATA, opts) {
    var ratings = opts.ratings || {};
    var t = toMin(opts.arrival || "09:00");
    var end = toMin(opts.departure || "22:00");
    var startPark = opts.startPark || "DL";
    var liveWaits = opts.liveWaits || null;
    var nowMinutes = opts.nowMinutes != null ? opts.nowMinutes : null;
    var waitScale = opts.waitScale || 1; // day-of-week crowd multiplier

    var byId = {};
    DATA.rides.forEach(function (r) { byId[r.id] = r; });

    var todo = Object.keys(ratings)
      .filter(function (id) { return ratings[id] > 0 && byId[id]; })
      .map(function (id) { return byId[id]; });

    // start at a given land, or the entrance-most land of the starting park
    var loc = opts.startLand ||
      (startPark === "DCA" ? "DCA|Hollywood Land" : "DL|Main Street U.S.A.");
    var steps = [], skipped = [];
    var totals = { rides: 0, wait: 0, walk: 0, onRide: 0 };

    while (todo.length) {
      var best = null, bestScore = -1;
      for (var i = 0; i < todo.length; i++) {
        var r = todo[i];
        var walk = DATA.walkMatrix[loc][r.landKey];
        var wait = expectedWait(r, t + walk, liveWaits, nowMinutes, waitScale);
        var cost = walk + wait + r.duration;
        if (t + cost > end) continue; // doesn't fit
        // rating^2 so a 5-star headliner beats cheap low-rated filler
        var score = Math.pow(ratings[r.id], 2) / cost;
        // tiny bonus for staying in the current land: breaks ties toward clustering
        if (r.landKey === loc) score *= 1.15;
        if (score > bestScore) { bestScore = score; best = { r: r, walk: walk, wait: wait }; }
      }
      if (!best) break;

      var r2 = best.r;
      steps.push({
        rideId: r2.id, landKey: r2.landKey,
        start: toHHMM(t),
        board: toHHMM(t + best.walk + best.wait),
        done: toHHMM(t + best.walk + best.wait + r2.duration),
        ride: r2.name, park: r2.park, land: r2.land,
        walk: Math.round(best.walk), wait: Math.round(best.wait),
        duration: r2.duration, rating: ratings[r2.id],
      });
      totals.rides++; totals.wait += best.wait; totals.walk += best.walk; totals.onRide += r2.duration;
      t += best.walk + best.wait + r2.duration;
      loc = r2.landKey;
      todo.splice(todo.indexOf(r2), 1);
    }

    todo.forEach(function (r) { skipped.push(r.name); });
    totals.wait = Math.round(totals.wait);
    totals.walk = Math.round(totals.walk);
    return { steps: steps, skipped: skipped, totals: totals, endOfPlan: toHHMM(t) };
  }

  return { optimize: optimize, expectedWait: expectedWait, toMin: toMin, toHHMM: toHHMM };
});
