// Fall Unit Points Calculator
// - Keeps full precision for all intermediate calculations
// - Rounds only the final unit total
// - Export panel avoids clipboard permissions (works on file:// and https)

const els = {
  unitName: document.getElementById("unitName"),
  wounds: document.getElementById("wounds"),

  fullSpeed: document.getElementById("fullSpeed"),
  cautSpeed: document.getElementById("cautSpeed"),
  deftness: document.getElementById("deftness"),
  arcane: document.getElementById("arcane"),
  dodge: document.getElementById("dodge"),
  resistance: document.getElementById("resistance"),
  fight: document.getElementById("fight"),
  accuracy: document.getElementById("accuracy"),

  srStandard: document.getElementById("srStandard"),
  srMedium: document.getElementById("srMedium"),
  srStrong: document.getElementById("srStrong"),
  srWarning: document.getElementById("srWarning"),

  addWeaponBtn: document.getElementById("addWeaponBtn"),
  weaponsList: document.getElementById("weaponsList"),
  weaponTemplate: document.getElementById("weaponTemplate"),

  unitBreakdown: document.getElementById("unitBreakdown"),
  weaponBreakdown: document.getElementById("weaponBreakdown"),
  finalPoints: document.getElementById("finalPoints"),
  unroundedTotal: document.getElementById("unroundedTotal"),
  showDecimals: document.getElementById("showDecimals"),
  precisionNote: document.getElementById("precisionNote"),

  exportBtn: document.getElementById("exportBtn"),
  exportBox: document.getElementById("exportBox"),
  resetBtn: document.getElementById("resetBtn"),
};

const DEFAULT_WEAPON = {
  type: "melee",          // "melee" | "ranged"
  designation: "primary", // "primary" | "secondary"
  attacks: 5,             // 1..12
  pierce: 0,              // 0..3
  meleeRange: 1,          // 1 or 2 (melee only)
  rangedRange: 15,        // inches, step 5 (ranged only)
};

let weapons = [];

// ---------- Helpers ----------
function toInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function clampInt(n, min, max) {
  n = Math.trunc(n);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function fmt(n, showDecimals) {
  if (!Number.isFinite(n)) return "—";
  if (showDecimals) {
    return Number(n.toFixed(4)).toString();
  }
  return Math.round(n).toString();
}

function linearDeltaCost(actual, base, increment) {
  return (actual - base) * increment;
}

function piecewiseSymmetricCost(actual, base, tableByAbsDelta) {
  const delta = actual - base;
  const abs = Math.abs(delta);
  if (abs === 0) return 0;

  const maxDelta = Math.max(...Object.keys(tableByAbsDelta).map(k => Number(k)));
  const usedAbs = abs > maxDelta ? maxDelta : abs;

  const mag = tableByAbsDelta[usedAbs] ?? 0;
  return delta > 0 ? mag : -mag;
}

function pierceCost(p) {
  const table = { 0: 0, 1: 2, 2: 5, 3: 9 };
  return table[p] ?? 0;
}

function meleeRangeCost(r) {
  return r === 2 ? 3 : 0;
}

function rangedRangeCost(rangeInches, attacks) {
  const rb = Math.round(rangeInches / 5);
  return rb + (rb * 0.5 * attacks);
}

function attacksTierSplit(noa) {
  const a1 = Math.min(noa, 5);
  const a2 = Math.min(Math.max(noa - 5, 0), 3);
  const a3 = Math.min(Math.max(noa - 8, 0), 4);
  return { a1, a2, a3 };
}

function meleeAttacksCost(noa, fight) {
  const { a1, a2, a3 } = attacksTierSplit(noa);
  const k = (5 + fight) / 6;
  return (a1 * 2 * k) + (a2 * 3 * k) + (a3 * 4 * k);
}

function rangedAttacksCost(noa, accuracy) {
  const { a1, a2, a3 } = attacksTierSplit(noa);
  const k = (5 + accuracy) / 6;
  return (a1 * 2 * k) + (a2 * 3 * k) + (a3 * 4 * k);
}

function specialRulesCost(stdCount, medCount, strongCount) {
  const medPrices = [5, 4, 3];
  const strongPrices = [10, 9, 8];

  let total = 0;
  for (let i = 0; i < medCount; i++) total += medPrices[i] ?? 0;
  for (let i = 0; i < strongCount; i++) total += strongPrices[i] ?? 0;
  return total;
}

// Build export text from the *currently displayed* breakdown
function buildExportText() {
  const name = (els.unitName.value || "").trim() || "Unnamed Unit";
  const unitText = (els.unitBreakdown.textContent || "").trim();
  const weapText = (els.weaponBreakdown.textContent || "").trim();

  const unrounded = (els.unroundedTotal.textContent || "—").trim();
  const rounded = (els.finalPoints.textContent || "—").trim();

  const parts = [];
  parts.push(name);
  parts.push("");

  if (unitText) {
    parts.push(unitText);
    parts.push("");
  }

  if (weapText) {
    parts.push("Weapons:");
    parts.push(weapText);
    parts.push("");
  }

  parts.push(`Unrounded Total: ${unrounded}`);
  parts.push(`Rounded Total: ${rounded}`);

  return parts.join("\n");
}

// ---------- Weapons UI ----------
function renderWeapons() {
  els.weaponsList.innerHTML = "";
  weapons.forEach((w, idx) => {
    const node = els.weaponTemplate.content.cloneNode(true);

    const root = node.querySelector(".weapon");
    const title = node.querySelector(".weapon-title");
    const removeBtn = node.querySelector(".weapon-remove");

    const typeSel = node.querySelector(".weapon-type");
    const desigSel = node.querySelector(".weapon-designation");
    const atkInput = node.querySelector(".weapon-attacks");
    const pierceInput = node.querySelector(".weapon-pierce");

    const meleeRangeWrap = node.querySelector(".weapon-range-melee");
    const meleeRangeSel = node.querySelector(".weapon-range-melee-select");

    const rangedRangeWrap = node.querySelector(".weapon-range-ranged");
    const rangedRangeInput = node.querySelector(".weapon-range-ranged-input");

    const note = node.querySelector(".weapon-note");

    title.textContent = `Weapon ${idx + 1}`;

    typeSel.value = w.type;
    desigSel.value = w.designation;
    atkInput.value = w.attacks;
    pierceInput.value = w.pierce;
    meleeRangeSel.value = String(w.meleeRange);
    rangedRangeInput.value = w.rangedRange;

    function syncTypeUI() {
      const isMelee = typeSel.value === "melee";
      meleeRangeWrap.classList.toggle("hidden", !isMelee);
      rangedRangeWrap.classList.toggle("hidden", isMelee);

      note.textContent = isMelee
        ? "Melee: attacks use Fight (Fi). Range is 1\" or 2\"."
        : "Ranged: attacks use Accuracy (Ac). Range cost uses Rb + Rb×0.5×NoA.";
    }

    syncTypeUI();

    removeBtn.addEventListener("click", () => {
      weapons.splice(idx, 1);
      if (weapons.length === 0) weapons.push({ ...DEFAULT_WEAPON }); // always at least one weapon
      renderWeapons();
      recalc();
    });

    typeSel.addEventListener("change", () => {
      weapons[idx].type = typeSel.value;
      syncTypeUI();
      recalc();
    });

    desigSel.addEventListener("change", () => {
      weapons[idx].designation = desigSel.value;
      recalc();
    });

    atkInput.addEventListener("input", () => {
      weapons[idx].attacks = clampInt(toInt(atkInput.value, 1), 1, 12);
      atkInput.value = weapons[idx].attacks;
      recalc();
    });

    pierceInput.addEventListener("input", () => {
      weapons[idx].pierce = clampInt(toInt(pierceInput.value, 0), 0, 3);
      pierceInput.value = weapons[idx].pierce;
      recalc();
    });

    meleeRangeSel.addEventListener("change", () => {
      weapons[idx].meleeRange = clampInt(toInt(meleeRangeSel.value, 1), 1, 2);
      recalc();
    });

    rangedRangeInput.addEventListener("input", () => {
      let v = toInt(rangedRangeInput.value, 5);
      if (v < 5) v = 5;
      v = Math.round(v / 5) * 5; // snap to nearest 5
      weapons[idx].rangedRange = v;
      rangedRangeInput.value = v;
      recalc();
    });

    els.weaponsList.appendChild(root);
  });
}

// ---------- Calculation ----------
function calcUnitBase(wounds) {
  return wounds === 5 ? 50 : 30;
}

function calcStats() {
  const fullSpeed = clampInt(toInt(els.fullSpeed.value, 5), 0, 99);
  const cautSpeed = clampInt(toInt(els.cautSpeed.value, 3), 0, 99);

  // allow negatives
  const deftness = clampInt(toInt(els.deftness.value, 0), -99, 99);
  const arcane = clampInt(toInt(els.arcane.value, 0), -99, 99);
  const fight = clampInt(toInt(els.fight.value, 0), -99, 99);
  const accuracy = clampInt(toInt(els.accuracy.value, 0), -99, 99);

  const dodge = clampInt(toInt(els.dodge.value, 6), 0, 99);
  const resistance = clampInt(toInt(els.resistance.value, 2), 0, 99);

  const fullSpeedCost = linearDeltaCost(fullSpeed, 5, 6);
  const cautSpeedCost = linearDeltaCost(cautSpeed, 3, 6);
  const deftCost = linearDeltaCost(deftness, 0, 1);
  const arcCost = linearDeltaCost(arcane, 0, 1);

  const dodgeTable = { 1: 2, 2: 5, 3: 9, 4: 14 };
  const resTable = { 1: 3, 2: 7, 3: 12, 4: 18 };

  const dodgeCost = piecewiseSymmetricCost(dodge, 6, dodgeTable);
  const resCost = piecewiseSymmetricCost(resistance, 2, resTable);

  const subtotal =
    fullSpeedCost + cautSpeedCost + deftCost + arcCost + dodgeCost + resCost;

  return {
    values: { fullSpeed, cautSpeed, deftness, arcane, dodge, resistance, fight, accuracy },
    costs: { fullSpeedCost, cautSpeedCost, deftCost, arcCost, dodgeCost, resCost },
    subtotal,
    notes: {
      dodgeClamped: Math.abs(dodge - 6) > 4,
      resClamped: Math.abs(resistance - 2) > 4,
    }
  };
}

function calcWeapon(w, fight, accuracy) {
  const noa = clampInt(toInt(w.attacks, 5), 1, 12);
  const pierce = clampInt(toInt(w.pierce, 0), 0, 3);

  let attacksCost = 0;
  let rangeCost = 0;

  if (w.type === "melee") {
    attacksCost = meleeAttacksCost(noa, fight);
    rangeCost = meleeRangeCost(clampInt(toInt(w.meleeRange, 1), 1, 2));
  } else {
    attacksCost = rangedAttacksCost(noa, accuracy);
    const rg = Math.max(5, toInt(w.rangedRange, 15));
    rangeCost = rangedRangeCost(rg, noa);
  }

  const pierceCostVal = pierceCost(pierce);

  const fullCost = attacksCost + rangeCost + pierceCostVal;
  const designation = w.designation === "secondary" ? "secondary" : "primary";
  const finalCost = designation === "secondary" ? (fullCost / 2) : fullCost;

  return {
    noa,
    pierce,
    attacksCost,
    rangeCost,
    pierceCost: pierceCostVal,
    fullCost,
    designation,
    finalCost,
  };
}

function calcSpecialRules() {
  const std = clampInt(toInt(els.srStandard.value, 0), 0, 3);
  const med = clampInt(toInt(els.srMedium.value, 0), 0, 3);
  const strong = clampInt(toInt(els.srStrong.value, 0), 0, 3);

  const total = std + med + strong;

  let warning = "";
  if (total > 3) {
    warning = `Special rules total is ${total}. Max is 3. Reduce counts to avoid accidental overcosting.`;
  }

  const cost = specialRulesCost(std, med, strong);
  return { std, med, strong, total, warning, cost };
}

function recalc() {
  const showDecimals = !!els.showDecimals.checked;

  const wounds = clampInt(toInt(els.wounds.value, 3), 3, 5);
  const base = calcUnitBase(wounds);

  const stats = calcStats();
  const sr = calcSpecialRules();

  if (sr.warning) {
    els.srWarning.textContent = sr.warning;
    els.srWarning.classList.remove("hidden");
  } else {
    els.srWarning.classList.add("hidden");
    els.srWarning.textContent = "";
  }

  const weaponLines = [];
  let weaponsTotal = 0;

  weapons.forEach((w, idx) => {
    const c = calcWeapon(w, stats.values.fight, stats.values.accuracy);
    weaponsTotal += c.finalCost;

    const typeLabel = w.type === "melee" ? "Melee" : "Ranged";
    const desigLabel = c.designation === "secondary" ? "Secondary (½)" : "Primary";

    const detail = [
      `Weapon ${idx + 1} — ${typeLabel}, ${desigLabel}`,
      `  Attacks: ${c.noa}  AttacksCost: ${fmt(c.attacksCost, showDecimals)}`,
      `  Pierce: ${c.pierce}  PierceCost: ${fmt(c.pierceCost, showDecimals)}`,
      `  RangeCost: ${fmt(c.rangeCost, showDecimals)}`,
      `  WeaponTotal: ${fmt(c.finalCost, showDecimals)}`
    ].join("\n");

    weaponLines.push(detail);
  });

  const lines = [];

  lines.push(`Wounds base: ${wounds}W → ${fmt(base, showDecimals)}`);

  lines.push("");
  lines.push("Linear stats:");
  lines.push(`  Full Speed: ${stats.values.fullSpeed} → ${fmt(stats.costs.fullSpeedCost, showDecimals)}`);
  lines.push(`  Cautious Speed: ${stats.values.cautSpeed} → ${fmt(stats.costs.cautSpeedCost, showDecimals)}`);
  lines.push(`  Deftness: ${stats.values.deftness} → ${fmt(stats.costs.deftCost, showDecimals)}`);
  lines.push(`  Arcane: ${stats.values.arcane} → ${fmt(stats.costs.arcCost, showDecimals)}`);

  lines.push("");
  lines.push("Piecewise stats:");
  lines.push(`  Dodge: ${stats.values.dodge} → ${fmt(stats.costs.dodgeCost, showDecimals)} (base 6)`);
  lines.push(`  Resistance: ${stats.values.resistance} → ${fmt(stats.costs.resCost, showDecimals)} (base 2)`);

  lines.push("");
  lines.push("Special Rules:");
  lines.push(`  Standard x${sr.std} → 0`);
  lines.push(`  Medium x${sr.med} → ${fmt(specialRulesCost(0, sr.med, 0), showDecimals)}`);
  lines.push(`  Strong x${sr.strong} → ${fmt(specialRulesCost(0, 0, sr.strong), showDecimals)}`);
  lines.push(`  Special Rules Total → ${fmt(sr.cost, showDecimals)}`);

  const notes = [];
  if (stats.notes.dodgeClamped) notes.push("Dodge delta exceeds ±4; uses max table value at ±4.");
  if (stats.notes.resClamped) notes.push("Resistance delta exceeds ±4; uses max table value at ±4.");
  els.precisionNote.textContent = notes.length ? notes.join(" ") : " ";

  const unitNonWeaponTotal = base + stats.subtotal + sr.cost;
  const unrounded = unitNonWeaponTotal + weaponsTotal;
  const finalRounded = Math.round(unrounded);

  els.unitBreakdown.textContent = lines.join("\n");
  els.weaponBreakdown.textContent = weaponLines.join("\n\n");

  els.unroundedTotal.textContent = fmt(unrounded, true);
  els.finalPoints.textContent = String(finalRounded);
}

// ---------- Wiring ----------
function wireRecalcOnInput() {
  const inputs = [
    els.unitName, els.wounds,
    els.fullSpeed, els.cautSpeed, els.deftness, els.arcane,
    els.dodge, els.resistance, els.fight, els.accuracy,
    els.srStandard, els.srMedium, els.srStrong,
    els.showDecimals
  ];

  inputs.forEach(el => {
    el.addEventListener("input", recalc);
    el.addEventListener("change", recalc);
  });
}

function addWeapon(initial = DEFAULT_WEAPON) {
  weapons.push({ ...DEFAULT_WEAPON, ...initial });
  renderWeapons();
  recalc();
}

function resetAll() {
  els.unitName.value = "";
  els.wounds.value = "3";

  els.fullSpeed.value = "5";
  els.cautSpeed.value = "3";
  els.deftness.value = "0";
  els.arcane.value = "0";
  els.dodge.value = "6";
  els.resistance.value = "2";
  els.fight.value = "0";
  els.accuracy.value = "0";

  els.srStandard.value = "0";
  els.srMedium.value = "0";
  els.srStrong.value = "0";

  els.showDecimals.checked = true;
  els.exportBox.value = "";

  weapons = [{ ...DEFAULT_WEAPON }];
  renderWeapons();
  recalc();
}

// Init
(function init() {
  weapons = [{ ...DEFAULT_WEAPON }];
  renderWeapons();
  wireRecalcOnInput();

  els.addWeaponBtn.addEventListener("click", () => addWeapon());
  els.resetBtn.addEventListener("click", resetAll);

  els.exportBtn.addEventListener("click", () => {
    recalc(); // ensure current
    const text = buildExportText();
    els.exportBox.value = text;

    // Auto-select for easy Ctrl+C
    els.exportBox.focus();
    els.exportBox.select();
    els.exportBox.setSelectionRange(0, text.length);

    const old = els.exportBtn.textContent;
    els.exportBtn.textContent = "Selected — Ctrl+C";
    setTimeout(() => (els.exportBtn.textContent = old), 1200);
  });

  recalc();
})();
