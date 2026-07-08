// Wait till the browser is ready to render the game (avoids glitches)
window.requestAnimationFrame(function () {
  var gm = new GameManager(4, KeyboardInputManager, HTMLActuator, LocalStorageManager);

  // playtest-crew fork: state adapter. Reads the game's internal state
  // synchronously (no DOM race with the rAF-deferred actuator).
  // Hash-safe: integers and booleans only.
  window.__ptc_state = function () {
    var cells = gm.grid.serialize().cells;
    var grid = cells.map(function (column) {
      return column.map(function (cell) { return cell ? cell.value : 0; });
    });
    return { grid: grid, score: gm.score, over: gm.over, won: !!gm.won };
  };
});
