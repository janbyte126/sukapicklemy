import { useState, useMemo } from "react";
import { Plus, X, Shuffle, RefreshCw, Trophy } from "lucide-react";

// ---- Design tokens ----
// Deep navy court #1B2A4A (primary, borders, headers)
// Coral accent    #FF6B4A (winner highlight, kitchen line)
// Warm sand bg    #FBF0E4   Peach label accent #F4834F

const FONT_IMPORT = `
@import url('https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;900&family=Space+Grotesk:wght@400;500;600&display=swap');
`;

function nextPowerOf2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function buildBracket(players) {
  const size = nextPowerOf2(players.length);
  const seeded = [...players];
  while (seeded.length < size) seeded.push(null); // bye

  // standard bracket seeding order for fairness
  const order = seedOrder(size);
  const slots = order.map((seedIdx) => seeded[seedIdx] ?? null);

  const round0 = [];
  for (let i = 0; i < slots.length; i += 2) {
    const p1 = slots[i];
    const p2 = slots[i + 1];
    round0.push({
      id: `r0-${i / 2}`,
      p1,
      p2,
      score1: "",
      score2: "",
      winner: p2 == null ? p1 : p1 == null ? p2 : null,
    });
  }

  const rounds = [round0];
  let count = round0.length;
  let r = 1;
  while (count > 1) {
    count = count / 2;
    const round = [];
    for (let i = 0; i < count; i++) {
      round.push({
        id: `r${r}-${i}`,
        p1: null,
        p2: null,
        score1: "",
        score2: "",
        winner: null,
      });
    }
    rounds.push(round);
    r++;
  }
  return propagateByes(rounds);
}

// Recursive standard tournament seed order, e.g. size 8 -> [1,8,5,4,3,6,7,2] (0-indexed)
function seedOrder(size) {
  if (size === 1) return [0];
  const prev = seedOrder(size / 2);
  const out = [];
  prev.forEach((s) => {
    out.push(s);
    out.push(size - 1 - s);
  });
  return out;
}

function propagateByes(rounds) {
  const next = rounds.map((round) => round.map((m) => ({ ...m })));
  for (let r = 0; r < next.length - 1; r++) {
    next[r].forEach((m, i) => {
      if (m.winner) {
        const target = next[r + 1][Math.floor(i / 2)];
        if (i % 2 === 0) target.p1 = m.winner;
        else target.p2 = m.winner;
      }
    });
  }
  // re-run once more in case a second round became a bye-vs-bye advance
  for (let r = 0; r < next.length - 1; r++) {
    next[r].forEach((m, i) => {
      if (!m.winner && (m.p1 == null || m.p2 == null) && (m.p1 || m.p2)) {
        m.winner = m.p1 || m.p2;
        const target = next[r + 1][Math.floor(i / 2)];
        if (i % 2 === 0) target.p1 = m.winner;
        else target.p2 = m.winner;
      }
    });
  }
  return next;
}

function roundLabel(roundIdx, totalRounds) {
  const remaining = totalRounds - roundIdx;
  if (remaining === 1) return "FINAL";
  if (remaining === 2) return "SEMIFINALS";
  if (remaining === 3) return "QUARTERFINALS";
  return `ROUND ${roundIdx + 1}`;
}

// Round-robin schedule via the circle method: every player faces every
// other player exactly once, spread across the minimum number of rounds.
// Deterministic given roundIndex, so a single round can be recomputed later
// to extend an existing schedule without disturbing earlier rounds.
function buildLeagueRound(players, roundIndex) {
  const list = [...players];
  if (list.length % 2 !== 0) list.push(null); // bye slot
  const n = list.length;
  const half = n / 2;

  let arr = [...list];
  for (let i = 0; i < roundIndex % (n - 1); i++) {
    arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];
  }

  const round = [];
  for (let i = 0; i < half; i++) {
    const p1 = arr[i];
    const p2 = arr[n - 1 - i];
    if (p1 == null || p2 == null) continue; // skip bye match
    round.push({
      id: `l${roundIndex}-${i}`,
      p1,
      p2,
      score1: "",
      score2: "",
      winner: null,
    });
  }
  return round;
}

function buildLeague(players) {
  const numRounds = players.length % 2 === 0 ? players.length - 1 : players.length;
  const rounds = [];
  for (let r = 0; r < numRounds; r++) {
    const round = buildLeagueRound(players, r);
    if (round.length) rounds.push(round);
  }
  return rounds;
}

function computeStandings(rosterNames, leagueRounds, isMixer) {
  const table = {};
  rosterNames.forEach((p) => {
    table[p] = { name: p, wins: 0, losses: 0, pf: 0, pa: 0, played: 0 };
  });
  leagueRounds.flat().forEach((m) => {
    const s1 = parseInt(m.score1, 10);
    const s2 = parseInt(m.score2, 10);
    if (isNaN(s1) || isNaN(s2) || s1 === s2) return;
    const side1 = isMixer ? m.p1Individuals : [m.p1];
    const side2 = isMixer ? m.p2Individuals : [m.p2];
    if (!side1 || !side2) return;
    side1.forEach((name) => {
      const row = table[name];
      if (!row) return;
      row.played += 1;
      row.pf += s1;
      row.pa += s2;
    });
    side2.forEach((name) => {
      const row = table[name];
      if (!row) return;
      row.played += 1;
      row.pf += s2;
      row.pa += s1;
    });
    const winSide = s1 > s2 ? side1 : side2;
    const loseSide = s1 > s2 ? side2 : side1;
    winSide.forEach((name) => table[name] && (table[name].wins += 1));
    loseSide.forEach((name) => table[name] && (table[name].losses += 1));
  });
  return Object.values(table).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    const diffA = a.pf - a.pa;
    const diffB = b.pf - b.pa;
    if (diffB !== diffA) return diffB - diffA;
    return b.pf - a.pf;
  });
}

function shuffleArray(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const partnerKey = (a, b) => [a, b].sort().join("::");

// Builds a single "mixer" round: randomly re-pairs individual players into
// fresh teams, then those teams face off. Tries a handful of shuffles to
// minimize repeat partnerships already recorded in `history` (mutated with
// this round's pairings before returning). Anyone left over when the roster
// doesn't divide evenly sits out.
function buildOneMixerRound(players, history, roundIndex) {
  let bestTeams = null;
  let bestSitOut = null;
  let bestRepeats = Infinity;

  for (let attempt = 0; attempt < 60; attempt++) {
    const shuffled = shuffleArray(players);
    const sitOut = shuffled.length % 2 === 1 ? [shuffled[shuffled.length - 1]] : [];
    const usable = sitOut.length ? shuffled.slice(0, -1) : shuffled;
    const teams = [];
    for (let i = 0; i < usable.length; i += 2) {
      teams.push([usable[i], usable[i + 1]]);
    }
    const repeats = teams.filter((t) => history.has(partnerKey(t[0], t[1]))).length;
    if (repeats < bestRepeats) {
      bestRepeats = repeats;
      bestTeams = teams;
      bestSitOut = sitOut;
      if (repeats === 0) break;
    }
  }

  bestTeams.forEach((t) => history.add(partnerKey(t[0], t[1])));
  const teamOrder = shuffleArray(bestTeams);
  const matches = [];
  const sittingThisRound = [...bestSitOut];

  for (let i = 0; i < teamOrder.length; i += 2) {
    if (i + 1 < teamOrder.length) {
      const t1 = teamOrder[i];
      const t2 = teamOrder[i + 1];
      matches.push({
        id: `m${roundIndex}-${i / 2}`,
        p1: t1.join(" / "),
        p2: t2.join(" / "),
        p1Individuals: t1,
        p2Individuals: t2,
        score1: "",
        score2: "",
        winner: null,
      });
    } else {
      sittingThisRound.push(...teamOrder[i]);
    }
  }

  return { matches, sitting: sittingThisRound };
}

function buildMixerLeague(players, numRounds) {
  const history = new Set();
  const rounds = [];
  const sitting = [];
  for (let r = 0; r < numRounds; r++) {
    const { matches, sitting: sit } = buildOneMixerRound(players, history, r);
    rounds.push(matches);
    sitting.push(sit);
  }
  return { rounds, sitting };
}

// Rebuilds the partner-history set from rounds already on screen, so an
// added round avoids repeating pairings that already happened.
function partnerHistoryFrom(leagueRounds) {
  const history = new Set();
  leagueRounds.forEach((round) => {
    round.forEach((m) => {
      if (m.p1Individuals) history.add(partnerKey(m.p1Individuals[0], m.p1Individuals[1]));
      if (m.p2Individuals) history.add(partnerKey(m.p2Individuals[0], m.p2Individuals[1]));
    });
  });
  return history;
}

export default function App() {
  const [tournamentName, setTournamentName] = useState("Suka Pickle");
  const [mode, setMode] = useState("singles"); // "singles" | "doubles"
  const [randomPartners, setRandomPartners] = useState(false);
  const [mixerRoundCount, setMixerRoundCount] = useState(4);
  const [playerInput, setPlayerInput] = useState("");
  const [partnerInput, setPartnerInput] = useState("");
  const [players, setPlayers] = useState([]);
  const [rounds, setRounds] = useState(null);
  const [format, setFormat] = useState("bracket"); // "bracket" | "league"
  const [leagueRounds, setLeagueRounds] = useState(null);
  const [sittingRounds, setSittingRounds] = useState(null);

  const isMixer = mode === "doubles" && format === "league" && randomPartners;
  const usesIndividualEntry = mode === "singles" || isMixer;
  const canGenerate = players.length >= 2;
  const isLive = format === "bracket" ? !!rounds : !!leagueRounds;
  const entrantLabel = mode === "doubles" && !isMixer ? "Teams" : "Players";

  const addPlayer = () => {
    const name = playerInput.trim();
    if (!name) return;
    if (usesIndividualEntry) {
      setPlayers((p) => [...p, name]);
    } else {
      const partner = partnerInput.trim();
      if (!partner) return;
      setPlayers((p) => [...p, `${name} / ${partner}`]);
      setPartnerInput("");
    }
    setPlayerInput("");
  };

  const removePlayer = (idx) => {
    setPlayers((p) => p.filter((_, i) => i !== idx));
  };

  const changeMode = (m) => {
    setMode(m);
    setRandomPartners(false);
    setPlayers([]);
    setPlayerInput("");
    setPartnerInput("");
  };

  const changeFormat = (f) => {
    setFormat(f);
    if (f !== "league") setRandomPartners(false);
    setPlayers([]);
    setPlayerInput("");
    setPartnerInput("");
  };

  const toggleRandomPartners = () => {
    setRandomPartners((v) => !v);
    setPlayers([]);
    setPlayerInput("");
    setPartnerInput("");
  };

  const shuffle = () => {
    setPlayers((p) => {
      const arr = [...p];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    });
  };

  const generate = () => {
    if (format === "bracket") {
      setRounds(buildBracket(players));
    } else if (isMixer) {
      const { rounds: r, sitting } = buildMixerLeague(players, mixerRoundCount);
      setLeagueRounds(r);
      setSittingRounds(sitting);
    } else {
      setLeagueRounds(buildLeague(players));
      setSittingRounds(null);
    }
  };

  const reset = () => {
    setRounds(null);
    setLeagueRounds(null);
    setSittingRounds(null);
  };

  const addRound = () => {
    if (!leagueRounds) return;
    const nextIdx = leagueRounds.length;
    if (isMixer) {
      const history = partnerHistoryFrom(leagueRounds);
      const { matches, sitting } = buildOneMixerRound(players, history, nextIdx);
      setLeagueRounds((prev) => [...prev, matches]);
      setSittingRounds((prev) => [...(prev || []), sitting]);
    } else {
      const round = buildLeagueRound(players, nextIdx);
      if (!round.length) return;
      setLeagueRounds((prev) => [...prev, round]);
    }
  };

  const setLeagueScore = (roundIdx, matchId, which, value) => {
    setLeagueRounds((prev) => {
      const next = prev.map((round) => round.map((m) => ({ ...m })));
      const match = next[roundIdx].find((m) => m.id === matchId);
      if (!match) return prev;
      if (which === 1) match.score1 = value;
      else match.score2 = value;

      const s1 = parseInt(match.score1, 10);
      const s2 = parseInt(match.score2, 10);
      match.winner =
        !isNaN(s1) && !isNaN(s2) && s1 !== s2 ? (s1 > s2 ? match.p1 : match.p2) : null;
      return next;
    });
  };

  const setScore = (roundIdx, matchId, which, value) => {
    setRounds((prev) => {
      const next = prev.map((round) => round.map((m) => ({ ...m })));
      const round = next[roundIdx];
      const match = round.find((m) => m.id === matchId);
      if (!match) return prev;
      if (which === 1) match.score1 = value;
      else match.score2 = value;

      const s1 = parseInt(match.score1, 10);
      const s2 = parseInt(match.score2, 10);
      let winner = null;
      if (match.p1 && match.p2 && !isNaN(s1) && !isNaN(s2) && s1 !== s2) {
        winner = s1 > s2 ? match.p1 : match.p2;
      }
      match.winner = winner;

      // clear downstream if winner changed
      for (let r = roundIdx + 1; r < next.length; r++) {
        next[r].forEach((m) => {
          m.p1 = null;
          m.p2 = null;
          m.score1 = "";
          m.score2 = "";
          m.winner = null;
        });
      }
      return propagateByes(next);
    });
  };

  const champion = rounds ? rounds[rounds.length - 1][0]?.winner : null;

  return (
    <div
      className="min-h-screen w-full"
      style={{ background: "#FBF0E4", color: "#1B2A4A" }}
    >
      <style>{FONT_IMPORT}</style>
      <div style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
        {/* Header */}
        <header
          className="px-6 md:px-10 py-8 border-b-4"
          style={{ borderColor: "#1B2A4A" }}
        >
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <div
                className="text-xs tracking-[0.3em] mb-2 font-semibold"
                style={{ color: "#F4834F" }}
              >
                PICKLEBALL &middot; {format === "bracket" ? "SINGLE ELIMINATION" : "LEAGUE"}
              </div>
              <input
                value={tournamentName}
                onChange={(e) => setTournamentName(e.target.value)}
                className="bg-transparent border-none outline-none w-full"
                style={{
                  fontFamily: "'Big Shoulders Display', sans-serif",
                  fontWeight: 900,
                  fontSize: "clamp(2rem, 6vw, 3.5rem)",
                  lineHeight: 1,
                  color: "#1B2A4A",
                }}
                placeholder="Tournament name"
              />
            </div>
            {isLive && (
              <button
                onClick={reset}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold self-start"
                style={{
                  border: "2px solid #1B2A4A",
                  color: "#1B2A4A",
                }}
              >
                <RefreshCw size={16} /> Edit players
              </button>
            )}
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-6 md:px-10 py-10">
          {!isLive ? (
            <div className="max-w-xl">
              <h2
                className="text-lg font-semibold mb-3"
                style={{ color: "#1B2A4A" }}
              >
                Play type
              </h2>
              <div className="flex gap-3 mb-8">
                {[
                  { key: "singles", label: "Singles", sub: "1 vs 1" },
                  { key: "doubles", label: "Doubles", sub: "Team of 2 vs team of 2" },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => changeMode(opt.key)}
                    className="flex-1 text-left px-4 py-3"
                    style={{
                      border: `2px solid #1B2A4A`,
                      background: mode === opt.key ? "#1B2A4A" : "#FFFBF6",
                      color: mode === opt.key ? "#FF6B4A" : "#1B2A4A",
                    }}
                  >
                    <div className="font-bold text-sm">{opt.label}</div>
                    <div
                      className="text-xs opacity-80"
                      style={{
                        color: mode === opt.key ? "#FBF0E4" : "#4A5670",
                      }}
                    >
                      {opt.sub}
                    </div>
                  </button>
                ))}
              </div>

              <h2
                className="text-lg font-semibold mb-3"
                style={{ color: "#1B2A4A" }}
              >
                Format
              </h2>
              <div className="flex gap-3 mb-8">
                {[
                  { key: "bracket", label: "Bracket", sub: "Single elimination" },
                  { key: "league", label: "League", sub: "Round robin" },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => changeFormat(opt.key)}
                    className="flex-1 text-left px-4 py-3"
                    style={{
                      border: `2px solid #1B2A4A`,
                      background: format === opt.key ? "#1B2A4A" : "#FFFBF6",
                      color: format === opt.key ? "#FF6B4A" : "#1B2A4A",
                    }}
                  >
                    <div className="font-bold text-sm">{opt.label}</div>
                    <div
                      className="text-xs opacity-80"
                      style={{
                        color: format === opt.key ? "#FBF0E4" : "#4A5670",
                      }}
                    >
                      {opt.sub}
                    </div>
                  </button>
                ))}
              </div>

              {mode === "doubles" && format === "league" && (
                <div className="mb-8">
                  <button
                    onClick={toggleRandomPartners}
                    className="flex items-center gap-3 px-4 py-3 w-full text-left"
                    style={{
                      border: "2px solid #1B2A4A",
                      background: randomPartners ? "#1B2A4A" : "#FFFBF6",
                      color: randomPartners ? "#FF6B4A" : "#1B2A4A",
                    }}
                  >
                    <span
                      className="w-4 h-4 shrink-0 flex items-center justify-center"
                      style={{
                        border: `2px solid ${randomPartners ? "#FF6B4A" : "#1B2A4A"}`,
                        background: randomPartners ? "#FF6B4A" : "transparent",
                      }}
                    />
                    <span>
                      <div className="font-bold text-sm">Randomize partners each round</div>
                      <div
                        className="text-xs opacity-80"
                        style={{ color: randomPartners ? "#FBF0E4" : "#4A5670" }}
                      >
                        Mixer style — enter individual players, get a new partner every round
                      </div>
                    </span>
                  </button>

                  {randomPartners && (
                    <div className="flex items-center gap-3 mt-3">
                      <label className="text-sm font-semibold" style={{ color: "#1B2A4A" }}>
                        Rounds
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={mixerRoundCount}
                        onChange={(e) =>
                          setMixerRoundCount(
                            Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1))
                          )
                        }
                        className="w-16 px-2 py-1 text-center outline-none"
                        style={{ border: "2px solid #1B2A4A", background: "#FFFBF6" }}
                      />
                    </div>
                  )}
                </div>
              )}

              <h2
                className="text-lg font-semibold mb-4"
                style={{ color: "#1B2A4A" }}
              >
                {entrantLabel} ({players.length})
              </h2>

              <div className="flex flex-col sm:flex-row gap-2 mb-4">
                <input
                  value={playerInput}
                  onChange={(e) => setPlayerInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (usesIndividualEntry ? addPlayer() : null)}
                  placeholder={usesIndividualEntry ? "Add a player name" : "Player 1 name"}
                  className="flex-1 px-3 py-2 outline-none"
                  style={{
                    border: "2px solid #1B2A4A",
                    background: "#FFFBF6",
                  }}
                />
                {!usesIndividualEntry && (
                  <input
                    value={partnerInput}
                    onChange={(e) => setPartnerInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addPlayer()}
                    placeholder="Player 2 name"
                    className="flex-1 px-3 py-2 outline-none"
                    style={{
                      border: "2px solid #1B2A4A",
                      background: "#FFFBF6",
                    }}
                  />
                )}
                <button
                  onClick={addPlayer}
                  className="px-4 flex items-center justify-center"
                  style={{ background: "#1B2A4A", color: "#FBF0E4" }}
                  aria-label={usesIndividualEntry ? "Add player" : "Add team"}
                >
                  <Plus size={18} />
                </button>
              </div>

              <ul className="mb-6 divide-y" style={{ borderColor: "#EDE0D0" }}>
                {players.map((p, idx) => (
                  <li
                    key={idx}
                    className="flex items-center justify-between py-2"
                  >
                    <span className="flex items-center gap-3">
                      <span
                        className="text-xs w-6 h-6 rounded-full flex items-center justify-center font-bold"
                        style={{ background: "#FF6B4A", color: "#1B2A4A" }}
                      >
                        {idx + 1}
                      </span>
                      {p}
                    </span>
                    <button
                      onClick={() => removePlayer(idx)}
                      aria-label={`Remove ${p}`}
                      className="opacity-50 hover:opacity-100"
                    >
                      <X size={16} />
                    </button>
                  </li>
                ))}
                {players.length === 0 && (
                  <li className="py-4 text-sm opacity-60">
                    {mode === "doubles" && !isMixer
                      ? "No teams yet. Add at least two to build a bracket."
                      : "No players yet. Add at least two to build a bracket."}
                  </li>
                )}
              </ul>

              <div className="flex flex-wrap gap-3">
                {!isMixer && (
                  <button
                    onClick={shuffle}
                    disabled={players.length < 2}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-semibold disabled:opacity-40"
                    style={{ border: "2px solid #1B2A4A", color: "#1B2A4A" }}
                  >
                    <Shuffle size={16} /> Shuffle seeds
                  </button>
                )}
                <button
                  onClick={generate}
                  disabled={!canGenerate}
                  className="flex items-center gap-2 px-6 py-2 text-sm font-bold disabled:opacity-40"
                  style={{ background: "#1B2A4A", color: "#FBF0E4" }}
                >
                  {format === "bracket" ? "Generate bracket" : "Generate schedule"}
                </button>
              </div>
              {players.length === 1 && (
                <p className="text-sm mt-3 opacity-60">
                  Add one more {mode === "doubles" && !isMixer ? "team" : "player"} — {format === "bracket" ? "a bracket" : "a league"} needs at least two.
                </p>
              )}
              {format === "league" && !isMixer && players.length % 2 === 1 && players.length > 1 && (
                <p className="text-sm mt-3 opacity-60">
                  Odd number of {mode === "doubles" ? "teams" : "players"} — everyone gets one bye round.
                </p>
              )}
              {isMixer && players.length % 4 !== 0 && players.length > 1 && (
                <p className="text-sm mt-3 opacity-60">
                  {players.length} players won't divide evenly into courts of 4 — some players will sit out some rounds.
                </p>
              )}
            </div>
          ) : format === "bracket" ? (
            <Bracket rounds={rounds} setScore={setScore} champion={champion} />
          ) : (
            <League
              rounds={leagueRounds}
              players={players}
              setScore={setLeagueScore}
              entrantLabel={entrantLabel}
              isMixer={isMixer}
              onAddRound={mode === "doubles" ? addRound : null}
              sittingRounds={sittingRounds}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function Bracket({ rounds, setScore, champion }) {
  const totalRounds = rounds.length;

  return (
    <div>
      {champion && (
        <div
          className="flex items-center gap-3 mb-8 px-4 py-3"
          style={{ background: "#1B2A4A", color: "#FF6B4A" }}
        >
          <Trophy size={22} />
          <span
            style={{
              fontFamily: "'Big Shoulders Display', sans-serif",
              fontWeight: 900,
              fontSize: "1.4rem",
            }}
          >
            {champion} WINS THE TITLE
          </span>
        </div>
      )}
      <div className="flex gap-10 overflow-x-auto pb-6">
        {rounds.map((round, rIdx) => (
          <div
            key={rIdx}
            className="flex flex-col justify-around gap-6 shrink-0"
            style={{ minWidth: 260 }}
          >
            <div
              className="text-xs tracking-[0.25em] font-bold mb-1"
              style={{ color: "#F4834F" }}
            >
              {roundLabel(rIdx, totalRounds)}
            </div>
            <div className="flex flex-col justify-around gap-8 h-full">
              {round.map((match) => (
                <MatchCard
                  key={match.id}
                  match={match}
                  onScore={(which, val) => setScore(rIdx, match.id, which, val)}
                  editable={match.p1 && match.p2}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function League({ rounds, players, setScore, entrantLabel, isMixer, sittingRounds, onAddRound }) {
  const standings = useMemo(
    () => computeStandings(players, rounds, isMixer),
    [players, rounds, isMixer]
  );

  return (
    <div className="flex flex-col lg:flex-row gap-10">
      <div className="flex-1">
        <div
          className="text-xs tracking-[0.25em] font-bold mb-4"
          style={{ color: "#F4834F" }}
        >
          SCHEDULE
        </div>
        <div className="space-y-8">
          {rounds.map((round, rIdx) => (
            <div key={rIdx}>
              <div
                className="text-xs tracking-[0.2em] font-semibold mb-2 flex items-center gap-2 flex-wrap"
                style={{ color: "#1B2A4A" }}
              >
                <span>ROUND {rIdx + 1}</span>
                {isMixer && sittingRounds?.[rIdx]?.length > 0 && (
                  <span
                    className="text-xs font-medium tracking-normal opacity-70"
                    style={{ color: "#4A5670" }}
                  >
                    &middot; sitting out: {sittingRounds[rIdx].join(", ")}
                  </span>
                )}
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                {round.map((match) => (
                  <MatchCard
                    key={match.id}
                    match={match}
                    onScore={(which, val) => setScore(rIdx, match.id, which, val)}
                    editable
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        {onAddRound && (
          <button
            onClick={onAddRound}
            className="flex items-center gap-2 px-4 py-2 mt-8 text-sm font-semibold"
            style={{ border: "2px solid #1B2A4A", color: "#1B2A4A" }}
          >
            <Plus size={16} /> Add round
          </button>
        )}
      </div>

      <div style={{ minWidth: 300 }}>
        <div
          className="text-xs tracking-[0.25em] font-bold mb-4"
          style={{ color: "#F4834F" }}
        >
          STANDINGS
        </div>
        <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #1B2A4A" }}>
              <th className="text-left py-2 font-semibold" style={{ color: "#1B2A4A" }}>
                {entrantLabel === "Teams" ? "Team" : "Player"}
              </th>
              <th className="text-center py-2 font-semibold" style={{ color: "#1B2A4A" }}>
                W
              </th>
              <th className="text-center py-2 font-semibold" style={{ color: "#1B2A4A" }}>
                L
              </th>
              <th className="text-center py-2 font-semibold" style={{ color: "#1B2A4A" }}>
                Diff
              </th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row, idx) => (
              <tr key={row.name} style={{ borderBottom: "1px solid #EDE0D0" }}>
                <td className="py-2 flex items-center gap-2">
                  <span
                    className="text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold shrink-0"
                    style={{
                      background: idx === 0 && row.played > 0 ? "#FF6B4A" : "#EDE0D0",
                      color: "#1B2A4A",
                    }}
                  >
                    {idx + 1}
                  </span>
                  <span className="truncate">{row.name}</span>
                </td>
                <td className="text-center py-2 font-semibold">{row.wins}</td>
                <td className="text-center py-2 opacity-70">{row.losses}</td>
                <td className="text-center py-2 opacity-70">
                  {row.pf - row.pa > 0 ? "+" : ""}
                  {row.pf - row.pa}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MatchCard({ match, onScore, editable }) {
  const row = (name, score, which, isWinner, isBye) => (
    <div
      className="flex items-center justify-between px-3 py-2"
      style={{
        background: isWinner ? "#1B2A4A" : "#FFFBF6",
        color: isWinner ? "#FF6B4A" : isBye ? "#A69A8A" : "#1B2A4A",
      }}
    >
      <span className="text-sm font-medium truncate pr-2">
        {name || (isBye ? "" : "TBD")}
      </span>
      {editable ? (
        <input
          value={score}
          onChange={(e) =>
            onScore(which, e.target.value.replace(/[^0-9]/g, ""))
          }
          className="w-8 text-center text-sm font-bold outline-none"
          style={{
            background: "transparent",
            color: isWinner ? "#FF6B4A" : "#1B2A4A",
            borderBottom: `2px solid ${isWinner ? "#FF6B4A" : "#F4834F"}`,
          }}
        />
      ) : (
        <span className="text-sm font-bold w-8 text-center">
          {isWinner ? "•" : ""}
        </span>
      )}
    </div>
  );

  return (
    <div style={{ border: "2px solid #1B2A4A" }}>
      {row(match.p1, match.score1, 1, match.winner && match.winner === match.p1, !match.p1)}
      <div
        style={{
          height: 2,
          background:
            "repeating-linear-gradient(90deg, #F4834F 0 6px, transparent 6px 12px)",
        }}
      />
      {row(match.p2, match.score2, 2, match.winner && match.winner === match.p2, !match.p2)}
    </div>
  );
}
